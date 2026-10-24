use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub save_path: String,
    pub to_pdf: bool,
    pub auto_download: bool,
    pub excluded_upload_extensions: Vec<String>,
    pub ding_url: String,
    pub ding_secret: String,
    pub score_auto_sync: bool,
    pub todo_auto_sync: bool,
    pub score_system_notification: bool,
    pub score_ding_notification: bool,
    pub todo_system_notification: bool,
    pub todo_ding_notification: bool,
    pub todo_reminder_minutes: Vec<u32>,
    pub auto_open_download_list: bool,
    pub auto_select_all_courseware: bool,
    pub theme: String,
    pub tray: bool,
    pub max_concurrent_tasks: u32,
    pub auto_start: bool,

    pub download_subtitle: bool,
    pub subtitle_language: Vec<String>,
    pub subtitle_format: String,
    pub subtitle_with_timestamps: bool,

    pub llm_enabled: bool,
    pub llm_api_base: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_temperature: f64,
    pub llm_prompt: String,
    pub llm_hide_think_tag: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            save_path: "Downloads".to_string(),
            to_pdf: true,
            auto_download: true,
            excluded_upload_extensions: Vec::new(),
            ding_url: String::new(),
            ding_secret: String::new(),
            score_auto_sync: true,
            todo_auto_sync: true,
            score_system_notification: true,
            score_ding_notification: false,
            todo_system_notification: true,
            todo_ding_notification: false,
            todo_reminder_minutes: vec![60],
            auto_open_download_list: false,
            auto_select_all_courseware: true,
            theme: "system".to_string(),
            tray: true,
            max_concurrent_tasks: 3,
            auto_start: false,

            download_subtitle: false,
            subtitle_language: vec!["zh".to_string()],
            subtitle_format: "srt".to_string(),
            subtitle_with_timestamps: true,

            llm_enabled: false,
            llm_api_base: String::new(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            llm_temperature: 0.2,
            llm_prompt: "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。".to_string(),
            llm_hide_think_tag: true,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Upload {
    pub course_id: i64,
    pub id: i64,
    pub reference_id: i64,
    pub file_name: String,
    pub course_name: String,
    pub path: String, // actual save path is path + file_name
    pub size: u64,
    pub activity_id: Option<i64>,
    pub allow_private_wps_office_view: bool,
}

#[derive(Clone, Serialize, Default)]
pub struct Progress {
    pub id: String,
    pub status: String,
    pub file_name: String,
    pub downloaded_size: u64,
    pub total_size: u64,
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

#[derive(Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub update_available: bool,
    pub can_install: bool,
    pub prepare_error: Option<String>,
    pub version: String,
    pub notes: String,
    pub notes_error: Option<String>,
    pub url: String,
}
