use super::ZjuAssist;
use crate::utils::rsa_no_padding;
use anyhow::{anyhow, Result};
use regex::Regex;
use reqwest::cookie::{CookieStore, Jar};
use serde_json::Value;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub(super) enum Service {
    Courses,
    Classroom,
    Undergraduate,
    Graduate,
}

#[derive(Default)]
pub(super) struct ServiceLogin {
    result: Option<std::result::Result<String, String>>,
    completed: Option<Instant>,
}

#[derive(Default)]
pub(super) struct LoginSession {
    active: AtomicBool,
    authentication: Mutex<()>,
    courses: Mutex<ServiceLogin>,
    classroom: Mutex<ServiceLogin>,
    undergraduate: Mutex<ServiceLogin>,
    graduate: Mutex<ServiceLogin>,
}

impl ZjuAssist {
    pub async fn login(&mut self, username: &str, password: &str) -> Result<()> {
        if self.is_login() && self.username == username {
            return Ok(());
        }
        self.logout();
        tokio::time::timeout(
            Duration::from_secs(45),
            self.authenticate_cas(username, password),
        )
        .await
        .map_err(|_| anyhow!("登录超时，请重试"))??;
        self.username = username.to_owned();
        self.password = password.to_owned();
        self.session.active.store(true, Ordering::Release);
        Ok(())
    }

    async fn authenticate_cas(&self, username: &str, password: &str) -> Result<()> {
        let res = self
            .get("https://zjuam.zju.edu.cn/cas/login")
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| error.without_url())?
            .error_for_status()
            .map_err(|error| error.without_url())?;

        let text = res.text().await?;
        if !text.contains("统一身份认证平台") {
            // Reuse the existing SSO session; the service still validates its ticket.
            let has_sso_cookie = self
                .jar
                .cookies(&"https://zjuam.zju.edu.cn/cas/login".parse()?)
                .and_then(|cookies| {
                    cookies.to_str().ok().map(|value| {
                        value
                            .split(';')
                            .any(|cookie| cookie.trim().starts_with("iPlanetDirectoryPro="))
                    })
                })
                .unwrap_or(false);
            if self.is_login() && has_sso_cookie {
                return Ok(());
            }
            return Err(anyhow!("统一身份认证返回了异常页面，请重试"));
        }
        let re = Regex::new(r#"<input type="hidden" name="execution" value="(.*?)" />"#).unwrap();
        let execution = re
            .captures(&text)
            .and_then(|cap| cap.get(1).map(|m| m.as_str()))
            .ok_or(anyhow!("Execution value not found"))?;
        let res = self
            .get("https://zjuam.zju.edu.cn/cas/v2/getPubKey")
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| error.without_url())?
            .error_for_status()
            .map_err(|error| error.without_url())?;

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
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| error.without_url())?
            .error_for_status()
            .map_err(|error| error.without_url())?;

        if res.text().await?.contains("统一身份认证平台") {
            Err(anyhow!("Login failed: Wrong username or password"))
        } else {
            Ok(())
        }
    }

    pub fn save_auto_login(&self, enabled: bool) -> std::result::Result<(), String> {
        let _storage = self
            .credential_store
            .lock()
            .map_err(|error| error.to_string())?;
        if !self.is_login() {
            return Ok(());
        }
        let entry =
            keyring::Entry::new("zju-assist", "auto-login").map_err(|error| error.to_string())?;
        if enabled {
            entry
                .set_password(&format!("{}\n{}", self.username, self.password))
                .map_err(|error| error.to_string())
        } else {
            match entry.delete_password() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }
    }

    pub fn logout(&mut self) {
        self.session.active.store(false, Ordering::Release);
        self.session = Arc::new(LoginSession::default());
        self.jar = Arc::new(Jar::default());
        self.username.clear();
        self.password.clear();
    }

    pub fn is_login(&self) -> bool {
        self.session.active.load(Ordering::Acquire)
    }

    pub async fn connect_services(&self) {
        for service in [
            Service::Courses,
            Service::Classroom,
            Service::Undergraduate,
            Service::Graduate,
        ] {
            if !self.is_login() {
                break;
            }
            if let Err(error) = self.ensure_service(service, false).await {
                log::warn!("Background login {:?}: {}", service, error);
            }
        }
    }

    pub(super) async fn ensure_service(&self, service: Service, refresh: bool) -> Result<String> {
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        let requested = Instant::now();
        let state = match service {
            Service::Courses => &self.session.courses,
            Service::Classroom => &self.session.classroom,
            Service::Undergraduate => &self.session.undergraduate,
            Service::Graduate => &self.session.graduate,
        };
        // Hold the per-service lock through login so concurrent callers share its result.
        let mut state = state.lock().await;
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        if let Some(result) = &state.result {
            if (!refresh && result.is_ok()) || state.completed.is_some_and(|time| time >= requested)
            {
                return result.clone().map_err(anyhow::Error::msg);
            }
        }
        // CAS ticket requests share cookies. Serialize authentication, not API requests.
        let _authentication = self.session.authentication.lock().await;
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        let result = tokio::time::timeout(Duration::from_secs(45), async {
            if refresh || state.result.as_ref().is_some_and(|result| result.is_err()) {
                self.authenticate_cas(&self.username, &self.password)
                    .await?;
            }
            match service {
                Service::Courses => self.login_courses().await,
                Service::Classroom => self.login_classroom().await,
                Service::Undergraduate => self.login_undergraduate().await,
                Service::Graduate => self.login_graduate().await,
            }
        })
        .await
        .map_err(|_| anyhow!("连接超时，请重试"))
        .and_then(|result| result)
        .map_err(|error| error.to_string());
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        state.completed = Some(Instant::now());
        state.result = Some(result.clone());
        result.map_err(anyhow::Error::msg)
    }
}
