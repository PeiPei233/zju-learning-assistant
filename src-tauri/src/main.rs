// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod zju_assist;

use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    process::Command,
    sync::{atomic::AtomicBool, Arc},
    time::Instant,
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
    let mut zju_assist = state.lock().await;
    zju_assist
        .login(&username, &password)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn check_login(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<bool, String> {
    let zju_assist = state.lock().await;
    match zju_assist.is_login() {
        true => Ok(true),
        false => Err("Not login".to_string()),
    }
}

#[tauri::command]
async fn logout(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<(), String> {
    let mut zju_assist = state.lock().await;
    zju_assist.logout();
    Ok(())
}

#[tauri::command]
async fn get_courses(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
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
    let zju_assist = state.lock().await;
    zju_assist
        .get_academic_year_list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_semester_list(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
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
    size: i64,
}

#[derive(Clone, Serialize)]
struct Progress {
    progress: f64,
    status: String,
}

#[tauri::command]
async fn download_courses_upload(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    window: Window,
    courses: Value,
) -> Result<(), String> {
    let zju_assist = state.lock().await;
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut all_uploads = Vec::new();
    window
        .emit(
            "download-progress",
            Progress {
                progress: 0.0,
                status: "正在获取文件列表".to_string(),
            },
        )
        .unwrap();
    for course in courses.as_array().unwrap() {
        let course_id = course["id"].as_i64().unwrap();
        let course_name = course["name"].as_str().unwrap().replace("/", "-");
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
            let size = upload["size"].as_i64().unwrap();
            all_uploads.push(Uploads {
                reference_id,
                file_name,
                path,
                size,
            });
        }
        // let homework_uploads = zju_assist
        //     .get_homework_uploads(course_id)
        //     .await
        //     .map_err(|err| err.to_string())?;
        // for upload in homework_uploads {
        //     let reference_id = upload["reference_id"].as_i64().unwrap();
        //     let file_name = upload["name"].as_str().unwrap().to_string();
        //     let path = format!("download/{}/homework", course_name);
        //     all_uploads.push(Uploads {
        //         reference_id,
        //         file_name,
        //         path,
        //     });
        // }
    }
    for (i, upload) in all_uploads.iter().enumerate() {
        window
            .emit(
                "download-progress",
                Progress {
                    progress: i as f64 / all_uploads.len() as f64,
                    status: format!("正在下载文件 {} ...", upload.file_name),
                },
            )
            .unwrap();
        zju_assist
            .download_file(upload.reference_id, &upload.file_name, &upload.path)
            .await
            .map_err(|err| err.to_string())?;
    }
    window
        .emit(
            "download-progress",
            Progress {
                progress: 1.0,
                status: "下载完成".to_string(),
            },
        )
        .unwrap();
    Ok(())
}

#[tauri::command]
async fn get_uploads_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    courses: Value,
) -> Result<Vec<Uploads>, String> {
    let zju_assist = state.lock().await;
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut all_uploads = Vec::new();
    for course in courses.as_array().unwrap() {
        let course_id = course["id"].as_i64().unwrap();
        let course_name = course["name"].as_str().unwrap().replace("/", "-");
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
            let size = upload["size"].as_i64().unwrap_or(1000);
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

fn sec_to_string(time: f64) -> String {
    let day = (time / 86400.).floor();
    let hour = ((time - day * 86400.) / 3600.).floor();
    let minute = ((time - day * 86400. - hour * 3600.) / 60.).floor();
    let second = (time - day * 86400. - hour * 3600. - minute * 60.).floor();
    if day > 0. {
        format!(
            "{} 天 {} 小时 {} 分钟 {} 秒",
            day as i64, hour as i64, minute as i64, second as i64
        )
    } else if hour > 0. {
        format!(
            "{} 小时 {} 分钟 {} 秒",
            hour as i64, minute as i64, second as i64
        )
    } else if minute > 0. {
        format!("{} 分钟 {} 秒", minute as i64, second as i64)
    } else {
        format!("{:.2} 秒", second)
    }
}

#[tauri::command]
async fn download_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    window: Window,
    uploads: Vec<Uploads>,
) -> Result<Vec<Uploads>, String> {
    let zju_assist = state.lock().await;
    let total_size = uploads.iter().map(|upload| upload.size).sum::<i64>();
    let mut downloaded_size: i64 = 0;
    for (i, upload) in uploads.iter().enumerate() {
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
                        progress: i as f64 / uploads.len() as f64,
                        status: "下载已取消".to_string(),
                    },
                )
                .unwrap();
            return Ok(uploads[0..i].to_vec());
        }
        let (mut stream, filepath) = zju_assist
            .get_uploads_stream_and_path(upload.reference_id, &upload.file_name, &upload.path)
            .await
            .map_err(|err| err.to_string())?;
        let mut file = tokio::fs::File::create(filepath.clone())
            .await
            .map_err(|e| e.to_string())?;
        let start_time = Instant::now();
        let mut current_size: i64 = 0;
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
                            progress: (downloaded_size + current_size) as f64 / total_size as f64,
                            status: "下载已取消".to_string(),
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
            current_size += chunk.len() as i64;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;

            let elapsed = start_time.elapsed().as_micros();
            let speed = if elapsed == 0 {
                0.
            } else {
                current_size as f64 / elapsed as f64 * 1000. * 1000.
            };
            let speed_str = if speed > 1024. * 1024. {
                format!("{:.2} MB/s", speed / 1024. / 1024.)
            } else if speed > 1024. {
                format!("{:.2} KB/s", speed / 1024.)
            } else {
                format!("{:.2} B/s", speed)
            };
            let remaining_time_str = if speed > 0. {
                let remaining_time = (total_size - downloaded_size - current_size) as f64 / speed;
                sec_to_string(remaining_time)
            } else {
                "未知".to_string()
            };
            window
                .emit(
                    "download-progress",
                    Progress {
                        progress: (downloaded_size + current_size) as f64 / total_size as f64,
                        status: format!(
                            "正在下载文件 {} （{}/{}）...  {}  剩余 {}",
                            upload.file_name,
                            i + 1,
                            uploads.len(),
                            speed_str,
                            remaining_time_str,
                        ),
                    },
                )
                .unwrap();
        }
        downloaded_size += upload.size;
    }
    window
        .emit(
            "download-progress",
            Progress {
                progress: 1.0,
                status: "下载完成".to_string(),
            },
        )
        .unwrap();
    Ok(uploads)
}

#[tauri::command]
fn cancel_download(state: State<'_, DownloadState>) -> Result<(), String> {
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
fn get_save_path(state: State<'_, DownloadState>) -> Result<(), String> {
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let zju_assist = Arc::new(Mutex::new(ZjuAssist::new()));
            app.manage(zju_assist);
            let download_state = DownloadState {
                should_cancel: Arc::new(AtomicBool::new(false)),
                save_path: Arc::new(std::sync::Mutex::new("Downloads".to_string())),
            };
            app.manage(download_state);
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
            download_courses_upload,
            get_uploads_list,
            download_uploads,
            cancel_download,
            update_path,
            get_save_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
