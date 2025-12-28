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

    #[serde(default)]
    pub llm_enabled: bool,
    pub llm_api_base: String,
    pub llm_api_key: String,
    pub llm_model: String,
    #[serde(default = "default_llm_temperature")]
    pub llm_temperature: f64,
    #[serde(default = "default_llm_prompt")]
    pub llm_prompt: String,
    #[serde(default)]
    pub llm_hide_think_tag: bool,
}

fn default_subtitle_language() -> Vec<String> {
    vec!["zh".to_string()]
}

fn default_subtitle_format() -> String {
    "srt".to_string()
}

fn default_llm_temperature() -> f64 {
    0.2
}
fn default_llm_prompt() -> String {
    "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。".to_string()
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
