use anyhow::{anyhow, Context, Result};
use log::info;
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, Method, RequestBuilder, Response};
use reqwest::{Error, IntoUrl};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::cmp::min;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs::File, io::Write, path::Path};
use url::Url;

use crate::model::Subject;
use crate::utils::{measure_latency, rsa_no_padding};

#[derive(Clone)]
pub struct ZjuAssist {
    jar: Arc<Jar>,
    have_login: bool,
    username: String,
    password: String,
    proxy_first: bool,
    graduate_token: Option<String>,
}

pub struct ZjuRequestBuilder {
    request_builder_first: RequestBuilder,
    request_builder_second: RequestBuilder,
}

#[derive(Debug, Deserialize)]
pub struct SubtitleContent {
    #[serde(rename = "BeginSec")]
    pub begin_sec: u64,
    #[serde(rename = "EndSec")]
    pub end_sec: u64,
    #[serde(rename = "Text")]
    pub text: String,
    #[serde(rename = "TransText")]
    pub trans_text: String,
}

#[derive(Debug, Deserialize)]
struct SubtitleItem {
    all_content: Vec<SubtitleContent>,
}

#[derive(Debug, Deserialize)]
struct SubtitleResponse {
    code: i64,
    list: Vec<SubtitleItem>,
}

impl ZjuRequestBuilder {
    fn new<U: IntoUrl + Clone>(
        client: ZjuAssist,
        method: Method,
        url: U,
        proxy_first: bool,
        follow_redirects: bool,
    ) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );

        let client_default = Client::builder()
            .cookie_provider(Arc::clone(&client.jar))
            .default_headers(headers.clone())
            .redirect(if follow_redirects {
                reqwest::redirect::Policy::default()
            } else {
                reqwest::redirect::Policy::none()
            })
            .build()
            .unwrap();

        let client_no_proxy = Client::builder()
            .cookie_provider(Arc::clone(&client.jar))
            .default_headers(headers)
            .redirect(if follow_redirects {
                reqwest::redirect::Policy::default()
            } else {
                reqwest::redirect::Policy::none()
            })
            .no_proxy()
            .build()
            .unwrap();
        if proxy_first {
            Self {
                request_builder_first: client_default.request(method.clone(), url.clone()),
                request_builder_second: client_no_proxy.request(method, url),
            }
        } else {
            Self {
                request_builder_first: client_no_proxy.request(method.clone(), url.clone()),
                request_builder_second: client_default.request(method, url),
            }
        }
    }

    pub fn headers(&mut self, headers: HeaderMap) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self
    }

    pub fn form<T: Serialize + ?Sized>(&mut self, form: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().form(form);
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().form(form);
        self
    }

    pub fn json<T: Serialize + ?Sized>(&mut self, json: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().json(json);
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().json(json);
        self
    }

    pub fn query<T: Serialize + ?Sized>(&mut self, query: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().query(query);
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .query(query);
        self
    }

    // For single-use credentials: retry the authentication flow, not this request.
    pub async fn send_once(&self) -> Result<Response, Error> {
        self.request_builder_first.try_clone().unwrap().send().await
    }

    pub fn body(&mut self, body: String) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .body(body.clone());
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().body(body);
        self
    }

    pub fn timeout(&mut self, timeout: Duration) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .timeout(timeout);
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .timeout(timeout);
        self
    }

    pub async fn send(&self) -> Result<Response, Error> {
        // total 6 retries, 3 with proxy, 3 without proxy
        let mut res = self.request_builder_first.try_clone().unwrap().send().await;
        let mut retries = 5;
        let mut delay_time = 100;

        while res.is_err() && retries > 0 {
            retries -= 1;
            // wait for 200ms before retry
            tokio::time::sleep(Duration::from_millis(delay_time)).await;
            if retries % 2 == 0 {
                res = self
                    .request_builder_second
                    .try_clone()
                    .unwrap()
                    .send()
                    .await;
            } else {
                res = self.request_builder_first.try_clone().unwrap().send().await;
            }
            delay_time *= 2;
        }

        res
    }
}

impl ZjuAssist {
    pub fn new() -> Self {
        Self {
            jar: Arc::new(Jar::default()),
            have_login: false,
            username: "".to_string(),
            password: "".to_string(),
            proxy_first: true,
            graduate_token: None,
        }
    }

    pub fn request<U: IntoUrl + Clone>(&self, method: Method, url: U) -> ZjuRequestBuilder {
        ZjuRequestBuilder::new(self.clone(), method, url, self.proxy_first, true)
    }

    pub fn get<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("GET {}", url.as_str());
        self.request(Method::GET, url)
    }

    pub fn post<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("POST {}", url.as_str());
        self.request(Method::POST, url)
    }

    pub fn get_username(&self) -> String {
        self.username.clone()
    }

    pub async fn test_connection(&mut self) -> Result<()> {
        let headers = HeaderMap::new();
        let client_default = Client::builder()
            .default_headers(headers.clone())
            .build()
            .unwrap();
        let client_no_proxy = Client::builder()
            .default_headers(headers)
            .no_proxy()
            .build()
            .unwrap();

        tokio::pin! {
            let latency_default = measure_latency(client_default, "https://zdbk.zju.edu.cn/");
            let latency_no_proxy = measure_latency(client_no_proxy, "https://zdbk.zju.edu.cn/");
        }

        let latency_default_result;
        let latency_no_proxy_result;

        tokio::select! {
            res = &mut latency_default => {
                if res.is_err() {
                    // if latency_default fail, wait for latency_no_proxy
                    latency_default_result = res;
                    latency_no_proxy_result = latency_no_proxy.await;
                } else {
                    // if latency_default success, no need to wait latency_no_proxy
                    info!("Latency default: {:?}", res);
                    self.proxy_first = true;
                    return Ok(());
                }
            },
            res = &mut latency_no_proxy => {
                if res.is_err() {
                    // if latency_no_proxy fail, wait for latency_default
                    latency_no_proxy_result = res;
                    latency_default_result = latency_default.await;
                } else {
                    // if latency_no_proxy success, no need to wait latency_default
                    info!("Latency no proxy: {:?}", res);
                    self.proxy_first = false;
                    return Ok(());
                }
            },
        }

        let latency_default = latency_default_result;
        let latency_no_proxy = latency_no_proxy_result;

        info!("Latency default: {:?}", latency_default);
        info!("Latency no proxy: {:?}", latency_no_proxy);

        if latency_default.is_err() && latency_no_proxy.is_err() {
            return Err(anyhow!("Connection failed"));
        }
        if latency_default.is_err() {
            self.proxy_first = false;
        } else if latency_no_proxy.is_err() {
            self.proxy_first = true;
        } else if latency_default.unwrap() < latency_no_proxy.unwrap() {
            self.proxy_first = true;
        } else {
            self.proxy_first = false;
        }

        info!("Proxy first: {}", self.proxy_first);
        Ok(())
    }

    fn request_without_redirects<U: IntoUrl + Clone>(
        &self,
        method: Method,
        url: U,
    ) -> ZjuRequestBuilder {
        ZjuRequestBuilder::new(self.clone(), method, url, self.proxy_first, false)
    }

    async fn login_graduate(&self) -> Result<String> {
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
                alternate.proxy_first = !self.proxy_first;
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

    pub async fn login(&mut self, username: &str, password: &str) -> Result<()> {
        if self.have_login {
            return Ok(());
        }

        let res = self
            .get("https://zjuam.zju.edu.cn/cas/login")
            .send()
            .await?;

        let mut text = res.text().await?;
        if !text.contains("统一身份认证平台") {
            self.logout();
            let res = self
                .get("https://zjuam.zju.edu.cn/cas/login")
                .send()
                .await?;
            text = res.text().await?;
            if !text.contains("统一身份认证平台") {
                return Err(anyhow!("Login failed"));
            }
        }
        let re = Regex::new(r#"<input type="hidden" name="execution" value="(.*?)" />"#).unwrap();
        let execution = re
            .captures(&text)
            .and_then(|cap| cap.get(1).map(|m| m.as_str()))
            .ok_or(anyhow!("Execution value not found"))?;
        let res = self
            .get("https://zjuam.zju.edu.cn/cas/v2/getPubKey")
            .send()
            .await?;

        let json: Value = res.json().await?;
        let modulus = json["modulus"]
            .as_str()
            .ok_or(anyhow!("Modulus not found"))?;
        let exponent = json["exponent"]
            .as_str()
            .ok_or(anyhow!("Exponent not found"))?;

        let rsapwd = rsa_no_padding(password, modulus, exponent);

        let data = [
            ("username", username),
            ("password", &rsapwd),
            ("execution", execution),
            ("_eventId", "submit"),
            ("authcode", ""),
        ];

        let res = self
            .post("https://zjuam.zju.edu.cn/cas/login")
            .form(&data)
            .send()
            .await?;

        if res.text().await?.contains("统一身份认证平台") {
            Err(anyhow!("Login failed: Wrong username or password"))
        } else {
            self.get("https://courses.zju.edu.cn/user/courses")
                .send()
                .await?;
            self.get("https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F")
                .send()
                .await?;
            self.post("https://zjuam.zju.edu.cn/cas/login?service=https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html")
                .send()
                .await?;
            self.graduate_token = Some(self.login_graduate().await?);
            self.have_login = true;
            self.username = username.to_string();
            self.password = password.to_string();

            Ok(())
        }
    }

    pub fn logout(&mut self) {
        self.graduate_token = None;
        self.jar = Arc::new(Jar::default());
        self.have_login = false;
        self.username = "".to_string();
        self.password = "".to_string();
    }

    pub async fn relogin(&mut self) -> Result<()> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let username = self.username.clone();
        let password = self.password.clone();
        let jar = Arc::clone(&self.jar);
        let graduate_token = self.graduate_token.clone();
        self.logout();
        let res = self.login(&username, &password).await;
        if res.is_err() {
            self.username = username;
            self.password = password;
            self.jar = jar;
            self.graduate_token = graduate_token;
            self.have_login = true;
        }
        res
    }

    pub fn is_login(&self) -> bool {
        self.have_login
    }

    // courses

    pub async fn get_courses(&self) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }

        let mut courses = Vec::new();
        let mut page = 1;
        loop {
            let payload = serde_json::json!({
                "fields": "id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,archived,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data,audience_type,graduate_method),user_stick_course_record(id),classroom_schedule",
                "page": page,
                "page_size": 100,
                "conditions": {
                    "status": ["ongoing", "notStarted", "closed"],
                    "keyword": "",
                    "classify_type": "recently_started",
                    "display_studio_list": false
                },
                "showScorePassedStatus": false
            });
            let res = self
                .post("https://courses.zju.edu.cn/api/my-courses")
                .json(&payload)
                .send()
                .await?;
            let json: Value = res.json().await?;
            let page_courses = json["courses"]
                .as_array()
                .ok_or_else(|| anyhow!("Courses not found in my-courses response"))?;
            let pages = json["pages"]
                .as_i64()
                .ok_or_else(|| anyhow!("Pages not found in my-courses response"))?;

            courses.extend(page_courses.iter().cloned());
            if page >= pages {
                break;
            }
            page += 1;
        }

        Ok(courses)
    }

    pub async fn get_activities_uploads(&self, course_id: i64) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let mut uploads = Vec::new();
        let res = self
            .get(format!(
                "https://courses.zju.edu.cn/api/courses/{}/activities",
                course_id
            ))
            .send()
            .await?;
        let json: Value = res.json().await?;
        let activities = json["activities"].as_array().unwrap();
        for activity in activities {
            if activity["uploads"].is_array() {
                for item in activity["uploads"].as_array().unwrap() {
                    let mut upload = item.clone();
                    upload["activity_id"] = activity["id"].clone();
                    uploads.push(upload);
                }
            }
        }
        Ok(uploads)
    }

    pub async fn get_homework_uploads(&self, course_id: i64) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let mut uploads = Vec::new();
        let res = self.get(format!("https://courses.zju.edu.cn/api/courses/{}/homework-activities?conditions=%7B%22itemsSortBy%22:%7B%22predicate%22:%22module%22,%22reverse%22:false%7D%7D&page=1&page_size=20&reloadPage=false", course_id))
            .send()
            .await?;
        let json: Value = res.json().await?;
        let homeworks = json["homework_activities"].as_array().unwrap();
        for homework in homeworks {
            if homework["uploads"].is_array() {
                uploads.extend(homework["uploads"].as_array().unwrap().iter().cloned());
            }
        }
        if json["pages"].as_i64().unwrap() > 1 {
            for page in 2..=json["pages"].as_i64().unwrap() {
                let res = self.get(format!("https://courses.zju.edu.cn/api/courses/{}/homework-activities?conditions=%7B%22itemsSortBy%22:%7B%22predicate%22:%22module%22,%22reverse%22:false%7D%7D&page={}&page_size=20&reloadPage=false", course_id, page))
                    .send()
                    .await?;
                let json: Value = res.json().await?;
                let homeworks = json["homework_activities"].as_array().unwrap();
                for homework in homeworks {
                    if homework["uploads"].is_array() {
                        uploads.extend(homework["uploads"].as_array().unwrap().iter().cloned());
                    }
                }
            }
        }
        Ok(uploads)
    }

    pub async fn download_file(
        &self,
        id: i64,
        reference_id: i64,
        name: &str,
        path: &str,
    ) -> Result<()> {
        let res = self
            .get(format!(
                "https://courses.zju.edu.cn/api/uploads/reference/{}/blob",
                reference_id
            ))
            .send()
            .await?;
        // if the upload is not allowed to download, then get the preview url
        let res = match res.status().is_success() {
            true => res,
            false => {
                self.get(format!(
                    "https://courses.zju.edu.cn/api/uploads/{}/blob",
                    id
                ))
                .send()
                .await?
            }
        };
        std::fs::create_dir_all(Path::new(path))?;
        let mut file = File::create(Path::new(path).join(name))?;
        let content = res.bytes().await?;
        file.write_all(&content)?;
        Ok(())
    }

    pub async fn get_uploads_response(&self, id: i64, reference_id: i64) -> Result<Response> {
        const MAX_RETRIES: usize = 5;
        let mut retries = 0;
        let mut delay_time = 100;

        while retries < MAX_RETRIES {
            let res = self
                .get(format!(
                    "https://courses.zju.edu.cn/api/uploads/reference/{}/blob",
                    reference_id
                ))
                .send()
                .await;
            // if the upload is not allowed to download, then get the preview url
            let res = match res {
                Ok(res) if res.status().is_success() => res,
                _ => {
                    self.get(format!(
                        "https://courses.zju.edu.cn/api/uploads/{}/blob",
                        id
                    ))
                    .send()
                    .await?
                }
            };
            if res.status().is_success() {
                return Ok(res);
            }
            tokio::time::sleep(Duration::from_millis(delay_time)).await;
            retries += 1;
            delay_time *= 2;
        }
        Err(anyhow!("Failed to get upload response"))
    }

    pub async fn get_academic_year_list(&self) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let res = self
            .get("https://courses.zju.edu.cn/api/my-academic-years?fields=id,name,sort,is_active")
            .send()
            .await?;
        let json: Value = res.json().await?;
        Ok(json["academic_years"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .collect())
    }

    pub async fn get_semester_list(&self) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let res = self
            .get("https://courses.zju.edu.cn/api/my-semesters?")
            .send()
            .await?;
        let json: Value = res.json().await?;
        Ok(json["semesters"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .collect())
    }

    pub async fn get_todo_list(&self) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let res = self
            .get("https://courses.zju.edu.cn/api/todos?no-intercept=true")
            .send()
            .await?;
        let json: Value = res.json().await?;
        Ok(json["todo_list"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .collect())
    }

    // classroom

    pub fn get_token(&self) -> Result<String> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        if let Some(cookies) = self
            .jar
            .cookies(&url::Url::parse("https://classroom.zju.edu.cn")?)
        {
            let cookie_str = percent_decode_str(cookies.to_str().unwrap())
                .decode_utf8_lossy()
                .to_string();
            let re = Regex::new(r#"\{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";\}"#).unwrap();
            let token = re
                .captures(&cookie_str)
                .and_then(|cap| cap.get(1).map(|m| m.as_str()))
                .ok_or(anyhow!("Token not found, try log in again"))?;
            Ok(token.to_string())
        } else {
            Err(anyhow!("Token not found, try log in again"))
        }
    }

    pub async fn keep_classroom_alive(&mut self) -> Result<()> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token();
        if let Err(_) = token {
            self.relogin().await?;
        }
        Ok(())
    }

    pub async fn get_month_subs(&self, month: &str) -> Result<Vec<Subject>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token()?;
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );
        headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());

        let mut subs = Vec::new();

        let res = self.get(format!("https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-month?month={}", month))
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let list = json["list"].as_array().unwrap();
        for day in list {
            let courses = day["course"].as_array().unwrap();
            for course in courses {
                let course_id = course["id"].as_str().unwrap().parse::<i64>().unwrap();
                let course_name = course["title"].as_str().unwrap().replace("/", "_");
                let sub_id = course["sub_id"].as_str().unwrap().parse::<i64>().unwrap();
                let sub_name = course["sub_title"].as_str().unwrap().replace("/", "_");
                let lecturer_name = course["realname"].as_str().unwrap().to_string();
                subs.push(Subject {
                    course_id,
                    course_name: course_name.clone(),
                    sub_id,
                    sub_name,
                    lecturer_name,
                    path: "".to_string(), // path will be set when downloading
                    ppt_image_urls: Vec::new(),
                });
            }
        }
        Ok(subs)
    }

    pub async fn get_range_subs(
        &self,
        start: &str, // format: 2021-05-01
        end: &str,
    ) -> Result<Vec<Subject>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token()?;
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );
        headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());

        let mut subs = Vec::new();

        // enumerate all days
        let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap();
        let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap();
        let mut date = start;
        while date <= end {
            let res = self.get(format!("https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day={}", date.format("%Y-%m-%d")))
                .headers(headers.clone())
                .send()
                .await?;
            let json: Value = res.json().await?;
            if let Some(list) = json["list"].as_object() {
                for data in list.values() {
                    let courses = data["course"].as_array().unwrap();
                    for course in courses {
                        let course_id = course["id"].as_str().unwrap().parse::<i64>().unwrap();
                        let course_name = course["title"].as_str().unwrap().replace("/", "_");
                        let sub_id = course["sub_id"].as_str().unwrap().parse::<i64>().unwrap();
                        let sub_name = course["sub_title"].as_str().unwrap().replace("/", "_");
                        let lecturer_name = course["realname"].as_str().unwrap().to_string();
                        subs.push(Subject {
                            course_id,
                            course_name: course_name.clone(),
                            sub_id,
                            sub_name,
                            lecturer_name,
                            path: "".to_string(), // path will be set when downloading
                            ppt_image_urls: Vec::new(),
                        });
                    }
                }
            }

            date = date + chrono::Duration::try_days(1).unwrap();
        }

        Ok(subs)
    }

    pub async fn search_courses(
        &self,
        course_name: &str,
        teacher_name: &str,
    ) -> Result<Vec<Value>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token()?;
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );
        headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());

        let res = self
            .get("https://classroom.zju.edu.cn/userapi/v1/infosimple")
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let account = json["params"]["account"].as_str().unwrap();
        let user_id = json["params"]["id"].as_i64().unwrap();
        let random: f64 = rand::random();

        let res = self.get(format!("https://classroom.zju.edu.cn/pptnote/v1/searchlist?tenant_id=112&user_id={}&user_name={}&page=1&per_page=16&title={}&realname={}&trans=&tenant_code=112&randomKey={}", user_id, account, course_name, teacher_name, random))
            .headers(headers.clone())
            .send()
            .await?;

        let mut courses = Vec::new();
        let json: Value = res.json().await?;

        // if code is not 0, then there is an error
        if json["code"].as_i64().unwrap() != 0 {
            let msg = json["msg"].as_str().unwrap();
            return Err(anyhow!(msg.to_string()));
        }

        courses.extend(json["total"]["list"].as_array().unwrap().iter().cloned());
        let mut page = 1;
        let total_course = json["total"]["total"].as_i64().unwrap();
        while courses.len() < total_course as usize {
            page += 1;
            let random: f64 = rand::random();
            let res = self.get(format!("https://classroom.zju.edu.cn/pptnote/v1/searchlist?tenant_id=112&user_id={}&user_name={}&page={}&per_page=16&title={}&realname={}&trans=&tenant_code=112&randomKey={}", user_id, account, page, course_name, teacher_name, random))
                .headers(headers.clone())
                .send()
                .await?;
            let json: Value = res.json().await?;
            courses.extend(json["total"]["list"].as_array().unwrap().iter().cloned());
        }

        Ok(courses)
    }

    pub async fn get_course_subs(&self, course_id: i64) -> Result<Vec<Subject>> {
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token()?;
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );
        headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());

        let res = self
            .get("https://classroom.zju.edu.cn/userapi/v1/infosimple")
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let account = json["params"]["account"].as_str().unwrap();

        let res = self.get(format!("https://yjapi.cmc.zju.edu.cn/courseapi/v3/multi-search/get-course-detail?course_id={}&student={}", course_id, account))
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let data = json["data"].as_object().unwrap();
        let course_name = data["title"].as_str().unwrap().replace("/", "_");
        let sub_list = data["sub_list"].as_object().unwrap();
        let mut subs = Vec::new();
        for (_, year_data) in sub_list {
            for (_, month_data) in year_data.as_object().unwrap() {
                for (_, week_data) in month_data.as_object().unwrap() {
                    for sub in week_data.as_array().unwrap() {
                        let sub_id = sub["id"].as_str().unwrap().parse::<i64>().unwrap();
                        let sub_name = sub["sub_title"].as_str().unwrap().replace("/", "_");
                        let lecturer_name = sub["lecturer_name"].as_str().unwrap().to_string();
                        subs.push(Subject {
                            course_id,
                            course_name: course_name.clone(),
                            sub_id,
                            sub_name,
                            lecturer_name,
                            path: "".to_string(), // path will be set when downloading
                            ppt_image_urls: Vec::new(),
                        });
                    }
                }
            }
        }
        Ok(subs)
    }

    fn get_auth_play_url(url: &str, id: &str, tenant_id: &str, phone: &str) -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let revers_phone = phone.chars().rev().collect::<String>();
        // t= id-timestamp-md5(uri+id+tenant_id+reverse(phone)+timestamp)
        let resource_url = Url::parse(url).unwrap().path().to_string();
        let key = format!(
            "{}-{}-{:x}",
            id,
            timestamp,
            md5::compute(format!(
                "{}{}{}{}{}",
                resource_url, id, tenant_id, revers_phone, timestamp
            ))
        );

        if url.contains("?") {
            format!("{}&t={}", url, key)
        } else {
            format!("{}?t={}", url, key)
        }
    }

    pub async fn get_playback_response(&self, course_id: i64, sub_id: i64) -> Result<Response> {
        let res = self
            .get(format!(
                "https://classroom.zju.edu.cn/courseapi/v3/portal-home-setting/get-sub-info?course_id={}&sub_id={}",
                course_id, sub_id
            ))
            .send()
            .await?;
        let json: Value = res.json().await?;
        let url = json["data"]["content"]["save_playback"]["contents"]
            .as_str()
            .unwrap();

        let res = self
            .get("https://classroom.zju.edu.cn/userapi/v1/infosimple")
            .send()
            .await?;
        let json: Value = res.json().await?;
        println!("{}", json["params"]);
        let id = json["params"]["id"].as_i64().unwrap().to_string();
        let tenant_id = json["params"]["tenant_id"].as_i64().unwrap().to_string();
        let phone = json["params"]["phone"].as_str().unwrap();

        let url = Self::get_auth_play_url(url, &id, &tenant_id, phone);
        let res = self.get(url).send().await?;

        Ok(res)
    }

    pub async fn get_ppt_urls(&self, course_id: i64, sub_id: i64) -> Result<Vec<String>> {
        let mut urls = Vec::new();
        let res = self.get(format!("https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id={}&sub_id={}&page=1&per_page=100", course_id, sub_id)).send()
            .await?;
        let json: Value = res.json().await?;
        let ppt_list = json["list"].as_array().unwrap();
        let mut page = 1;
        let total_ppt = json["total"].as_i64().unwrap();
        for ppt_content in ppt_list {
            let content: Value =
                serde_json::from_str(ppt_content["content"].as_str().unwrap()).unwrap();
            let url = content["pptimgurl"].as_str().unwrap();
            urls.push(url.to_string());
        }
        let mut retries = 5;
        while urls.len() < total_ppt as usize {
            page += 1;
            let res = self.get(format!("https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id={}&sub_id={}&page={}&per_page=100", course_id, sub_id, page)).send()
                .await?;
            let json: Value = res.json().await?;
            let should_have = min(100, total_ppt as usize - urls.len());
            let ppt_list = json["list"].as_array().unwrap();
            if ppt_list.len() != should_have {
                page -= 1;
                retries -= 1;
                if retries == 0 {
                    Err(anyhow!(
                        "Get ppt urls failed for course_id: {}, sub_id: {}, please retry later.",
                        course_id,
                        sub_id
                    ))?;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            for ppt_content in ppt_list {
                let content: Value =
                    serde_json::from_str(ppt_content["content"].as_str().unwrap()).unwrap();
                let url = content["pptimgurl"].as_str().unwrap();
                urls.push(url.to_string());
            }
        }
        Ok(urls)
    }

    pub async fn download_ppt_image(&self, url: &str, path: &str) -> Result<()> {
        const MAX_RETRIES: usize = 5;
        let mut retries = 0;
        let mut delay_time = 100;

        let file_path = match Path::new(path).extension() {
            Some(_) => Path::new(path).to_path_buf(),
            None => Path::new(path).join(url.split("/").last().unwrap()),
        };

        while retries < MAX_RETRIES {
            let res = self.get(url).send().await?;
            let content = res.bytes().await?;
            if content.is_empty() || image::guess_format(&content).is_err() {
                retries += 1;
                continue;
            }

            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut file = File::create(file_path.clone())?;
            file.write_all(&content)?;

            let metadata = file.metadata()?;
            if metadata.len() > 0 {
                return Ok(());
            } else {
                tokio::time::sleep(Duration::from_millis(delay_time)).await;
                retries += 1;
                delay_time *= 2;
            }
        }

        // clean up
        if file_path.exists() {
            std::fs::remove_file(file_path)?;
        }

        Err(anyhow!("Failed to download file after several attempts"))
    }

    // zdbk

    pub async fn check_undergraduate_evaluation_done(&mut self) -> Result<bool> {
        if !self.have_login {
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
            self.relogin().await?;

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
        if !self.have_login {
            return Err(anyhow!("Not login"));
        }
        for attempt in 0..2 {
            let token = self
                .graduate_token
                .as_deref()
                .ok_or_else(|| anyhow!("Not login"))?;
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
                    self.relogin().await?;
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

    fn undergraduate_auth_expired(status: u16, url: &Url, body: &str) -> bool {
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

    pub async fn get_undergraduate_score(&mut self) -> Result<Vec<Value>> {
        if !self.have_login {
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
                .timeout(Duration::from_secs(15))
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
            if Self::undergraduate_auth_expired(status.as_u16(), &url, &text) {
                if attempt == 0 {
                    self.relogin().await?;
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

    pub async fn get_subtitle(&self, sub_id: i64) -> Result<Vec<SubtitleContent>> {
        let url = format!(
            "https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id={}&format=json",
            sub_id
        );
        let res = self.get(&url).send().await?;
        let json: SubtitleResponse = res.json().await?;

        if json.code != 0 {
            return Err(anyhow!("获取字幕失败，错误代码: {}", json.code));
        }

        if let Some(item) = json.list.first() {
            Ok(item
                .all_content
                .iter()
                .map(|c| SubtitleContent {
                    begin_sec: c.begin_sec,
                    end_sec: c.end_sec,
                    text: c.text.clone(),
                    trans_text: c.trans_text.clone(),
                })
                .collect())
        } else {
            Ok(Vec::new())
        }
    }
}
