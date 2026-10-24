use super::{Service, ZjuAssist};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

impl ZjuAssist {
    pub(super) async fn login_zdbk(&self) -> Result<String> {
        let response = self.post("https://zjuam.zju.edu.cn/cas/login?service=https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html")
            .send().await.map_err(|error| error.without_url())?
            .error_for_status().map_err(|error| error.without_url())?;
        let body = response.text().await.map_err(|error| error.without_url())?;
        if body.contains("统一身份认证平台") {
            return Err(anyhow!("登录已失效，请重试"));
        }
        Ok(String::new())
    }

    pub async fn check_zdbk_evaluation_done(&mut self) -> Result<bool> {
        self.ensure_service(Service::Zdbk, false).await?;
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }

        let res = self
            .post(format!(
                "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_cxMyCosJxpj.html?gnmkdm=N5083&su={}",
                self.username
            ))
            .send()
            .await?;
        let text = res.text().await?;
        let mut json = serde_json::from_str(&text);

        if json.is_err() {
            self.ensure_service(Service::Zdbk, true).await?;

            let res = self
                .post(format!(
                    "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_cxMyCosJxpj.html?gnmkdm=N5083&su={}",
                    self.username
                ))
                .send()
                .await?;
            let text = res.text().await?;
            json = serde_json::from_str(&text);
            if json.is_err() {
                return Err(anyhow!("Check evaluation failed"));
            }
        }

        let json: Value = json.unwrap();
        let result = json["result"].as_str().unwrap();

        Ok(result == "1")
    }

    fn zdbk_auth_expired(status: u16, url: &Url, body: &str) -> bool {
        if status == 401
            || (url.host_str() == Some("zjuam.zju.edu.cn") && url.path() == "/cas/login")
            || (url.host_str() == Some("zdbk.zju.edu.cn")
                && url.path() == "/jwglxt/xtgl/login_slogin.html")
        {
            return true;
        }
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            return value["kickout"] == 1
                || value["kickout"] == "1"
                || value["code"] == 401
                || value["code"] == "401";
        }
        let body = body.to_lowercase();
        body.contains("<form")
            && ((body.contains("name=\"username\"") && body.contains("name=\"password\""))
                || (body.contains("name=\"yhm\"") && body.contains("name=\"mm\"")))
    }

    pub async fn get_zdbk_score(&mut self) -> Result<Vec<Value>> {
        self.ensure_service(Service::Zdbk, false).await?;
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        let data = [
            ("xn", ""),
            ("xq", ""),
            ("zscjl", ""),
            ("zscjr", ""),
            ("_search", "false"),
            (
                "nd",
                &SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
                    .to_string(),
            ),
            ("queryModel.showCount", "5000"),
            ("queryModel.currentPage", "1"),
            ("queryModel.sortName", "xkkh"),
            ("queryModel.sortOrder", "asc"),
            ("time", "1"),
        ];

        for attempt in 0..2 {
            let res = self.post(format!("https://zdbk.zju.edu.cn/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&gnmkdm=N508301&su={}", self.username))
                .form(&data)
                .send()
                .await.map_err(|error| error.without_url())?;
            let status = res.status();
            let url = res.url().clone();
            let content_type = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("unknown")
                .to_owned();
            let text = res.text().await.map_err(|error| error.without_url())?;
            if Self::zdbk_auth_expired(status.as_u16(), &url, &text) {
                if attempt == 0 {
                    self.ensure_service(Service::Zdbk, true).await?;
                    continue;
                }
                return Err(anyhow!("本科系统登录已失效，请重新登录"));
            }
            if !status.is_success() {
                return Err(anyhow!("成绩接口返回 HTTP {}", status.as_u16()));
            }
            let json: Value = serde_json::from_str(&text).map_err(|error| {
                let trimmed = text.trim_start();
                // Log response shape only: never include grades, cookies or URL queries.
                log::warn!(
                    "Undergraduate score response: status={}, content_type={}, bytes={}, empty={}, markup={}, bom={}, json_error={:?}, line={}, column={}",
                    status.as_u16(), content_type, text.len(), trimmed.is_empty(),
                    trimmed.starts_with('<'), text.starts_with('\u{feff}'),
                    error.classify(), error.line(), error.column()
                );
                anyhow!("成绩接口未返回有效 JSON（HTTP {}）", status.as_u16())
            })?;
            let score = json["items"]
                .as_array()
                .ok_or_else(|| anyhow!("本科成绩响应缺少课程列表"))?;
            return Ok(score
                .iter()
                .map(|row| {
                    let mut score = serde_json::Map::new();
                    for (original, normalized) in [
                        ("xkkh", "course_id"),
                        ("kcmc", "course_name"),
                        ("cj", "grade"),
                        ("xf", "credits"),
                        ("jd", "grade_point"),
                        ("bkcj", "makeup_grade"),
                    ] {
                        let text = match &row[original] {
                            Value::String(value) => value.clone(),
                            Value::Number(value) => value.to_string(),
                            _ => String::new(),
                        };
                        score.insert(normalized.to_owned(), Value::String(text));
                    }
                    Value::Object(score)
                })
                .collect());
        }
        Err(anyhow!("本科系统登录已失效，请重新登录"))
    }
}
