use super::{Service, ZjuAssist};
use anyhow::{anyhow, Context, Result};
use log::info;
use regex::Regex;
use reqwest::{cookie::CookieStore, header::HeaderMap, Method};
use serde_json::Value;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use url::Url;

impl ZjuAssist {
    pub(super) async fn login_graduate(&self) -> Result<String> {
        match self.login_graduate_once().await {
            Ok(token) => Ok(token),
            Err(error) => {
                let retryable = error.downcast_ref::<reqwest::Error>().is_some_and(|error| {
                    error.is_timeout()
                        || error.is_connect()
                        || error.is_request()
                        || error.is_body()
                });
                if !retryable {
                    return Err(anyhow!("{error:#}"));
                }
                // Switch routes and obtain a fresh ticket: the previous ticket may be consumed.
                log::warn!("Graduate authentication: network failure, retrying with a fresh ticket on the alternate route");
                let mut alternate = self.clone();
                alternate.proxy_first =
                    Arc::new(AtomicBool::new(!self.proxy_first.load(Ordering::Relaxed)));
                alternate
                    .login_graduate_once()
                    .await
                    .map_err(|error| anyhow!("{error:#}"))
            }
        }
    }

    async fn login_graduate_once(&self) -> Result<String> {
        const SERVICE: &str = "https://yjsy.zju.edu.cn/";
        let has_sso_cookie = self
            .jar
            .cookies(&Url::parse("https://zjuam.zju.edu.cn/cas/login")?)
            .and_then(|cookies| {
                cookies.to_str().ok().map(|value| {
                    value
                        .split(';')
                        .any(|cookie| cookie.trim().starts_with("iPlanetDirectoryPro="))
                })
            })
            .unwrap_or(false);
        info!("Graduate CAS: sso_cookie_present={}", has_sso_cookie);
        let response = self
            .request_without_redirects(Method::GET, "https://zjuam.zju.edu.cn/cas/login")
            .query(&[("service", SERVICE)])
            .timeout(Duration::from_secs(15))
            .send_once()
            .await
            .map_err(|e| e.without_url())
            .context("获取研究生 CAS ticket 失败")?;
        let status = response.status();
        let has_location = response.headers().contains_key("location");
        info!(
            "Graduate CAS: status={}, redirect={}, location={}",
            status.as_u16(),
            status.is_redirection(),
            has_location
        );
        if !status.is_redirection() {
            let body = response.text().await.map_err(|e| e.without_url())?;
            let login_page = body.contains("统一身份认证") || body.contains("name=\"execution\"");
            info!("Graduate CAS: login_page={}", login_page);
            return Err(anyhow!(
                "研究生系统登录失败：未取得统一身份认证 ticket（HTTP {}，{}）",
                status.as_u16(),
                if login_page {
                    "返回了统一身份认证登录页"
                } else {
                    "未返回认证跳转"
                }
            ));
        }
        let location = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("研究生系统登录失败：缺少跳转地址"))?;
        let callback = Url::parse(SERVICE)?.join(location)?;
        if callback.scheme() != "https" || callback.host_str() != Some("yjsy.zju.edu.cn") {
            return Err(anyhow!("研究生系统登录失败：回调地址无效"));
        }
        let ticket = callback
            .query_pairs()
            .find(|(key, _)| key == "ticket")
            .map(|(_, value)| value.into_owned())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("研究生系统登录失败：回调缺少 ticket"))?;
        let value: Value = self
            .request_without_redirects(
                Method::GET,
                format!("{SERVICE}dataapi/sys/cas/client/validateLogin"),
            )
            .query(&[("ticket", ticket.as_str()), ("service", SERVICE)])
            .timeout(Duration::from_secs(15))
            .send_once()
            .await
            .map_err(|e| e.without_url())
            .context("换取研究生 token 失败")?
            .error_for_status()
            .map_err(|e| e.without_url())
            .context("换取研究生 token 失败")?
            .json()
            .await
            .map_err(|e| e.without_url())
            .context("换取研究生 token 失败")?;
        if value["success"] != true {
            return Err(anyhow!("研究生系统登录认证失败"));
        }
        value["result"]["token"]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("研究生系统登录响应缺少 token"))
    }

    fn graduate_auth_expired(status: u16, body: &str) -> bool {
        if matches!(status, 401 | 403 | 901) {
            return true;
        }
        let lower = body.to_lowercase();
        let authentication_text = |text: &str| {
            ["token", "登录", "认证", "过期", "unauthorized", "kickout"]
                .iter()
                .any(|word| text.contains(word))
        };
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            let number = |value: &Value| value.as_i64().or_else(|| value.as_str()?.parse().ok());
            if [&value, &value["result"], &value["data"]]
                .iter()
                .any(|value| number(&value["kickout"]) == Some(1))
            {
                return true;
            }
            let code = number(&value["code"]).or_else(|| number(&value["status"]));
            let message = ["message", "msg", "error"]
                .iter()
                .filter_map(|key| value[key].as_str())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            return matches!(code, Some(401 | 403 | 901))
                || (value["success"] == false && code == Some(500))
                || (authentication_text(&message)
                    && (value["success"] == false || code.is_some_and(|code| code != 200)));
        }
        // Only treat recognizable authentication pages as expired sessions.
        lower.contains("统一身份认证")
            || lower.contains("请先登录")
            || lower.contains("登录已失效")
            || (lower.contains("name=\"username\"") && lower.contains("name=\"password\""))
    }

    async fn graduate_api(&mut self, method: Method, path: &str) -> Result<Value> {
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        for attempt in 0..2 {
            let token = self.ensure_service(Service::Graduate, false).await?;
            let mut headers = HeaderMap::new();
            headers.insert("X-Access-Token", token.parse()?);
            let response = self
                .request_without_redirects(
                    method.clone(),
                    format!("https://yjsy.zju.edu.cn/dataapi{path}"),
                )
                .headers(headers)
                .timeout(Duration::from_secs(15))
                .send()
                .await
                .map_err(|e| anyhow!("请求研究生接口失败：{}", e.without_url()))?;
            let status = response.status();
            let auth_redirect = status.is_redirection()
                && response
                    .headers()
                    .get("location")
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|location| {
                        location.contains("/cas/login") || location.contains("/login")
                    });
            let body = response
                .text()
                .await
                .map_err(|e| anyhow!("读取研究生响应失败：{}", e.without_url()))?;
            if auth_redirect || Self::graduate_auth_expired(status.as_u16(), &body) {
                if attempt == 0 {
                    self.ensure_service(Service::Graduate, true).await?;
                    continue;
                }
                return Err(anyhow!("研究生系统登录已失效，请重新登录"));
            }
            if !status.is_success() {
                return Err(anyhow!("研究生接口返回 HTTP {}", status.as_u16()));
            }
            let result: Value =
                serde_json::from_str(&body).map_err(|_| anyhow!("研究生接口返回了无效的 JSON"))?;
            if result["success"] != true {
                return Err(anyhow!(
                    "研究生接口请求失败：{}",
                    result["message"].as_str().unwrap_or("服务未返回错误说明")
                ));
            }
            return Ok(result);
        }
        Err(anyhow!("研究生系统登录已失效，请重新登录"))
    }

    pub async fn get_graduate_score(&mut self) -> Result<Vec<Value>> {
        let result = self
            .graduate_api(Method::POST, "/py/pyXsxk/queryXsxkByXnxqXs")
            .await?;
        let text = |value: &Value| match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if result["success"] != true {
            return Err(anyhow!("研究生成绩查询失败：{}", text(&result["message"])));
        }
        let mut rows = Vec::new();
        for key in ["xxjhnList", "xxjhwList"] {
            match &result["result"][key] {
                Value::Null => {}
                Value::Array(list) => rows.extend(list),
                _ => return Err(anyhow!("研究生成绩课程列表格式错误")),
            }
        }
        let mut result = Vec::new();
        let mut missing_id = 0;
        // sjddBz is a schedule description, not a course number.
        let class_id = Regex::new(r"班级编号(\d{7})")?;
        for row in rows {
            if text(&row["xkztMc"]) == "未处理" {
                continue;
            }
            let description = text(&row["sjddBz"]);
            let id = class_id
                .captures(&description)
                .map(|captures| captures[1].to_owned())
                .unwrap_or_else(|| text(&row["kcbh"]));
            if id.trim().is_empty() {
                missing_id += 1;
                continue;
            }
            let grade_level = text(&row["cjdj"]);
            let grade = if text(&row["xkztMc"]) == "免修" || text(&row["mxlx"]) == "免修" {
                "免修".to_owned()
            } else if !grade_level.trim().is_empty() {
                grade_level
            } else {
                text(&row["zf"])
            };
            result.push(serde_json::json!({
                "course_id":id,"course_name":text(&row["kcmc"]),"grade":grade,
                "credits":text(&row["xf"]),"grade_point":"","makeup_grade":""
            }));
        }
        if missing_id > 0 {
            log::warn!(
                "Graduate scores: skipped {} rows without a course identifier",
                missing_id
            );
        }
        Ok(result)
    }

    pub async fn check_graduate_evaluation_done(&mut self) -> Result<bool> {
        let profile = self
            .graduate_api(Method::POST, "/py/pyXsxk/getXsxkXfInfoByXs")
            .await?;
        let profile = &profile["result"]["xjYjsjbxx"];
        if !profile.is_object() {
            return Err(anyhow!("研究生评价查询缺少学生类型信息"));
        }
        // Match the student-facing page's endpoint and evaluation switch rules.
        let continuing = profile["xslx"] == "11"
            || profile["xslx"] == "13"
            || profile["xh"]
                .as_str()
                .is_some_and(|number| number.starts_with("YB21"));
        let path = if continuing {
            "/py/pyXsxk/queryJxsXsxkByXnxqXs"
        } else {
            "/py/pyXsxk/queryXsxkByXnxqXs"
        };
        let courses = self.graduate_api(Method::POST, path).await?;
        let result = &courses["result"];
        if !result.is_null() && !result.is_object() && !result.is_array() {
            return Err(anyhow!("研究生课程列表格式错误"));
        }
        let lists = if result.is_array() {
            vec![result]
        } else {
            vec![&result["xxjhnList"], &result["xxjhwList"]]
        };
        let mut pending = false;
        for list in lists {
            match list {
                Value::Null => {}
                Value::Array(rows) => pending |= rows.iter().any(|row| row["xkztMc"] == "待评价"),
                _ => return Err(anyhow!("研究生课程列表格式错误")),
            }
        }
        if !pending {
            return Ok(true);
        }
        if continuing || (profile["xslx"] == "12" && profile["xxfs"] == "1") {
            let config = self
                .graduate_api(
                    Method::GET,
                    "/system/sysCommonControl/getValueByKey?bizKey=XKCS_QRZ_JXZLPJ",
                )
                .await?;
            match &config["result"] {
                Value::String(flag) if flag == "1" => return Ok(false),
                Value::Number(flag) if flag.as_i64() == Some(1) => return Ok(false),
                Value::String(flag) if flag == "0" => return Ok(true),
                Value::Number(flag) if flag.as_i64() == Some(0) => return Ok(true),
                _ => return Err(anyhow!("研究生评价开放状态无效")),
            }
        }
        Ok(false)
    }
}
