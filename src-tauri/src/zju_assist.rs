use num_bigint::BigUint;
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::header::{HeaderMap, USER_AGENT};
use reqwest::Client;
use serde_json::Value;
use std::{fs::File, io::Write, path::Path};

pub struct ZjuAssist {
    client: Client,
    headers: HeaderMap,
    have_login: bool,
}

impl ZjuAssist {
    pub fn new() -> Self {
        let client = Client::builder().cookie_store(true).build().unwrap();

        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );

        Self {
            client,
            headers,
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
            .headers(self.headers.clone())
            .send()
            .await?;

        let text = res.text().await?;
        let re = Regex::new(r#"<input type="hidden" name="execution" value="(.*?)" />"#).unwrap();
        let execution = re
            .captures(&text)
            .and_then(|cap| cap.get(1).map(|m| m.as_str()))
            .ok_or("Execution value not found")?;

        let res = self
            .client
            .get("https://zjuam.zju.edu.cn/cas/v2/getPubKey")
            .headers(self.headers.clone())
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
            .headers(self.headers.clone())
            .form(&data)
            .send()
            .await?;

        if res.text().await?.contains("统一身份认证平台") {
            Err("Login failed".into())
        } else {
            self.client
                .get("https://courses.zju.edu.cn/user/courses")
                .headers(self.headers.clone())
                .send()
                .await?;
            self.have_login = true;
            Ok(())
        }
    }

    pub fn logout(&mut self) {
        self.client = Client::builder().cookie_store(true).build().unwrap();
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
            .headers(self.headers.clone())
            .send()
            .await?;

        let json: Value = res.json().await?;
        courses.extend(json["courses"].as_array().unwrap().iter().cloned());
        if json["pages"].as_i64().unwrap() > 1 {
            for page in 2..=json["pages"].as_i64().unwrap() {
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/my-courses?conditions=%7B%22status%22:%5B%22ongoing%22,%22notStarted%22%5D,%22keyword%22:%22%22,%22classify_type%22:%22recently_started%22,%22display_studio_list%22:false%7D&fields=id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data),user_stick_course_record(id),classroom_schedule&page={}&page_size=100&showScorePassedStatus=false", page))
                    .headers(self.headers.clone())
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
            .headers(self.headers.clone())
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
            .headers(self.headers.clone())
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
                    .headers(self.headers.clone())
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
            .headers(self.headers.clone())
            .send()
            .await?;
        let mut filename = name.to_string();
        // if the upload is not allowed to download, then get the preview url
        let res = match res.status().is_success() {
            true => res,
            false => {
                let res = self.client.get(format!("https://courses.zju.edu.cn/api/uploads/reference/document/{}/url?preview=true", reference_id))
                    .headers(self.headers.clone())
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
                self.client
                    .get(url)
                    .headers(self.headers.clone())
                    .send()
                    .await?
            }
        };
        std::fs::create_dir_all(Path::new(path))?;
        let mut file = File::create(Path::new(path).join(filename))?;
        let content = res.bytes().await?;
        file.write_all(&content)?;
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn download_uploads(
        &self,
        uploads: &[Value],
        path: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        for upload in uploads {
            let reference_id = upload["reference_id"].as_i64().unwrap();
            let name = upload["name"].as_str().unwrap();
            self.download_file(reference_id, name, path).await?;
        }
        Ok(())
    }

    pub async fn get_academic_year_list(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        if !self.have_login {
            return Err("Not login".into());
        }
        let res = self
            .client
            .get("https://courses.zju.edu.cn/api/my-academic-years?fields=id,name,sort,is_active")
            .headers(self.headers.clone())
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
            .headers(self.headers.clone())
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
}
