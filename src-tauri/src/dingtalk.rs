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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_matches_known_vector_and_replaces_stale_parameters() {
        let url = signed_url(
            "https://example.invalid/robot/send?access_token=test&timestamp=old&sign=old",
            "SECtest",
            1600000000000,
        )
        .unwrap();
        let pairs: Vec<_> = url.query_pairs().collect();
        assert_eq!(pairs.len(), 3);
        assert!(pairs
            .iter()
            .any(|(k, v)| k == "access_token" && v == "test"));
        assert!(pairs
            .iter()
            .any(|(k, v)| k == "timestamp" && v == "1600000000000"));
        assert!(pairs
            .iter()
            .any(|(k, v)| k == "sign" && v == "J1ROuI0lRhdAs5lXpASksT0u9NwWl4DNkvcHISJRBoY="));
    }

    #[test]
    fn business_errors_are_not_reported_as_success() {
        assert!(check_response(json!({"errcode":0,"errmsg":"ok"})).is_ok());
        assert!(
            check_response(json!({"errcode":310000,"errmsg":"sign not match"}))
                .unwrap_err()
                .contains("sign not match")
        );
        assert!(check_response(json!({"errmsg":"missing status"})).is_err());
    }

    #[test]
    fn unsigned_webhook_is_preserved() {
        let webhook = "https://example.invalid/robot/send?access_token=test";
        assert_eq!(signed_url(webhook, "", 0).unwrap().as_str(), webhook);
        assert!(signed_url("file:///tmp/example", "", 0).is_err());
    }
}
