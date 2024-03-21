use log::{debug, info};
use num_bigint::BigUint;
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, Method, RequestBuilder, Response};
use reqwest::{Error, IntoUrl};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs::File, io::Write, path::Path};
use url::Url;

use crate::model::Subject;

#[derive(Clone)]
pub struct ZjuAssist {
    jar: Arc<Jar>,
    have_login: bool,
    username: String,
    password: String,
}

pub struct ZjuRequestBuilder {
    request_builder: RequestBuilder,
    request_builder_no_proxy: RequestBuilder,
}

impl ZjuRequestBuilder {
    fn new<U: IntoUrl + Clone>(client: ZjuAssist, method: Method, url: U) -> Self {
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
            .build()
            .unwrap();

        let client_no_proxy = Client::builder()
            .cookie_provider(Arc::clone(&client.jar))
            .default_headers(headers)
            .no_proxy()
            .build()
            .unwrap();

        Self {
            request_builder: client_default.request(method.clone(), url.clone()),
            request_builder_no_proxy: client_no_proxy.request(method, url),
        }
    }

    pub fn headers(&mut self, headers: HeaderMap) -> &mut Self {
        self.request_builder = self
            .request_builder
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self.request_builder_no_proxy = self
            .request_builder_no_proxy
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self
    }

    pub fn form<T: Serialize + ?Sized>(&mut self, form: &T) -> &mut Self {
        self.request_builder = self.request_builder.try_clone().unwrap().form(form);
        self.request_builder_no_proxy = self
            .request_builder_no_proxy
            .try_clone()
            .unwrap()
            .form(form);
        self
    }

    pub async fn send(&self) -> Result<Response, Error> {
        // total 6 retries, 3 with proxy, 3 without proxy
        let mut res = self.request_builder.try_clone().unwrap().send().await;
        let mut retries = 5;

        while res.is_err() && retries > 0 {
            retries -= 1;
            if retries % 2 == 0 {
                res = self
                    .request_builder_no_proxy
                    .try_clone()
                    .unwrap()
                    .send()
                    .await;
            } else {
                res = self.request_builder.try_clone().unwrap().send().await;
            }
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
        }
    }

    fn rsa_no_padding(src: &str, modulus: &str, exponent: &str) -> String {
        let m = BigUint::parse_bytes(modulus.as_bytes(), 16).unwrap();
        let e = BigUint::parse_bytes(exponent.as_bytes(), 16).unwrap();

        let input_nr = BigUint::from_bytes_be(src.as_bytes());

        let crypt_nr = input_nr.modpow(&e, &m);

        crypt_nr
            .to_bytes_be()
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect()
    }

    pub fn request<U: IntoUrl + Clone>(&self, method: Method, url: U) -> ZjuRequestBuilder {
        ZjuRequestBuilder::new(self.clone(), method, url)
    }

    pub fn get<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("GET {}", url.as_str());
        // self.client.get(url)
        self.request(Method::GET, url)
    }

    pub fn post<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("POST {}", url.as_str());
        // self.client.post(url)
        self.request(Method::POST, url)
    }

    pub async fn login(
        &mut self,
        username: &str,
        password: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
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
                return Err("Login failed".into());
            }
        }
        let re = Regex::new(r#"<input type="hidden" name="execution" value="(.*?)" />"#).unwrap();
        let execution = re
            .captures(&text)
            .and_then(|cap| cap.get(1).map(|m| m.as_str()))
            .ok_or("Execution value not found")?;
        let res = self
            .get("https://zjuam.zju.edu.cn/cas/v2/getPubKey")
            .send()
            .await?;

        let json: Value = res.json().await?;
        let modulus = json["modulus"].as_str().ok_or("Modulus not found")?;
        let exponent = json["exponent"].as_str().ok_or("Exponent not found")?;

        let rsapwd = Self::rsa_no_padding(password, modulus, exponent);

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
            Err("Login failed: Wrong username or password".into())
        } else {
            self.get("https://courses.zju.edu.cn/user/courses")
                .send()
                .await?;
            self
                .get("https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F")
                .send()
                .await?;
            self.post("https://zjuam.zju.edu.cn/cas/login?service=http://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html")
            .send()
            .await?;
            self.have_login = true;
            self.username = username.to_string();
            self.password = password.to_string();

            Ok(())
        }
    }

    pub fn logout(&mut self) {
        self.jar = Arc::new(Jar::default());
        self.have_login = false;
        self.username = "".to_string();
        self.password = "".to_string();
    }

    pub async fn relogin(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        let username = self.username.clone();
        let password = self.password.clone();
        let jar = Arc::clone(&self.jar);
        self.logout();
        let res = self.login(&username, &password).await;
        if res.is_err() {
            self.username = username;
            self.password = password;
            self.jar = jar;
            self.have_login = true;
        }
        res
    }

    pub fn is_login(&self) -> bool {
        self.have_login
    }

    pub async fn get_courses(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        let mut courses = Vec::new();
        let res = self.get("https://courses.zju.edu.cn/api/my-courses?conditions=%7B%22status%22:%5B%22ongoing%22,%22notStarted%22%5D,%22keyword%22:%22%22,%22classify_type%22:%22recently_started%22,%22display_studio_list%22:false%7D&fields=id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule&page=1&page_size=100&showScorePassedStatus=false")
            .send()
            .await?;

        let json: Value = res.json().await?;
        courses.extend(json["courses"].as_array().unwrap().iter().cloned());
        if json["pages"].as_i64().unwrap() > 1 {
            for page in 2..=json["pages"].as_i64().unwrap() {
                let res = self.get(format!("https://courses.zju.edu.cn/api/my-courses?conditions=%7B%22status%22:%5B%22ongoing%22,%22notStarted%22%5D,%22keyword%22:%22%22,%22classify_type%22:%22recently_started%22,%22display_studio_list%22:false%7D&fields=id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule&page={}&page_size=100&showScorePassedStatus=false", page))
                    .send()
                    .await?;

                let json: Value = res.json().await?;
                courses.extend(json["courses"].as_array().unwrap().iter().cloned());
            }
        }
        Ok(courses)
    }

    pub async fn get_activities_uploads(
        &self,
        course_id: i64,
    ) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
                uploads.extend(activity["uploads"].as_array().unwrap().iter().cloned());
            }
        }
        Ok(uploads)
    }

    pub async fn get_homework_uploads(
        &self,
        course_id: i64,
    ) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
        reference_id: i64,
        name: &str,
        path: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let res = self
            .get(format!(
                "https://courses.zju.edu.cn/api/uploads/reference/{}/blob",
                reference_id
            ))
            .send()
            .await?;
        let mut filename = name.to_string();
        // if the upload is not allowed to download, then get the preview url
        let res = match res.status().is_success() {
            true => res,
            false => {
                let res = self.get(format!("https://courses.zju.edu.cn/api/uploads/reference/document/{}/url?preview=true", reference_id))
                    .send()
                    .await?;
                let json: Value = res.json().await?;
                let url = json["url"].as_str().unwrap();
                if let Some(start) = url.find("name=") {
                    let start = start + 5;
                    let end = url[start..].find("&").unwrap_or(url.len() - start);
                    filename = percent_decode_str(&url[start..start + end])
                        .decode_utf8_lossy()
                        .to_string();
                }
                self.get(url).send().await?
            }
        };
        std::fs::create_dir_all(Path::new(path))?;
        let mut file = File::create(Path::new(path).join(filename))?;
        let content = res.bytes().await?;
        file.write_all(&content)?;
        Ok(())
    }

    pub async fn get_uploads_response(
        &self,
        reference_id: i64,
    ) -> Result<Response, Box<dyn std::error::Error>> {
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
                let res = self.get(format!("https://courses.zju.edu.cn/api/uploads/reference/document/{}/url?preview=true", reference_id))
                    .send()
                    .await?;
                let json: Value = res.json().await?;
                let url = json["url"].as_str().unwrap();
                self.get(url).send().await?
            }
        };

        Ok(res)
    }

    pub async fn get_academic_year_list(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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

    pub async fn get_semester_list(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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

    pub fn get_token(&self) -> Result<String, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
                .ok_or("Token not found, try log in again")?;
            Ok(token.to_string())
        } else {
            Err("Token not found, try log in again".into())
        }
    }

    pub async fn get_month_subs(
        &self,
        month: &str,
    ) -> Result<Vec<Subject>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
                subs.push(Subject {
                    course_id,
                    course_name: course_name.clone(),
                    sub_id,
                    sub_name,
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
    ) -> Result<Vec<Subject>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
                        subs.push(Subject {
                            course_id,
                            course_name: course_name.clone(),
                            sub_id,
                            sub_name,
                            path: "".to_string(), // path will be set when downloading
                            ppt_image_urls: Vec::new(),
                        });
                    }
                }
            }

            date = date + chrono::Duration::days(1);
        }

        Ok(subs)
    }

    pub async fn search_courses(
        &self,
        course_name: &str,
        teacher_name: &str,
    ) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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

    pub async fn get_course_subs(
        &self,
        course_id: i64,
    ) -> Result<Vec<Subject>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
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
                        subs.push(Subject {
                            course_id,
                            course_name: course_name.clone(),
                            sub_id,
                            sub_name,
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

    pub async fn get_playback_response(
        &self,
        course_id: i64,
        sub_id: i64,
    ) -> Result<Response, Box<dyn std::error::Error>> {
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

    pub async fn get_ppt_urls(
        &self,
        course_id: i64,
        sub_id: i64,
    ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
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
                    Err(format!("Get ppt urls failed for course_id: {}, sub_id: {}, please retry later.", course_id, sub_id))?;
                }
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

    pub async fn get_score(&mut self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
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
            ("time", "0"),
        ];

        let res = self.post(format!("http://zdbk.zju.edu.cn/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&gnmkdm=N5083&su={}", self.username))
            .form(&data)
            .send()
            .await?;
        let text = res.text().await?;
        let json = serde_json::from_str(&text);
        if json.is_err() {
            self.relogin().await?;

            let res = self.post(format!("http://zdbk.zju.edu.cn/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&gnmkdm=N5083&su={}", self.username))
                .form(&data)
                .send()
                .await?;
            let text = res.text().await?;
            debug!("{}", text);
            let json = serde_json::from_str(&text);
            if json.is_err() {
                return Err("Get score failed".into());
            }
            let json: Value = json.unwrap();
            let score = json["items"].as_array().unwrap();
            return Ok(score.iter().cloned().collect());
        }
        let json: Value = json.unwrap();
        let score = json["items"].as_array().unwrap();
        return Ok(score.iter().cloned().collect());
    }
}

pub async fn get<T: IntoUrl + Clone>(url: T) -> Result<Response, Error> {
    ZjuAssist::new().get(url).send().await
}

pub async fn download_ppt_image(url: &str, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    const MAX_RETRIES: usize = 5;
    let mut retries = 0;

    let file_path = match Path::new(path).extension() {
        Some(_) => Path::new(path).to_path_buf(),
        None => Path::new(path).join(url.split("/").last().unwrap()),
    };

    while retries < MAX_RETRIES {
        let res = get(url).await?;
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
            retries += 1;
        }
    }

    // clean up
    if file_path.exists() {
        std::fs::remove_file(file_path)?;
    }

    Err(Box::new(std::io::Error::new(
        std::io::ErrorKind::Other,
        "Failed to download file after several attempts",
    )))
}
