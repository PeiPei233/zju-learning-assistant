// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod zju_assist;

use fern::Dispatch;
use futures::TryStreamExt;
use log::LevelFilter;
use log::{debug, error, info, trace, warn};
use reqwest::header::{HeaderMap, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    process::Command,
    sync::{atomic::AtomicBool, Arc},
};
use tauri::{Manager, State, Window};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use zju_assist::ZjuAssist;

struct DownloadState {
    should_cancel: Arc<AtomicBool>,
    save_path: Arc<std::sync::Mutex<String>>,
}

#[tauri::command]
async fn login(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    username: String,
    password: String,
) -> Result<(), String> {
    info!("login: {}", username);
    let mut zju_assist = state.lock().await;
    zju_assist
        .login(&username, &password)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn check_login(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<bool, String> {
    info!("check_login");
    let zju_assist = state.lock().await;
    match zju_assist.is_login() {
        true => Ok(true),
        false => Err("Not login".to_string()),
    }
}

#[tauri::command]
async fn logout(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<(), String> {
    info!("logout");
    let mut zju_assist = state.lock().await;
    zju_assist.logout();
    Ok(())
}

#[tauri::command]
async fn get_courses(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
    info!("get_courses");
    let zju_assist = state.lock().await;
    zju_assist
        .get_courses()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_academic_year_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<Vec<Value>, String> {
    info!("get_academic_year_list");
    let zju_assist = state.lock().await;
    zju_assist
        .get_academic_year_list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_semester_list(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
    info!("get_semester_list");
    let zju_assist = state.lock().await;
    zju_assist
        .get_semester_list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_activities_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_id: i64,
) -> Result<Vec<Value>, String> {
    info!("get_activities_uploads: {}", course_id);
    let zju_assist = state.lock().await;
    zju_assist
        .get_activities_uploads(course_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_homework_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_id: i64,
) -> Result<Vec<Value>, String> {
    info!("get_homework_uploads: {}", course_id);
    let zju_assist = state.lock().await;
    zju_assist
        .get_homework_uploads(course_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn download_file(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    reference_id: i64,
    file_name: String,
    path: String,
) -> Result<(), String> {
    info!("download_file: {}", reference_id);
    let zju_assist = state.lock().await;
    zju_assist
        .download_file(reference_id, &file_name, &path)
        .await
        .map_err(|err| err.to_string())
}

#[derive(Clone, Serialize, Deserialize)]
struct Uploads {
    reference_id: i64,
    file_name: String,
    path: String,
    size: u128,
}

#[derive(Clone, Serialize, Default)]
struct Progress {
    status: String,
    file_name: Option<String>,
    downloaded_size: Option<u128>,
    total_size: Option<u128>,
    current: Option<u128>,
    total: Option<u128>,
}

#[tauri::command]
async fn get_uploads_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    courses: Value,
) -> Result<Vec<Uploads>, String> {
    info!("get_uploads_list");
    let zju_assist = state.lock().await;
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut all_uploads = Vec::new();
    for course in courses.as_array().unwrap() {
        let course_id = course["id"].as_i64().unwrap();
        let course_name = course["name"].as_str().unwrap().replace("/", "-");
        info!("get_uploads_list: course - {} {}", course_id, course_name);
        let activities_uploads = zju_assist
            .get_activities_uploads(course_id)
            .await
            .map_err(|err| err.to_string())?;
        for upload in activities_uploads {
            let reference_id = upload["reference_id"].as_i64().unwrap();
            let file_name = upload["name"].as_str().unwrap().to_string();
            let path = Path::new(&save_path)
                .join(&course_name)
                .to_str()
                .unwrap()
                .to_string();
            let size = upload["size"].as_u64().unwrap_or(1000) as u128;
            info!(
                "get_uploads_list: uploads - {} {} {} {}",
                reference_id, file_name, path, size
            );
            all_uploads.push(Uploads {
                reference_id,
                file_name,
                path,
                size,
            });
        }
    }
    Ok(all_uploads)
}

#[tauri::command]
async fn download_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    window: Window,
    uploads: Vec<Uploads>,
) -> Result<Vec<Uploads>, String> {
    info!("download_uploads");
    let zju_assist = state.lock().await;
    let total_size = uploads.iter().map(|upload| upload.size).sum::<u128>();
    let mut downloaded_size: u128 = 0;
    for (i, upload) in uploads.iter().enumerate() {
        info!(
            "download_uploads: start {} {} {} {}",
            i, upload.reference_id, upload.file_name, upload.path
        );
        if download_state
            .should_cancel
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            download_state
                .should_cancel
                .store(false, std::sync::atomic::Ordering::SeqCst);
            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "cancel".to_string(),
                        ..Default::default()
                    },
                )
                .unwrap();
            info!("download_uploads: cancel");
            return Ok(uploads[0..i].to_vec());
        }
        let (mut stream, filepath) = zju_assist
            .get_uploads_stream_and_path(upload.reference_id, &upload.file_name, &upload.path)
            .await
            .map_err(|err| err.to_string())?;
        info!(
            "download_uploads: stream {} {} {:?}",
            i, upload.reference_id, filepath
        );
        let mut file = tokio::fs::File::create(filepath.clone())
            .await
            .map_err(|e| e.to_string())?;
        let mut current_size: u128 = 0;
        while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
            if download_state
                .should_cancel
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                download_state
                    .should_cancel
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                window
                    .emit(
                        "download-progress",
                        Progress {
                            status: "cancel".to_string(),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                // clean up
                tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string())?;
                return Ok(uploads[0..i].to_vec());
            }

            let chunk = item;
            current_size += chunk.len() as u128;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;

            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "downloading".to_string(),
                        file_name: Some(
                            filepath.file_name().unwrap().to_str().unwrap().to_string(),
                        ),
                        downloaded_size: Some(downloaded_size + current_size),
                        total_size: Some(total_size),
                        current: Some(i as u128 + 1),
                        total: Some(uploads.len() as u128),
                    },
                )
                .unwrap();
        }
        downloaded_size += upload.size;
        info!(
            "download_uploads: done {} {} {}",
            i, upload.reference_id, upload.file_name
        );
    }
    window
        .emit(
            "download-progress",
            Progress {
                status: "done".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
    info!("download_uploads: done");
    Ok(uploads)
}

#[tauri::command]
fn cancel_download(state: State<'_, DownloadState>) -> Result<(), String> {
    info!("cancel_download");
    let should_cancel = state.should_cancel.clone();
    should_cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn update_path(
    state: State<'_, DownloadState>,
    path: String,
    uploads: Vec<Uploads>,
) -> Result<Vec<Uploads>, String> {
    info!("update_path: {}", path);
    let mut new_uploads = Vec::new();
    for upload in uploads {
        let new_path = Path::new(&path)
            .join(
                Path::new(&upload.path)
                    .file_name()
                    .unwrap_or_default()
                    .to_str()
                    .unwrap(),
            )
            .to_str()
            .unwrap()
            .to_string();
        new_uploads.push(Uploads {
            reference_id: upload.reference_id,
            file_name: upload.file_name,
            path: new_path,
            size: upload.size,
        });
    }

    let mut save_path = state.save_path.lock().unwrap();
    *save_path = path;

    Ok(new_uploads)
}

#[tauri::command]
fn open_save_path(state: State<'_, DownloadState>) -> Result<(), String> {
    info!("open_save_path");
    let save_path = state.save_path.lock().unwrap().clone();
    if Path::new(&save_path).exists() {
        #[cfg(target_os = "windows")]
        Command::new("explorer")
            .arg(save_path)
            .spawn()
            .map_err(|err| err.to_string())?;

        #[cfg(target_os = "macos")]
        Command::new("open")
            .arg(save_path)
            .spawn()
            .map_err(|err| err.to_string())?;

        #[cfg(target_os = "linux")]
        Command::new("xdg-open")
            .arg(save_path)
            .spawn()
            .map_err(|err| err.to_string())?;

        Ok(())
    } else {
        Err("下载已删除或未下载".to_string())
    }
}

#[tauri::command]
async fn get_latest_version_info() -> Result<Value, String> {
    info!("get_latest_version_info");
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
            .parse()
            .unwrap(),
    );

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap();

    let res = client
        .get("https://api.github.com/repos/PeiPei233/zju-learning-assistant/releases/latest")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let json = res.json::<Value>().await.map_err(|err| err.to_string())?;

    info!("get_latest_version_info: {:?}", json.get("tag_name"));

    Ok(json)
}

fn setup_logging(to_file: bool) -> Result<(), fern::InitError> {
    let mut base_config = Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{}[{}][{}] {}",
                chrono::Local::now().format("[%Y-%m-%d][%H:%M:%S]"),
                record.target(),
                record.level(),
                message
            ))
        })
        .level(LevelFilter::Info);

    base_config = if to_file {
        base_config
            .chain(std::io::stdout())
            .chain(fern::log_file("zju-learning-assistant.log")?)
    } else {
        base_config.chain(std::io::stdout())
    };

    base_config.apply()?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            match app.get_cli_matches() {
                Ok(matches) => {
                    println!("{:?}", matches);
                    if matches.args.contains_key("debug") && matches.args["debug"].value.as_bool() == Some(true) {
                        setup_logging(true).expect("Failed to setup logging");
                    } else {
                        setup_logging(false).expect("Failed to setup logging");
                    }
                }
                Err(_) => {}
            }
            let zju_assist = Arc::new(Mutex::new(ZjuAssist::new()));
            app.manage(zju_assist);
            let download_state = DownloadState {
                should_cancel: Arc::new(AtomicBool::new(false)),
                save_path: Arc::new(std::sync::Mutex::new("Downloads".to_string())),
            };
            app.manage(download_state);
            let version = app.config().package.version.clone();
            info!("Current version: {:?}", version);

            if let Ok(os) = sys_info::os_type() {
                info!("Operating System: {}", os);
            }
            if let Ok(version) = sys_info::os_release() {
                info!("OS Version: {}", version);
            }

            info!("Rust version: {}", rustc_version_runtime::version());

            if let Ok(mem) = sys_info::mem_info() {
                info!("Total Memory: {} KB", mem.total);
            }

            if let Ok(path) = std::env::current_dir() {
                info!("Current path: {}", path.display());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            check_login,
            logout,
            get_courses,
            get_academic_year_list,
            get_semester_list,
            get_activities_uploads,
            get_homework_uploads,
            download_file,
            get_uploads_list,
            download_uploads,
            cancel_download,
            update_path,
            open_save_path,
            get_latest_version_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
