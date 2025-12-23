use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    pub save_path: String,
    pub to_pdf: bool,
    pub auto_download: bool,
    pub ding_url: String,
    pub auto_open_download_list: bool,
    pub tray: bool,
    pub max_concurrent_tasks: u32,
    pub auto_start: bool,

    #[serde(default)]
    pub auto_download_subtitle: bool,
    #[serde(default = "default_subtitle_language")]
    pub subtitle_language: Vec<String>,
    #[serde(default = "default_subtitle_format")]
    pub subtitle_format: String,
    #[serde(default)]
    pub subtitle_with_timestamps: bool,
}

fn default_subtitle_language() -> Vec<String> {
    vec!["zh".to_string()]
}

fn default_subtitle_format() -> String {
    "srt".to_string()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Upload {
    pub id: i64,
    pub reference_id: i64,
    pub file_name: String,
    pub course_name: String,
    pub path: String, // actual save path is path + file_name
    pub size: u64,
}

#[derive(Clone, Serialize, Default)]
pub struct Progress {
    pub id: String,
    pub status: String,
    pub file_name: String,
    pub downloaded_size: u64,
    pub total_size: u64,
    #[serde(default)]
    pub msg: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Subject {
    pub course_id: i64,
    pub sub_id: i64,
    pub course_name: String,
    pub sub_name: String,
    pub lecturer_name: String,
    pub path: String, // actual save path is path + sub_name
    pub ppt_image_urls: Vec<String>,
}
