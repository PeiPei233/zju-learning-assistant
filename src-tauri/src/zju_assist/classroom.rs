use super::{Service, ZjuAssist};
use crate::model::Subject;
use anyhow::{anyhow, Result};
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::{
    cookie::CookieStore,
    header::{HeaderMap, AUTHORIZATION, USER_AGENT},
    Response,
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    cmp::min,
    fs::File,
    io::Write,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

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

impl ZjuAssist {
    pub(super) async fn login_classroom(&self) -> Result<String> {
        let response = self.get("https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F")
            .timeout(Duration::from_secs(15)).send().await.map_err(|error| error.without_url())?
            .error_for_status().map_err(|error| error.without_url())?;
        let body = response.text().await.map_err(|error| error.without_url())?;
        if body.contains("统一身份认证平台") {
            return Err(anyhow!("登录已失效，请重试"));
        }
        self.get_token()?;
        Ok(String::new())
    }

    pub fn get_token(&self) -> Result<String> {
        if !self.is_login() {
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
        self.ensure_service(Service::Classroom, false).await?;
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        let token = self.get_token();
        if let Err(_) = token {
            self.ensure_service(Service::Classroom, true).await?;
        }
        Ok(())
    }

    pub async fn get_month_subs(&self, month: &str) -> Result<Vec<Subject>> {
        self.ensure_service(Service::Classroom, false).await?;
        if !self.is_login() {
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
        self.ensure_service(Service::Classroom, false).await?;
        if !self.is_login() {
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
        self.ensure_service(Service::Classroom, false).await?;
        if !self.is_login() {
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
        self.ensure_service(Service::Classroom, false).await?;
        if !self.is_login() {
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
        self.ensure_service(Service::Classroom, false).await?;
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
        self.ensure_service(Service::Classroom, false).await?;
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

    pub async fn get_subtitle(&self, sub_id: i64) -> Result<Vec<SubtitleContent>> {
        self.ensure_service(Service::Classroom, false).await?;
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
