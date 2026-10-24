use reqwest::cookie::Jar;
use std::sync::{atomic::AtomicBool, Arc};

#[derive(Clone)]
pub struct ZjuAssist {
    jar: Arc<Jar>,
    username: String,
    password: String,
    proxy_first: Arc<AtomicBool>,
    session: Arc<LoginSession>,
    credential_store: Arc<std::sync::Mutex<()>>,
}

mod request;
mod zjuam;
use zjuam::{LoginSession, Service};
mod classroom;
mod courses;
mod yjsy;
mod zdbk;
pub use classroom::SubtitleContent;

impl ZjuAssist {
    pub fn new() -> Self {
        Self {
            jar: Arc::new(Jar::default()),
            username: "".to_string(),
            password: "".to_string(),
            proxy_first: Arc::new(AtomicBool::new(true)),
            session: Arc::new(LoginSession::default()),
            credential_store: Arc::new(std::sync::Mutex::new(())),
        }
    }

    pub fn get_username(&self) -> String {
        self.username.clone()
    }
}
