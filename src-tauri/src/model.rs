use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicBool, Arc};

pub struct DownloadState {
    pub should_cancel: Arc<AtomicBool>,
    pub save_path: Arc<std::sync::Mutex<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Uploads {
    pub reference_id: i64,
    pub file_name: String,
    pub path: String,   // actual save path is path + file_name
    pub size: u128,
}

#[derive(Clone, Serialize, Default)]
pub struct Progress {
    pub status: String,
    pub file_name: Option<String>,
    pub downloaded_size: Option<u128>,
    pub total_size: Option<u128>,
    pub current: Option<u128>,
    pub total: Option<u128>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Subject {
    pub course_id: i64,
    pub sub_id: i64,
    pub course_name: String,
    pub sub_name: String,
    pub path: String,   // actual save path is path + sub_name
    pub ppt_image_urls: Vec<String>,
}