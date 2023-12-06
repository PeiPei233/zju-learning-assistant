use bytes::Bytes;
use futures::Stream;
use num_bigint::BigUint;
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, AUTHORIZATION, USER_AGENT};
use reqwest::Client;
use reqwest::Error;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::{fs::File, io::Write, path::Path};

use crate::model::Subject;

pub struct ZjuAssist {
    client: Client,
    jar: Arc<Jar>,
    have_login: bool,
}

impl ZjuAssist {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );

        let jar = Arc::new(Jar::default());
        let client = Client::builder()
            .cookie_provider(Arc::clone(&jar))
            .default_headers(headers)
            .build()
            .unwrap();

        Self {
            client,
            jar,
            have_login: false,
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

    pub async fn login(
        &mut self,
        username: &str,
        password: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if self.have_login {
            return Ok(());
        }

        let res = self
            .client
            .get("https://zjuam.zju.edu.cn/cas/login")
            .send()
            .await?;

        let mut text = res.text().await?;
        if !text.contains("统一身份认证平台") {
            self.logout();
            let res = self
                .client
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
            .client
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
            ("geolocation", ""),
        ];

        let res = self
            .client
            .post("https://zjuam.zju.edu.cn/cas/login")
            .form(&data)
            .send()
            .await?;

        if res.text().await?.contains("统一身份认证平台") {
            Err("Login failed".into())
        } else {
            self.client
                .get("https://courses.zju.edu.cn/user/courses")
                .send()
                .await?;
            self.client
                .get("https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F")
                .send()
                .await?;
            self.have_login = true;
            Ok(())
        }
    }

    pub fn logout(&mut self) {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );
        let jar = Arc::new(Jar::default());
        self.client = Client::builder()
            .cookie_provider(Arc::clone(&jar))
            .default_headers(headers)
            .build()
            .unwrap();
        self.jar = jar;
        self.have_login = false;
    }

    pub fn is_login(&self) -> bool {
        self.have_login
    }

    pub async fn get_courses(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        let mut courses = Vec::new();
        let res = self.client.get("https://courses.zju.edu.cn/api/my-courses?conditions=%7B%22status%22:%5B%22ongoing%22,%22notStarted%22%5D,%22keyword%22:%22%22,%22classify_type%22:%22recently_started%22,%22display_studio_list%22:false%7D&fields=id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule&page=1&page_size=100&showScorePassedStatus=false")
            .send()
            .await?;

        let json: Value = res.json().await?;
        courses.extend(json["courses"].as_array().unwrap().iter().cloned());
        if json["pages"].as_i64().unwrap() > 1 {
            for page in 2..=json["pages"].as_i64().unwrap() {
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/my-courses?conditions=%7B%22status%22:%5B%22ongoing%22,%22notStarted%22%5D,%22keyword%22:%22%22,%22classify_type%22:%22recently_started%22,%22display_studio_list%22:false%7D&fields=id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule&page={}&page_size=100&showScorePassedStatus=false", page))
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
            .client
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
        let res = self.client.get(format!("https://courses.zju.edu.cn/api/courses/{}/homework-activities?conditions=%7B%22itemsSortBy%22:%7B%22predicate%22:%22module%22,%22reverse%22:false%7D%7D&page=1&page_size=20&reloadPage=false", course_id))
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
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/courses/{}/homework-activities?conditions=%7B%22itemsSortBy%22:%7B%22predicate%22:%22module%22,%22reverse%22:false%7D%7D&page={}&page_size=20&reloadPage=false", course_id, page))
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
            .client
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
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/uploads/reference/document/{}/url?preview=true", reference_id))
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
                self.client.get(url).send().await?
            }
        };
        std::fs::create_dir_all(Path::new(path))?;
        let mut file = File::create(Path::new(path).join(filename))?;
        let content = res.bytes().await?;
        file.write_all(&content)?;
        Ok(())
    }

    pub async fn get_uploads_stream_and_path(
        &self,
        reference_id: i64,
        name: &str,
        path: &str,
    ) -> Result<(impl Stream<Item = Result<Bytes, Error>>, PathBuf), Box<dyn std::error::Error>>
    {
        let res = self
            .client
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
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/uploads/reference/document/{}/url?preview=true", reference_id))
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
                self.client.get(url).send().await?
            }
        };
        std::fs::create_dir_all(Path::new(path))?;
        let filepath = Path::new(path).join(filename);
        let content = res.bytes_stream();
        Ok((content, filepath))
    }

    pub async fn get_academic_year_list(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        let res = self
            .client
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
            .client
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
                .ok_or("Token not found")?;
            Ok(token.to_string())
        } else {
            Err("Token not found".into())
        }
    }

    pub async fn get_month_subs(
        &self,
        month: &str,
        path: &str,
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
        let path = Path::new(path);

        let res = self.client.get(format!("https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-month?month={}", month))
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
                    path: path.join(&course_name).to_str().unwrap().to_string(),
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
        path: &str,
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
        let path = Path::new(path);

        // enumerate all days
        let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap();
        let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap();
        let mut date = start;
        while date <= end {
            let res = self.client.get(format!("https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day={}", date.format("%Y-%m-%d")))
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
                            path: path.join(&course_name).to_str().unwrap().to_string(),
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
            .client
            .get("https://classroom.zju.edu.cn/userapi/v1/infosimple")
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let account = json["params"]["account"].as_str().unwrap();
        let user_id = json["params"]["id"].as_i64().unwrap();
        let random: f64 = rand::random();

        let res = self.client.get(format!("https://classroom.zju.edu.cn/pptnote/v1/searchlist?tenant_id=112&user_id={}&user_name={}&page=1&per_page=16&title={}&realname={}&trans=&tenant_code=112&randomKey={}", user_id, account, course_name, teacher_name, random))
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
            let res = self.client.get(format!("https://classroom.zju.edu.cn/pptnote/v1/searchlist?tenant_id=112&user_id={}&user_name={}&page={}&per_page=16&title={}&realname={}&trans=&tenant_code=112&randomKey={}", user_id, account, page, course_name, teacher_name, random))
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
        path: &str,
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
            .client
            .get("https://classroom.zju.edu.cn/userapi/v1/infosimple")
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let account = json["params"]["account"].as_str().unwrap();

        let res = self.client.get(format!("https://yjapi.cmc.zju.edu.cn/courseapi/v3/multi-search/get-course-detail?course_id={}&student={}", course_id, account))
            .headers(headers.clone())
            .send()
            .await?;
        let json: Value = res.json().await?;
        let data = json["data"].as_object().unwrap();
        let course_name = data["title"].as_str().unwrap().replace("/", "_");
        let sub_list = data["sub_list"].as_object().unwrap();
        let path = Path::new(path);
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
                            path: path.join(&course_name).to_str().unwrap().to_string(),
                            ppt_image_urls: Vec::new(),
                        });
                    }
                }
            }
        }
        Ok(subs)
    }
}

pub async fn get_ppt_urls(
    course_id: i64,
    sub_id: i64,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut urls = Vec::new();
    let res = reqwest::get(format!("https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id={}&sub_id={}&page=1&per_page=100", course_id, sub_id))
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
    while urls.len() < total_ppt as usize {
        page += 1;
        let res = reqwest::get(format!("https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id={}&sub_id={}&page={}&per_page=100", course_id, sub_id, page))
            .await?;
        let json: Value = res.json().await?;
        let ppt_list = json["list"].as_array().unwrap();
        for ppt_content in ppt_list {
            let content: Value =
                serde_json::from_str(ppt_content["content"].as_str().unwrap()).unwrap();
            let url = content["pptimgurl"].as_str().unwrap();
            urls.push(url.to_string());
        }
    }
    Ok(urls)
}

pub async fn download_ppt_image(url: &str, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    const MAX_RETRIES: usize = 5;
    let mut retries = 0;

    let file_path = Path::new(path).join(
        percent_decode_str(url.split('/').last().unwrap())
            .decode_utf8_lossy()
            .to_string(),
    );
    while retries < MAX_RETRIES {
        let res = reqwest::get(url).await?;
        let content = res.bytes().await?;
        if content.is_empty() {
            retries += 1;
            continue;
        }

        std::fs::create_dir_all(Path::new(path))?;
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
