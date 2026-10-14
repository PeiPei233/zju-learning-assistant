//! WPS WebOffice's print export transport. The key and routing information are
//! obtained from a fresh preview page, never persisted or written to logs.
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::header::HeaderMap;
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

#[derive(Deserialize)]
pub struct Bootstrap {
    pub root_file_id: String,
    pub app_id: String,
    pub csrf_token: String,
    pub encryption: Encryption,
}

#[derive(Deserialize)]
pub struct Encryption {
    pub algorithm: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    gateway: String,
    #[serde(rename = "isEncryption")]
    enabled: bool,
}

pub struct PrintRequest {
    pub url: Url,
    pub headers: HeaderMap,
    pub body: String,
    key: [u8; 32],
    iv: [u8; 16],
}

pub fn parse_bootstrap(html: &str, upload_id: i64) -> Result<Bootstrap> {
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

pub fn validate_preview_url(url: &Url) -> Result<()> {
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

pub fn validate_download_url(url: &Url) -> Result<()> {
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

impl PrintRequest {
    pub fn new(preview_url: &Url, bootstrap: Bootstrap) -> Result<Self> {
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
        let api = json!({
            "method": "POST",
            "api": format!("/api/v3/office/file/{}/export", bootstrap.root_file_id),
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
        let body = encrypt(
            &key,
            &iv,
            &serde_json::to_vec(&json!({
                "format": "pdf", "options": {}, "print": true,
                "clientId": "", "password": "",
            }))?,
        );
        Ok(Self {
            url,
            headers,
            body,
            key,
            iv,
        })
    }

    pub fn download_url(&self, body: &str, encrypted: bool) -> Result<Url> {
        let plaintext = if encrypted {
            let ciphertext = STANDARD.decode(body.trim()).context("WPS 响应编码无效")?;
            let data = cbc::Decryptor::<aes::Aes256>::new((&self.key).into(), (&self.iv).into())
                .decrypt_padded_vec_mut::<Pkcs7>(&ciphertext)
                .map_err(|_| anyhow!("无法解密 WPS 导出响应"))?;
            String::from_utf8(data).context("WPS 导出响应格式无效")?
        } else {
            body.to_string()
        };
        let data: Value = serde_json::from_str(&plaintext).context("WPS 导出响应不是 JSON")?;
        let raw_url = data["url"]
            .as_str()
            .ok_or_else(|| anyhow!("WPS 未提供导出文件，可能没有打印权限或文件尚未准备好"))?;
        let url = self.url.join(raw_url)?;
        validate_download_url(&url)?;
        Ok(url)
    }
}

pub fn preview_file_name(original: &str) -> String {
    let path = std::path::Path::new(original);
    if path
        .extension()
        .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("pdf"))
    {
        original.to_string()
    } else {
        format!(
            "{}.preview.pdf",
            path.file_name().unwrap_or_default().to_string_lossy()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::{pkcs8::EncodePublicKey, RsaPrivateKey};

    #[test]
    fn print_request_matches_the_wps_wire_protocol() {
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
        let request = PrintRequest::new(&Url::parse("https://course-wps.zju.edu.cn/weboffice/office/f/42?route_key=1&__doc_ha_node=node").unwrap(), bootstrap).unwrap();
        let wrapped = STANDARD
            .decode(request.headers["encryption-parameters"].as_bytes())
            .unwrap();
        let parameters: Value =
            serde_json::from_slice(&private.decrypt(Pkcs1v15Encrypt, &wrapped).unwrap()).unwrap();
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
        assert_eq!(
            decode(request.headers["api-parameters"].to_str().unwrap())["api"],
            "/api/v3/office/file/42/export"
        );
        assert_eq!(
            decode(&request.body),
            json!({"format":"pdf","options":{},"print":true,"clientId":"","password":""})
        );
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
        let request = PrintRequest {
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
    fn exports_office_documents_with_a_pdf_extension() {
        assert_eq!(preview_file_name("lecture.PDF"), "lecture.PDF");
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
