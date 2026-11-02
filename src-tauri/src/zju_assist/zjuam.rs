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
    time::Instant,
};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub(super) enum Service {
    Courses,
    Classroom,
    Zdbk,
    Yjsy,
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
    zdbk: Mutex<ServiceLogin>,
    yjsy: Mutex<ServiceLogin>,
}

impl ZjuAssist {
    pub async fn login(&mut self, username: &str, password: &str) -> Result<()> {
        if self.is_login() && self.username == username {
            return Ok(());
        }
        self.logout();
        // Race only the login page, with independent CAS cookies for each route.
        let attempts = [true, false].map(|proxy_first| {
            let mut candidate = self.clone();
            candidate.jar = Arc::new(Jar::default());
            candidate.proxy_first = Arc::new(AtomicBool::new(proxy_first));
            Box::pin(async move {
                let execution = candidate
                    .get_cas_execution(true)
                    .await?
                    .ok_or_else(|| anyhow!("Execution value not found"))?;
                Ok::<_, anyhow::Error>((candidate, execution))
            })
        });
        let ((candidate, execution), _) = futures::future::select_ok(attempts).await?;
        self.jar = candidate.jar;
        self.proxy_first.store(
            candidate.proxy_first.load(Ordering::Relaxed),
            Ordering::Relaxed,
        );
        self.authenticate_cas(username, password, Some(execution))
            .await?;
        self.username = username.to_owned();
        self.password = password.to_owned();
        self.session.active.store(true, Ordering::Release);
        Ok(())
    }

    async fn get_cas_execution(&self, single_attempt: bool) -> Result<Option<String>> {
        let request = self.get("https://zjuam.zju.edu.cn/cas/login");
        let res = if single_attempt {
            request.send_once().await
        } else {
            request.send().await
        }
        .and_then(|response| response.error_for_status())
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
                return Ok(None);
            }
            return Err(anyhow!("统一身份认证返回了异常页面，请重试"));
        }
        let re = Regex::new(r#"<input type="hidden" name="execution" value="(.*?)" />"#).unwrap();
        let execution = re
            .captures(&text)
            .and_then(|cap| cap.get(1).map(|m| m.as_str().to_owned()))
            .filter(|value| !value.is_empty())
            .ok_or(anyhow!("Execution value not found"))?;
        Ok(Some(execution))
    }

    async fn authenticate_cas(
        &self,
        username: &str,
        password: &str,
        execution: Option<String>,
    ) -> Result<()> {
        let execution = match execution {
            Some(execution) => execution,
            None => match self.get_cas_execution(false).await? {
                Some(execution) => execution,
                None => return Ok(()),
            },
        };
        let res = self
            .get("https://zjuam.zju.edu.cn/cas/v2/getPubKey")
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
            ("execution", execution.as_str()),
            ("_eventId", "submit"),
            ("authcode", ""),
        ];

        let res = self
            .post("https://zjuam.zju.edu.cn/cas/login")
            .form(&data)
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
            Service::Zdbk,
            Service::Yjsy,
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
            Service::Zdbk => &self.session.zdbk,
            Service::Yjsy => &self.session.yjsy,
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
        let result = async {
            if refresh || state.result.as_ref().is_some_and(|result| result.is_err()) {
                self.authenticate_cas(&self.username, &self.password, None)
                    .await?;
            }
            match service {
                Service::Courses => self.login_courses().await,
                Service::Classroom => self.login_classroom().await,
                Service::Zdbk => self.login_zdbk().await,
                Service::Yjsy => self.login_yjsy().await,
            }
        }
        .await
        .map_err(|error| error.to_string());
        if !self.is_login() {
            return Err(anyhow!("Not login"));
        }
        state.completed = Some(Instant::now());
        state.result = Some(result.clone());
        result.map_err(anyhow::Error::msg)
    }
}
