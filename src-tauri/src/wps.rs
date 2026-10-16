//! WPS WebOffice's original download and print export transport. Keys and routing are
//! obtained from a fresh preview page, never persisted or written to logs.
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::header::HeaderMap;
use reqwest::{Method, Response};
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;

use crate::model::Upload;
use crate::zju_assist::{UploadResponse, ZjuAssist};

#[derive(Clone, Copy, PartialEq, Eq)]
enum DownloadMode {
    Original,
    PreviewPdf,
}

#[derive(Clone, Deserialize)]
struct Bootstrap {
    pub root_file_id: String,
    pub app_id: String,
    pub csrf_token: String,
    pub encryption: Encryption,
}

#[derive(Clone, Deserialize)]
struct Encryption {
    pub algorithm: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    gateway: String,
    #[serde(rename = "isEncryption")]
    enabled: bool,
}

struct OfficeRequest {
    pub url: Url,
    pub headers: HeaderMap,
    pub body: String,
    key: [u8; 32],
    iv: [u8; 16],
}

fn parse_bootstrap(html: &str, upload_id: i64) -> Result<Bootstrap> {
    let source = html
        .split_once("window.__WPSENV__=")
        .ok_or_else(|| anyhow!("WPS 预览页面格式已变化或登录已过期"))?
        .1;
    // Parse only the JSON value, never execute JavaScript from the preview page.
    let mut values = serde_json::Deserializer::from_str(source).into_iter::<Bootstrap>();
    let bootstrap = values
        .next()
        .context("WPS 预览配置为空")?
        .context("无法读取 WPS 预览配置")?;
    if bootstrap.root_file_id != upload_id.to_string() {
        bail!("WPS 返回的课件与请求不一致");
    }
    Ok(bootstrap)
}

fn validate_preview_url(url: &Url) -> Result<()> {
    if url.scheme() != "https"
        || url.host_str() != Some("course-wps.zju.edu.cn")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port(), None | Some(443))
    {
        bail!("WPS 预览地址不属于学在浙大");
    }
    Ok(())
}

fn validate_download_url(url: &Url) -> Result<()> {
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !(host == "zju.edu.cn" || host.ends_with(".zju.edu.cn"))
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port(), None | Some(443))
    {
        bail!("WPS 导出地址不属于浙江大学，已停止下载");
    }
    Ok(())
}

fn encrypt(key: &[u8; 32], iv: &[u8; 16], text: &[u8]) -> String {
    STANDARD.encode(
        cbc::Encryptor::<aes::Aes256>::new(key.into(), iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(text),
    )
}

impl OfficeRequest {
    fn new(preview_url: &Url, bootstrap: Bootstrap, mode: DownloadMode) -> Result<Self> {
        validate_preview_url(preview_url)?;
        if !bootstrap.encryption.enabled || bootstrap.encryption.algorithm != "AES256" {
            bail!("WPS 加密协议已变化，请更新 ZLA");
        }
        let mut rng = rand::thread_rng();
        let key: [u8; 32] = std::array::from_fn(|_| rng.sample(Alphanumeric));
        let iv: [u8; 16] = std::array::from_fn(|_| rng.sample(Alphanumeric));
        let pem = String::from_utf8(
            STANDARD
                .decode(&bootstrap.encryption.public_key)
                .context("WPS 公钥编码无效")?,
        )
        .context("WPS 公钥格式无效")?;
        let public_key = RsaPublicKey::from_public_key_pem(&pem).context("WPS 公钥格式无效")?;
        let parameters = json!({
            "private_key": std::str::from_utf8(&key)?,
            "iv": std::str::from_utf8(&iv)?,
        });
        let wrapped_key = public_key
            .encrypt(&mut rng, Pkcs1v15Encrypt, &serde_json::to_vec(&parameters)?)
            .context("无法生成 WPS 导出请求")?;
        let (method, action) = match mode {
            DownloadMode::Original => ("GET", "download"),
            DownloadMode::PreviewPdf => ("POST", "export"),
        };
        let api = json!({
            "method": method,
            "api": format!("/api/v3/office/file/{}/{}", bootstrap.root_file_id, action),
            "query_string": "", "schema": "https",
        });
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("content-type", "application/json".to_string()),
            ("origin", preview_url.origin().ascii_serialization()),
            ("referer", preview_url.to_string()),
            ("x-app-id", bootstrap.app_id),
            ("x-csrf-rand", bootstrap.csrf_token),
            (
                "x-user-query",
                preview_url.query().unwrap_or_default().to_string(),
            ),
            ("encryption-algorithm", "AES256".to_string()),
            ("encryption-parameters", STANDARD.encode(wrapped_key)),
            (
                "api-parameters",
                encrypt(&key, &iv, &serde_json::to_vec(&api)?),
            ),
        ] {
            headers.insert(name, value.parse().context("WPS 请求头格式无效")?);
        }
        let url = preview_url.join(&bootstrap.encryption.gateway)?;
        validate_preview_url(&url)?;
        // The WPS GET transport uses POST to the gateway with no request body.
        let body = if mode == DownloadMode::Original {
            String::new()
        } else {
            encrypt(
                &key,
                &iv,
                &serde_json::to_vec(&json!({
                    "format": "pdf", "options": {}, "print": true,
                    "clientId": "", "password": "",
                }))?,
            )
        };
        Ok(Self {
            url,
            headers,
            body,
            key,
            iv,
        })
    }

    fn response_json(&self, body: &str, encrypted: bool) -> Result<Value> {
        let plaintext = if encrypted {
            let ciphertext = STANDARD.decode(body.trim()).context("WPS 响应编码无效")?;
            let data = cbc::Decryptor::<aes::Aes256>::new((&self.key).into(), (&self.iv).into())
                .decrypt_padded_vec_mut::<Pkcs7>(&ciphertext)
                .map_err(|_| anyhow!("无法解密 WPS 导出响应"))?;
            String::from_utf8(data).context("WPS 导出响应格式无效")?
        } else {
            body.to_string()
        };
        serde_json::from_str(&plaintext).context("WPS 导出响应不是 JSON")
    }

    fn download_url(&self, body: &str, encrypted: bool) -> Result<Url> {
        let data = self.response_json(body, encrypted)?;
        let raw_url = data["url"]
            .as_str()
            .ok_or_else(|| anyhow!("WPS 未提供文件下载地址，可能没有相应权限或文件尚未准备好"))?;
        let url = self.url.join(raw_url)?;
        validate_download_url(&url)?;
        Ok(url)
    }
}

pub async fn download(
    client: &ZjuAssist,
    upload: &Upload,
    on_preview: impl FnOnce(),
) -> Result<UploadResponse> {
    let activity_id = upload
        .activity_id
        .ok_or_else(|| anyhow!("缺少课件所属活动，请刷新课件列表后重试"))?;
    let mut endpoint = Url::parse(&format!(
        "https://courses.zju.edu.cn/api/uploads/{}/preview/private-wps",
        upload.id
    ))?;
    endpoint
        .query_pairs_mut()
        .append_pair("preview", "true")
        .append_pair("refer_id", &activity_id.to_string())
        .append_pair("refer_type", "learning_activity");
    let preview_info: Value = client
        .get(endpoint)
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let preview_url = Url::parse(
        preview_info["preview_url"]
            .as_str()
            .ok_or_else(|| anyhow!("此课件未提供 WPS 预览地址"))?,
    )?;
    match download_from_preview(
        client,
        upload.id,
        preview_url.clone(),
        DownloadMode::Original,
    )
    .await
    {
        Ok(response) => Ok(UploadResponse {
            response,
            is_preview: false,
        }),
        Err(original_error) => {
            log::info!("WPS 原文件下载失败，尝试打印导出：{}", original_error);
            on_preview();
            let response =
                download_from_preview(client, upload.id, preview_url, DownloadMode::PreviewPdf)
                    .await
                    .map_err(|preview_error| {
                        anyhow!("{}；预览版 PDF 导出失败：{}", original_error, preview_error)
                    })?;
            Ok(UploadResponse {
                response,
                is_preview: true,
            })
        }
    }
}

async fn download_from_preview(
    client: &ZjuAssist,
    upload_id: i64,
    preview_url: Url,
    mode: DownloadMode,
) -> Result<Response> {
    validate_preview_url(&preview_url)?;
    let page = client
        .request(Method::GET, preview_url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| error.without_url())?
        .error_for_status()
        .map_err(|error| error.without_url())?;
    // Redirects can add a routing node. Keep the resulting query verbatim.
    let preview_url = page.url().clone();
    validate_preview_url(&preview_url)?;
    let bootstrap = parse_bootstrap(&page.text().await?, upload_id)?;
    let request = OfficeRequest::new(&preview_url, bootstrap, mode)?;
    let mut transport = client.post(request.url.clone());
    transport
        .headers(request.headers.clone())
        .timeout(Duration::from_secs(90));
    if !request.body.is_empty() {
        transport.body(request.body.clone());
    }
    let exported = transport.send().await?;
    if !exported.status().is_success() {
        return Err(anyhow!(
            "WPS 文件获取失败 (HTTP {})",
            exported.status().as_u16()
        ));
    }
    let encrypted = exported
        .headers()
        .get("encryption")
        .is_some_and(|v| v == "1");
    let url = request.download_url(&exported.text().await?, encrypted)?;
    let mut headers = HeaderMap::new();
    headers.insert("referer", preview_url.as_str().parse()?);
    // Do not log temporary signed download URLs through the generic GET helper.
    let response = client
        .request(Method::GET, url)
        .headers(headers)
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .map_err(|error| error.without_url())?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "WPS 文件下载失败 (HTTP {})，请重试以获取新地址",
            response.status().as_u16()
        ));
    }
    Ok(response)
}

pub fn preview_file_name(original: &str) -> String {
    let path = std::path::Path::new(original);
    format!(
        "{}.preview.pdf",
        path.file_name().unwrap_or_default().to_string_lossy()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::{pkcs8::EncodePublicKey, RsaPrivateKey};

    #[test]
    fn original_and_print_requests_match_the_wps_wire_protocol() {
        let mut rng = rand::thread_rng();
        let private = RsaPrivateKey::new(&mut rng, 1024).unwrap();
        let pem = private
            .to_public_key()
            .to_public_key_pem(Default::default())
            .unwrap();
        let bootstrap = Bootstrap {
            root_file_id: "42".into(),
            app_id: "test-app".into(),
            csrf_token: "test-csrf".into(),
            encryption: Encryption {
                algorithm: "AES256".into(),
                public_key: STANDARD.encode(pem),
                gateway: "/weboffice".into(),
                enabled: true,
            },
        };
        for mode in [DownloadMode::Original, DownloadMode::PreviewPdf] {
            let request = OfficeRequest::new(&Url::parse("https://course-wps.zju.edu.cn/weboffice/office/f/42?route_key=1&__doc_ha_node=node").unwrap(), bootstrap.clone(), mode).unwrap();
            let wrapped = STANDARD
                .decode(request.headers["encryption-parameters"].as_bytes())
                .unwrap();
            let parameters: Value =
                serde_json::from_slice(&private.decrypt(Pkcs1v15Encrypt, &wrapped).unwrap())
                    .unwrap();
            assert_eq!(
                parameters["private_key"].as_str().unwrap().as_bytes(),
                request.key
            );
            assert_eq!(parameters["iv"].as_str().unwrap().as_bytes(), request.iv);
            assert_eq!(
                request.headers["x-user-query"],
                "route_key=1&__doc_ha_node=node"
            );
            let decode = |value: &str| {
                let data =
                    cbc::Decryptor::<aes::Aes256>::new((&request.key).into(), (&request.iv).into())
                        .decrypt_padded_vec_mut::<Pkcs7>(&STANDARD.decode(value).unwrap())
                        .unwrap();
                serde_json::from_slice::<Value>(&data).unwrap()
            };
            let api = decode(request.headers["api-parameters"].to_str().unwrap());
            if mode == DownloadMode::Original {
                assert_eq!(api["method"], "GET");
                assert_eq!(api["api"], "/api/v3/office/file/42/download");
                assert!(request.body.is_empty());
            } else {
                assert_eq!(api["method"], "POST");
                assert_eq!(api["api"], "/api/v3/office/file/42/export");
                assert_eq!(
                    decode(&request.body),
                    json!({"format":"pdf","options":{},"print":true,"clientId":"","password":""})
                );
            }
        }
    }

    #[test]
    fn parses_bootstrap_without_executing_trailing_script() {
        let html = r#"<script>window.__WPSENV__={"root_file_id":"42","app_id":"test","csrf_token":"test","encryption":{"algorithm":"AES256","publicKey":"test","gateway":"/weboffice","isEncryption":true}};throw new Error('must not execute');</script>"#;
        assert_eq!(parse_bootstrap(html, 42).unwrap().root_file_id, "42");
        assert!(parse_bootstrap(html, 99).is_err());
        assert!(parse_bootstrap("<html>login</html>", 42).is_err());
    }

    #[test]
    fn rejects_untrusted_preview_and_download_hosts() {
        for raw in [
            "http://course-wps.zju.edu.cn/x",
            "https://course-wps.zju.edu.cn.evil.test/x",
            "https://user:password@course-wps.zju.edu.cn/x",
            "https://course-wps.zju.edu.cn:8443/x",
        ] {
            assert!(validate_preview_url(&Url::parse(raw).unwrap()).is_err());
            assert!(validate_download_url(&Url::parse(raw).unwrap()).is_err());
        }
        assert!(validate_download_url(
            &Url::parse("https://file.zju.edu.cn/a.pdf?Signature=abc%2Bdef").unwrap()
        )
        .is_ok());
    }

    #[test]
    fn decodes_encrypted_export_without_changing_signed_query() {
        let request = OfficeRequest {
            url: Url::parse("https://course-wps.zju.edu.cn/weboffice").unwrap(),
            headers: HeaderMap::new(),
            body: String::new(),
            key: [b'A'; 32],
            iv: [b'B'; 16],
        };
        let body = r#"{"url":"/weboffice/export/a?Signature=a%2Bb%2Fc%3D&__doc_ha_node=example"}"#;
        let encrypted = encrypt(&request.key, &request.iv, body.as_bytes());
        assert_eq!(
            request.download_url(&encrypted, true).unwrap().query(),
            Some("Signature=a%2Bb%2Fc%3D&__doc_ha_node=example")
        );
        assert!(request
            .download_url("{\"result\":\"PermissionDenied\"}", false)
            .is_err());
        assert!(request.download_url("invalid", true).is_err());
    }

    #[test]
    fn names_preview_exports_separately_from_originals() {
        assert_eq!(preview_file_name("lecture.pdf"), "lecture.pdf.preview.pdf");
        assert_eq!(preview_file_name("lecture.PDF"), "lecture.PDF.preview.pdf");
        assert_eq!(
            preview_file_name("lecture.pptx"),
            "lecture.pptx.preview.pdf"
        );
        assert_ne!(
            preview_file_name("lecture.pptx"),
            preview_file_name("lecture.docx")
        );
    }
}
