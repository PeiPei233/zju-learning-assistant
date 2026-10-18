//! WPS WebOffice's original download and print export transport. The key and routing information are
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

use crate::zju_assist::ZjuAssist;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DownloadMode {
    Original,
    PreviewPdf,
}

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
    pub fn new(preview_url: &Url, bootstrap: Bootstrap, mode: DownloadMode) -> Result<Self> {
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

pub async fn download(
    client: &ZjuAssist,
    upload_id: i64,
    activity_id: i64,
    mode: DownloadMode,
) -> Result<Response> {
    let mut endpoint = Url::parse(&format!(
        "https://courses.zju.edu.cn/api/uploads/{}/preview/private-wps",
        upload_id
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
    download_from_preview(client, upload_id, preview_url, mode).await
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
    let request = PrintRequest::new(&preview_url, bootstrap, mode)?;
    let mut transport = client.post(request.url.clone());
    transport
        .headers(request.headers.clone())
        .timeout(Duration::from_secs(90));
    // WPS GET requests use POST to the gateway without a request body.
    if !request.body.is_empty() {
        transport.body(request.body.clone());
    }
    let exported = transport.send().await?;
    if !exported.status().is_success() {
        return Err(anyhow!(
            "WPS 打印导出失败 (HTTP {})",
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
            "WPS 导出文件下载失败 (HTTP {})，请重试以获取新地址",
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
