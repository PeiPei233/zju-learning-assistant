use super::{request::ZjuRequestBuilder, Service, ZjuAssist};
use anyhow::{anyhow, Result};
use reqwest::Response;
use serde_json::Value;
use std::{fs::File, io::Write, path::Path, time::Duration};

impl ZjuAssist {
    pub(super) async fn login_courses(&self) -> Result<String> {
        let response = self
            .get("https://courses.zju.edu.cn/user/courses")
            .send()
            .await
            .map_err(|error| error.without_url())?
            .error_for_status()
            .map_err(|error| error.without_url())?;
        let body = response.text().await.map_err(|error| error.without_url())?;
        if body.contains("统一身份认证平台") {
            return Err(anyhow!("登录已失效，请重试"));
        }
        Ok(String::new())
    }

    // Shared by the course list and its year/semester filters.
    async fn course_list_json(&self, request: &ZjuRequestBuilder) -> Result<Value> {
        for attempt in 0..2 {
            self.ensure_service(Service::Courses, attempt > 0).await?;
            if !self.is_login() {
                return Err(anyhow!("Not login"));
            }
            let response = request.send().await.map_err(|error| error.without_url())?;
            let status = response.status();
            let login_page = response.url().host_str() == Some("zjuam.zju.edu.cn")
                && response.url().path() == "/cas/login";
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("unknown")
                .to_owned();
            let body = response.text().await.map_err(|error| error.without_url())?;
            let expired = status == reqwest::StatusCode::UNAUTHORIZED
                || login_page
                || (body.contains("统一身份认证平台") && body.contains("name=\"execution\""));
            if expired {
                log::warn!(
                    "Course list authentication expired: HTTP {}, content-type {}",
                    status.as_u16(),
                    content_type
                );
                if attempt == 0 {
                    continue;
                }
                return Err(anyhow!("学在浙大登录已失效，请重新登录"));
            }
            if !status.is_success() {
                return Err(anyhow!(
                    "学在浙大请求失败（HTTP {}），请稍后重试",
                    status.as_u16()
                ));
            }
            return serde_json::from_str(&body).map_err(|error| {
                log::warn!("Invalid course list JSON: HTTP {}, content-type {}, bytes {}, line {}, column {}",
                    status.as_u16(), content_type, body.len(), error.line(), error.column());
                anyhow!("学在浙大返回内容异常（HTTP {}），请稍后重试", status.as_u16())
            });
        }
        unreachable!()
    }

    pub async fn get_courses(&self) -> Result<Vec<Value>> {
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
            let json = self
                .course_list_json(
                    self.post("https://courses.zju.edu.cn/api/my-courses")
                        .json(&payload),
                )
                .await?;
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
        self.ensure_service(Service::Courses, false).await?;
        if !self.is_login() {
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
        self.ensure_service(Service::Courses, false).await?;
        if !self.is_login() {
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
            .no_timeout()
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
                .no_timeout()
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
        self.ensure_service(Service::Courses, false).await?;
        const MAX_RETRIES: usize = 5;
        let mut retries = 0;
        let mut delay_time = 100;

        while retries < MAX_RETRIES {
            let res = self
                .get(format!(
                    "https://courses.zju.edu.cn/api/uploads/reference/{}/blob",
                    reference_id
                ))
                .no_timeout()
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
                    .no_timeout()
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
        let json = self
            .course_list_json(&self.get(
                "https://courses.zju.edu.cn/api/my-academic-years?fields=id,name,sort,is_active",
            ))
            .await?;
        json["academic_years"]
            .as_array()
            .cloned()
            .ok_or_else(|| anyhow!("学在浙大返回的课程筛选信息格式异常，请稍后重试"))
    }

    pub async fn get_semester_list(&self) -> Result<Vec<Value>> {
        let json = self
            .course_list_json(&self.get("https://courses.zju.edu.cn/api/my-semesters?"))
            .await?;
        json["semesters"]
            .as_array()
            .cloned()
            .ok_or_else(|| anyhow!("学在浙大返回的课程筛选信息格式异常，请稍后重试"))
    }

    pub async fn get_todo_list(&self) -> Result<Vec<Value>> {
        self.ensure_service(Service::Courses, false).await?;
        if !self.is_login() {
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
}
