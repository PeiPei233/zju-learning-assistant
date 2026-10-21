use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::time::Duration;
use url::Url;

fn signed_url(webhook: &str, secret: &str, timestamp: i64) -> Result<Url, String> {
    let mut url = Url::parse(webhook.trim()).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("请输入完整的 http 或 https Webhook 地址".into());
    }
    if !secret.trim().is_empty() {
        let secret = secret.trim();
        let mut mac =
            Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e| e.to_string())?;
        mac.update(format!("{timestamp}\n{secret}").as_bytes());
        let sign = STANDARD.encode(mac.finalize().into_bytes());
        let params: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(key, _)| key != "timestamp" && key != "sign")
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        url.set_query(None);
        url.query_pairs_mut()
            .extend_pairs(params)
            .append_pair("timestamp", &timestamp.to_string())
            .append_pair("sign", &sign);
    }
    Ok(url)
}

pub async fn send(webhook: &str, secret: &str, title: &str, text: &str) -> Result<(), String> {
    let url = signed_url(webhook, secret, chrono::Utc::now().timestamp_millis())?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .post(url)
        .json(&json!({"msgtype":"markdown", "markdown":{"title":title,"text":text}}))
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .error_for_status()
        .map_err(|e| e.without_url().to_string())?;
    let value: Value = response
        .json()
        .await
        .map_err(|e| e.without_url().to_string())?;
    check_response(value)
}

fn check_response(value: Value) -> Result<(), String> {
    match value.get("errcode").and_then(Value::as_i64) {
        Some(0) => Ok(()),
        _ => Err(value.to_string()),
    }
}
