use crate::model::{Config, Progress, Subject, Upload, VersionInfo};
use crate::utils::{
    export_todo_to_destination, images_to_pdf, normalize_llm_api_url, save_subtitle,
    summarize_subtitle,
};
use crate::zju_assist::{SubtitleContent, ZjuAssist};

use chrono::{DateTime, Local, NaiveDate, Utc};
use dashmap::DashMap;
use futures::TryStreamExt;
use keyring::Entry;
use log::{debug, info};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use std::{path::Path, process::Command, sync::Arc};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;
#[cfg(not(desktop))]
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub async fn login(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    username: String,
    password: String,
) -> Result<(), String> {
    info!("login");
    let mut zju_assist = state.lock().await;
    zju_assist
        .login(&username, &password)
        .await
        .map_err(|err| err.to_string())?;

    let background = zju_assist.clone();
    drop(zju_assist);
    tauri::async_runtime::spawn(async move {
        background.connect_services().await;
    });
    Ok(())
}

// Called after the UI has entered Home. These failures must not undo authentication.
#[tauri::command]
pub async fn complete_login_setup(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
    username: String,
    auto_login: bool,
) -> Result<(), String> {
    let current_session = state.lock().await;
    let zju_assist = current_session.clone();
    if !zju_assist.is_login() || zju_assist.get_username() != username {
        return Ok(());
    }
    #[cfg(desktop)]
    let update_tray = || -> Result<(), String> {
        let res = handle
            .app_handle()
            .tray_by_id("main")
            .ok_or_else(|| "托盘不可用".to_string())?
            .set_menu(Some(
                Menu::with_items(
                    &handle,
                    &[
                        &MenuItem::with_id(
                            &handle,
                            "id",
                            format!("已登录：{}", username),
                            false,
                            None::<&str>,
                        )
                        .map_err(|err| err.to_string())?,
                        &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
                        &MenuItem::with_id(
                            &handle,
                            "open",
                            "打开 ZJU Learning Assistant",
                            true,
                            None::<&str>,
                        )
                        .map_err(|err| err.to_string())?,
                        &MenuItem::with_id(
                            &handle,
                            "quit",
                            "退出 ZJU Learning Assistant",
                            true,
                            None::<&str>,
                        )
                        .map_err(|err| err.to_string())?,
                    ],
                )
                .map_err(|err| err.to_string())?,
            ));
        res.map_err(|error| error.to_string())
    };
    #[cfg(desktop)]
    if let Err(error) = update_tray() {
        log::warn!("Update login tray failed: {}", error);
    }

    drop(current_session);
    let storage_session = zju_assist.clone();
    let result = tokio::task::spawn_blocking(move || storage_session.save_auto_login(auto_login))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    if !zju_assist.is_login() {
        return Ok(());
    }
    result
}

#[tauri::command]
pub fn get_auto_login_info() -> Result<(String, String), String> {
    info!("get_auto_login_info");
    let entry = Entry::new("zju-assist", "auto-login").map_err(|err| err.to_string())?;
    let content = entry.get_password().map_err(|err| err.to_string())?;
    let mut content = content.split('\n');
    let username = content.next().unwrap_or("").to_string();
    let password = content.next().unwrap_or("").to_string();
    Ok((username, password))
}

#[tauri::command]
pub async fn check_login(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<bool, String> {
    info!("check_login");
    let zju_assist = state.lock().await;
    match zju_assist.is_login() {
        true => Ok(true),
        false => Err("Not login".to_string()),
    }
}

#[tauri::command]
pub async fn test_connection(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<(), String> {
    info!("test_connection");
    let mut zju_assist = state.lock().await.clone();
    zju_assist
        .test_connection()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn logout(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
) -> Result<(), String> {
    info!("logout");
    let mut zju_assist = state.lock().await;
    zju_assist.logout();

    #[cfg(desktop)]
    let res = handle.tray_by_id("main").unwrap().set_menu(Some(
        Menu::with_items(
            &handle,
            &[
                &MenuItem::with_id(&handle, "id", "未登录", false, None::<&str>)
                    .map_err(|err| err.to_string())?,
                &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
                &MenuItem::with_id(
                    &handle,
                    "open",
                    "打开 ZJU Learning Assistant",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
                &MenuItem::with_id(
                    &handle,
                    "quit",
                    "退出 ZJU Learning Assistant",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
            ],
        )
        .map_err(|err| err.to_string())?,
    ));
    #[cfg(desktop)]
    if let Err(e) = res {
        return Err(e.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_todo_once(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
) -> Result<Vec<Value>, String> {
    info!("sync_todo_once");
    let zju_assist = state.lock().await.clone();
    let todo_list = zju_assist
        .get_todo_list()
        .await
        .map_err(|err| err.to_string())?;
    let todo_list_no_end_time = todo_list
        .iter()
        .filter(|todo| todo["end_time"].is_null())
        .map(|todo| todo.clone())
        .collect::<Vec<_>>();
    let mut todo_list_with_end_time = todo_list
        .iter()
        .filter(|todo| !todo["end_time"].is_null())
        .map(|todo| todo.clone())
        .collect::<Vec<_>>();

    // sort todo list by end_time like 2024-06-06T12:00:00Z
    todo_list_with_end_time.sort_by(|a, b| {
        let a = a["end_time"].as_str().unwrap_or("1970-01-01T00:00:00Z");
        let b = b["end_time"].as_str().unwrap_or("1970-01-01T00:00:00Z");

        let a = a
            .parse::<DateTime<Utc>>()
            .unwrap_or("1970-01-01T00:00:00Z".parse().unwrap());
        let b = b
            .parse::<DateTime<Utc>>()
            .unwrap_or("1970-01-01T00:00:00Z".parse().unwrap());

        a.cmp(&b)
    });
    #[cfg(desktop)]
    let menu = Menu::new(&handle).unwrap();
    #[cfg(desktop)]
    menu.append_items(&[
        &MenuItem::with_id(
            &handle,
            "id",
            format!("已登录：{}", zju_assist.get_username()),
            false,
            None::<&str>,
        )
        .map_err(|err| err.to_string())?,
        &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
    ])
    .unwrap();
    if todo_list.len() > 0 {
        for todo in todo_list_with_end_time.iter() {
            let end_time = todo["end_time"].as_str().unwrap_or("1970-01-01T00:00:00Z");
            let end_time = end_time
                .parse::<DateTime<Utc>>()
                .unwrap_or("1970-01-01T00:00:00Z".parse().unwrap())
                .with_timezone(&Local);
            let course_id = todo["course_id"].as_i64().unwrap();
            let id = todo["id"].as_i64().unwrap();
            let course_name = todo["course_name"].as_str().unwrap();
            let title = todo["title"].as_str().unwrap();

            let tray_title = format!(
                "{}  {}-{}",
                end_time.format("%Y-%m-%d %H:%M:%S"),
                title,
                course_name
            );
            let tray_id = format!("todo-{}-{}", course_id, id);
            #[cfg(desktop)]
            menu.append(
                &MenuItem::with_id(&handle, &tray_id, tray_title, true, None::<&str>)
                    .map_err(|err| err.to_string())?,
            )
            .unwrap();
        }
        for todo in todo_list_no_end_time.iter() {
            let course_id = todo["course_id"].as_i64().unwrap();
            let id = todo["id"].as_i64().unwrap();
            let course_name = todo["course_name"].as_str().unwrap();
            let title = todo["title"].as_str().unwrap();

            let tray_title = format!("No Deadline  {}-{}", title, course_name);
            let tray_id = format!("todo-{}-{}", course_id, id);
            #[cfg(desktop)]
            menu.append(
                &MenuItem::with_id(&handle, &tray_id, tray_title, true, None::<&str>)
                    .map_err(|err| err.to_string())?,
            )
            .unwrap();
        }
    } else {
        #[cfg(desktop)]
        menu.append(
            &MenuItem::with_id(&handle, "todo", "暂无待办事项", true, None::<&str>)
                .map_err(|err| err.to_string())?,
        )
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    menu.append_items(&[
        &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
        &Submenu::with_items(
            &handle,
            "导出待办事项",
            true,
            &[
                &MenuItem::with_id(
                    &handle,
                    "export-todo-calendar",
                    "添加至日历 App",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
                &MenuItem::with_id(
                    &handle,
                    "export-todo-reminder",
                    "添加至提醒事项 App",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
                &MenuItem::with_id(
                    &handle,
                    "export-todo-ics",
                    "导出为 iCalendar 文件",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
                &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
                &MenuItem::with_id(&handle, "export-todo-help", "查看帮助", true, None::<&str>)
                    .map_err(|err| err.to_string())?,
            ],
        )
        .map_err(|err| err.to_string())?,
    ])
    .unwrap();

    #[cfg(desktop)]
    #[cfg(not(target_os = "macos"))]
    menu.append_items(&[
        &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
        &Submenu::with_items(
            &handle,
            "导出待办事项",
            true,
            &[
                &MenuItem::with_id(
                    &handle,
                    "export-todo-ics",
                    "导出为 iCalendar 文件",
                    true,
                    None::<&str>,
                )
                .map_err(|err| err.to_string())?,
                &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
                &MenuItem::with_id(&handle, "export-todo-help", "查看帮助", true, None::<&str>)
                    .map_err(|err| err.to_string())?,
            ],
        )
        .map_err(|err| err.to_string())?,
    ])
    .unwrap();

    #[cfg(desktop)]
    menu.append_items(&[
        &PredefinedMenuItem::separator(&handle).map_err(|err| err.to_string())?,
        &MenuItem::with_id(
            &handle,
            "open",
            "打开 ZJU Learning Assistant",
            true,
            None::<&str>,
        )
        .map_err(|err| err.to_string())?,
        &MenuItem::with_id(
            &handle,
            "quit",
            "退出 ZJU Learning Assistant",
            true,
            None::<&str>,
        )
        .map_err(|err| err.to_string())?,
    ])
    .unwrap();

    // Keep logout/account changes from interleaving with the final tray update.
    let _current_session = state.lock().await;
    if !zju_assist.is_login() {
        return Err("Not login".to_string());
    }

    #[cfg(desktop)]
    handle
        .tray_by_id("main")
        .unwrap()
        .set_menu(Some(menu))
        .unwrap();

    Ok(todo_list)
}

#[tauri::command]
pub async fn export_todo(
    handle: AppHandle,
    window: Window,
    todo_list: Vec<Value>,
    location: String,
) -> Result<Option<String>, String> {
    export_todo_to_destination(handle, window, todo_list, location).await
}

#[tauri::command]
pub async fn export_todo_from_tray(
    handle: AppHandle,
    window: Window,
    todo_list: Vec<Value>,
    location: String,
) {
    let result = export_todo_to_destination(handle.clone(), window, todo_list, location).await;
    let (title, description) = match result {
        Ok(Some(description)) => ("导出待办成功", description),
        Ok(None) => return,
        Err(error) => ("导出待办失败", error),
    };
    if let Err(error) = handle
        .notification()
        .builder()
        .title(title)
        .body(description)
        .show()
    {
        log::warn!("Show export notification failed: {}", error);
    }
}

#[tauri::command]
pub async fn get_courses(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
    info!("get_courses");
    let zju_assist = state.lock().await.clone();
    zju_assist
        .get_courses()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_academic_year_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<Vec<Value>, String> {
    info!("get_academic_year_list");
    let zju_assist = state.lock().await.clone();
    zju_assist
        .get_academic_year_list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_semester_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<Vec<Value>, String> {
    info!("get_semester_list");
    let zju_assist = state.lock().await.clone();
    zju_assist
        .get_semester_list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_activities_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_id: i64,
) -> Result<Vec<Value>, String> {
    info!("get_activities_uploads: {}", course_id);
    let zju_assist = state.lock().await.clone();
    zju_assist
        .get_activities_uploads(course_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_homework_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_id: i64,
) -> Result<Vec<Value>, String> {
    info!("get_homework_uploads: {}", course_id);
    let zju_assist = state.lock().await.clone();
    zju_assist
        .get_homework_uploads(course_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn download_file(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    id: i64,
    reference_id: i64,
    file_name: String,
    path: String,
) -> Result<(), String> {
    info!("download_file: {} {}", id, reference_id);
    let zju_assist = state.lock().await.clone();
    zju_assist
        .download_file(id, reference_id, &file_name, &path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_uploads_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    config: State<'_, Arc<Mutex<Config>>>,
    courses: Value,
    sync_upload: bool,
) -> Result<Vec<Upload>, String> {
    info!("get_uploads_list: {}", sync_upload);
    let zju_assist = state.lock().await.clone();
    let save_path = config.lock().await.save_path.clone();
    let mut all_uploads = Vec::new();
    let mut tasks: Vec<JoinHandle<Result<Vec<Upload>, String>>> = Vec::new();
    for course in courses.as_array().unwrap() {
        let course_id = course["id"].as_i64().unwrap();
        let course_name = course["name"].as_str().unwrap().replace("/", "-");
        debug!("get_uploads_list: course - {} {}", course_id, course_name);
        let zju_assist = zju_assist.clone();
        let save_path = save_path.clone();
        tasks.push(tokio::task::spawn(async move {
            let mut uploads = Vec::new();
            let activities_uploads = zju_assist
                .get_activities_uploads(course_id)
                .await
                .map_err(|err| err.to_string())?;
            for upload in activities_uploads {
                let id = upload["id"].as_i64().unwrap();
                let reference_id = upload["reference_id"].as_i64().unwrap();
                let file_name = upload["name"].as_str().unwrap().to_string();
                let path = Path::new(&save_path)
                    .join(&course_name)
                    .to_str()
                    .unwrap()
                    .to_string();
                let size = upload["size"].as_u64().unwrap_or(1000);
                debug!(
                    "get_uploads_list: uploads - {} {} {} {} {}",
                    id, reference_id, file_name, path, size
                );
                uploads.push(Upload {
                    id,
                    reference_id,
                    file_name,
                    course_name: course_name.clone(),
                    path,
                    size,
                    activity_id: upload["activity_id"].as_i64(),
                    allow_private_wps_office_view: upload["allow_private_wps_office_view"]
                        .as_bool()
                        .unwrap_or(false),
                });
            }
            Ok(uploads)
        }));
    }

    for task in tasks {
        let uploads = task.await.map_err(|err| err.to_string())??;
        all_uploads.extend(uploads);
    }

    if sync_upload {
        // remove files that already downloaded
        let mut sync_uploads = Vec::new();
        for upload in all_uploads.iter() {
            let filepath = Path::new(&upload.path)
                .join(&upload.file_name)
                .to_str()
                .unwrap()
                .to_string();
            // if path not exists, or size not match, then download
            let original_exists = Path::new(&filepath)
                .metadata()
                .map(|metadata| metadata.len() == upload.size)
                .unwrap_or(false);
            if !original_exists {
                sync_uploads.push(upload.clone());
            }
        }
        all_uploads = sync_uploads;
    }

    Ok(all_uploads)
}

#[tauri::command]
pub async fn start_download_upload(
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    state: State<'_, DashMap<String, Arc<AtomicBool>>>,
    window: Window,
    id: String,
    upload: Upload,
    sync_upload: bool,
) -> Result<(), String> {
    info!("download_upload: {} {}", id, upload.file_name);

    let zju_assist = zju_assist.lock().await.clone();
    // state -> true: downloading, false: cancel
    let download_state = Arc::new(AtomicBool::new(true));
    state.insert(id.clone(), download_state.clone());

    let res = zju_assist
        .get_uploads_response(upload.id, upload.reference_id)
        .await;
    let (res, is_preview) = match res {
        Ok(res) => (res, false),
        Err(_) if upload.allow_private_wps_office_view => {
            info!(
                "download_upload: fallback to WPS original download {}",
                upload.id
            );
            let activity_id = upload
                .activity_id
                .ok_or_else(|| "缺少课件所属活动，请刷新课件列表后重试".to_string())?;
            let res = crate::utils::wps::download(
                &zju_assist,
                upload.id,
                activity_id,
                crate::utils::wps::DownloadMode::Original,
            )
            .await;
            match res {
                Ok(res) => (res, false),
                Err(_) => {
                    info!("download_upload: fallback to WPS preview PDF {}", upload.id);
                    if download_state.load(std::sync::atomic::Ordering::SeqCst) {
                        let _ = window.emit(
                            "download-progress",
                            Progress {
                                id: id.clone(),
                                status: "downloading".to_string(),
                                file_name: crate::utils::wps::preview_file_name(&upload.file_name),
                                msg: "正在导出预览版 PDF".to_string(),
                                ..Progress::default()
                            },
                        );
                    }
                    let res = crate::utils::wps::download(
                        &zju_assist,
                        upload.id,
                        activity_id,
                        crate::utils::wps::DownloadMode::PreviewPdf,
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                    (res, true)
                }
            }
        }
        Err(err) => return Err(err.to_string()),
    };
    let completion_message = if is_preview {
        "预览版 PDF（非原文件）"
    } else {
        "下载完成"
    };

    if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
        state.remove(&id);
        window
            .emit(
                "download-progress",
                Progress {
                    id,
                    status: "canceled".to_string(),
                    file_name: upload.file_name,
                    msg: "已取消".to_string(),
                    ..Progress::default()
                },
            )
            .unwrap();
        return Ok(());
    }

    if !res.status().is_success() {
        debug!(
            "download_upload: fail {} {} {} {} {}",
            upload.id,
            upload.reference_id,
            upload.file_name,
            upload.path,
            res.status()
        );
        state.remove(&id);
        return Err("下载失败".to_string());
    }

    // create father dir if not exists
    std::fs::create_dir_all(Path::new(&upload.path)).map_err(|e| e.to_string())?;

    let response_length = res.content_length();
    let content_length = response_length.unwrap_or(if is_preview { 0 } else { upload.size });
    let mut file_name = upload.file_name.clone();
    let url = res.url().to_string();
    if is_preview {
        file_name = crate::utils::wps::preview_file_name(&upload.file_name);
    } else if let Some(start) = url.find("name=") {
        let start = start + 5;
        let end = url[start..].find("&").unwrap_or(url.len() - start);
        file_name = percent_decode_str(&url[start..start + end])
            .decode_utf8_lossy()
            .to_string();
    }
    let filepath = Path::new(&upload.path).join(&file_name);

    info!("download_upload - filepath: {:?}", filepath);

    // if path exists, and size match, then skip
    if sync_upload
        && (!is_preview || content_length > 0)
        && filepath.exists()
        && filepath.metadata().unwrap().len() == content_length
    {
        debug!(
            "download_upload: skip {} {} {} {}",
            upload.id, upload.reference_id, upload.file_name, upload.path
        );
        window
            .emit(
                "download-progress",
                Progress {
                    id: id.clone(),
                    status: "done".to_string(),
                    file_name: file_name.clone(),
                    downloaded_size: content_length,
                    total_size: content_length,
                    msg: completion_message.to_string(),
                },
            )
            .unwrap();
        info!(
            "download_upload: done {} {} {} {}",
            upload.id, upload.reference_id, upload.file_name, upload.path
        );
        return Ok(());
    }
    debug!(
        "download_upload: stream {} {} {} {:?}",
        upload.id, upload.reference_id, upload.file_name, filepath
    );
    let mut file = tokio::fs::File::create(filepath.clone())
        .await
        .map_err(|e| e.to_string())?;

    tokio::task::spawn(async move {
        let mut current_size: u64 = 0;
        let mut stream = res.bytes_stream();
        let mut signature = Vec::new();
        loop {
            let res = stream.try_next().await.map_err(|e| e.to_string());
            let res = res.and_then(|item| {
                if is_preview {
                    if let Some(chunk) = &item {
                        signature.extend(chunk.iter().take(5 - signature.len()).copied());
                    }
                    if (signature.len() == 5 && signature != b"%PDF-")
                        || (item.is_none()
                            && (signature != b"%PDF-"
                                || response_length.is_some_and(|size| size != current_size)))
                    {
                        return Err("下载文件无效或不完整".to_string());
                    }
                }
                Ok(item)
            });
            let res = if matches!(&res, Ok(None)) {
                file.flush().await.map(|_| None).map_err(|e| e.to_string())
            } else {
                res
            };
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "下载失败".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_upload: fail {} {} {} {}: {}",
                    upload.id, upload.reference_id, upload.file_name, upload.path, err
                );
                // clean up
                drop(file);
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
                }
                return;
            }

            if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "canceled".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "已取消".to_string(),
                        },
                    )
                    .unwrap();
                // clean up
                drop(file);
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
                }
                return;
            }
            let item = res.unwrap();
            if item.is_none() {
                break;
            }
            let chunk = item.unwrap();
            current_size += chunk.len() as u64;
            let res = file.write_all(&chunk).await.map_err(|e| e.to_string());
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "写入文件失败".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_upload: fail {} {} {} {} {}",
                    upload.id, upload.reference_id, upload.file_name, upload.path, err
                );
                // clean up
                drop(file);
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
                }
                return;
            }

            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "downloading".to_string(),
                        file_name: file_name.clone(),
                        downloaded_size: current_size,
                        total_size: content_length,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
        }
        drop(file);
        let content_length = if is_preview {
            current_size
        } else {
            content_length
        };
        window
            .emit(
                "download-progress",
                Progress {
                    id: id.clone(),
                    status: "done".to_string(),
                    file_name: file_name.clone(),
                    downloaded_size: content_length,
                    total_size: content_length,
                    msg: completion_message.to_string(),
                },
            )
            .unwrap();
        info!(
            "download_upload: done {} {} {} {}",
            upload.id, upload.reference_id, upload.file_name, upload.path
        );
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_download(
    state: State<'_, DashMap<String, Arc<AtomicBool>>>,
    id: String,
) -> Result<(), String> {
    info!("cancel_download: {}", id);
    if let Some(download_state) = state.get(&id) {
        download_state.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn open_file(handle: AppHandle, path: String, folder: bool) -> Result<(), String> {
    #[cfg(desktop)]
    let _ = &handle;

    info!("open_file: {} {}", path, folder);
    if Path::new(&path).exists() {
        if folder {
            // open folder
            #[cfg(target_os = "windows")]
            Command::new("explorer.exe")
                .arg("/select,")
                .arg(path)
                .spawn()
                .map_err(|err| err.to_string())?; // explorer.exe /select,"path"

            #[cfg(target_os = "macos")]
            Command::new("open")
                .arg("-R")
                .arg(path)
                .spawn()
                .map_err(|err| err.to_string())?;

            #[cfg(target_os = "linux")]
            Command::new("xdg-open")
                .arg(Path::new(&path).parent().unwrap())
                .spawn()
                .map_err(|err| err.to_string())?;

            // return Err("Open folder is not implemented on mobile".to_string());
            #[cfg(not(desktop))]
            handle
                .shell()
                .open(
                    format!(
                        "file://{}",
                        Path::new(&path).parent().unwrap().to_str().unwrap()
                    ),
                    None,
                )
                .map_err(|err| err.to_string())?;
        } else {
            // open file
            #[cfg(target_os = "windows")]
            Command::new("cmd")
                .arg("/c")
                .arg("start")
                .raw_arg(r#""""#)
                .arg(path)
                .spawn()
                .map_err(|err| err.to_string())?; // cmd /c start "" "path"

            #[cfg(target_os = "macos")]
            Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|err| err.to_string())?;

            #[cfg(target_os = "linux")]
            Command::new("xdg-open")
                .arg(path)
                .spawn()
                .map_err(|err| err.to_string())?;

            #[cfg(not(desktop))]
            handle
                .shell()
                .open(format!("content://{}", path), None)
                .map_err(|err| err.to_string())?;
        }

        Ok(())
    } else {
        Err("下载已删除或未下载".to_string())
    }
}

#[tauri::command]
pub fn open_file_upload(handle: AppHandle, upload: Upload, folder: bool) -> Result<(), String> {
    info!("open_file_upload: {} {}", upload.file_name, folder);
    let path = Path::new(&upload.path)
        .join(&upload.file_name)
        .to_str()
        .unwrap()
        .to_string();
    open_file(handle, path, folder)
}

#[tauri::command]
pub fn open_file_ppts(handle: AppHandle, subject: Subject, folder: bool) -> Result<(), String> {
    info!(
        "open_file_ppts: {}-{} {}",
        subject.course_name, subject.sub_name, folder
    );
    let path = Path::new(&subject.path)
        .join(&subject.sub_name)
        .to_str()
        .unwrap()
        .to_string();
    if Path::new(&path).exists() {
        let pdf_path = Path::new(&path)
            .join(format!("{}-{}.pdf", subject.course_name, subject.sub_name))
            .to_str()
            .unwrap()
            .to_string();
        if Path::new(&pdf_path).exists() {
            open_file(handle, pdf_path, folder)
        } else {
            let images_path = Path::new(&path)
                .join("ppt_images")
                .to_str()
                .unwrap()
                .to_string();
            open_file(handle, images_path, folder)
        }
    } else {
        Err("下载已删除或未下载".to_string())
    }
}

#[tauri::command]
pub async fn get_latest_version_info() -> Result<VersionInfo, String> {
    info!("get_latest_version_info");

    let client = ZjuAssist::new();

    let res = client
        .get("https://api.github.com/repos/PeiPei233/zju-learning-assistant/releases/latest")
        .send()
        .await;

    if let Ok(res) = res {
        let json = res.json::<Value>().await.map_err(|err| err.to_string())?;

        info!("get_latest_version_info: {:?}", json.get("tag_name"));

        if !json.get("tag_name").is_none() {
            let version_info = VersionInfo {
                version: json["tag_name"].as_str().unwrap_or("").to_string(),
                notes: json["body"].as_str().unwrap_or("").to_string(),
                url: json["html_url"].as_str().unwrap_or("").to_string(),
            };

            return Ok(version_info);
        }
    }

    // try again with gitee
    let res = client
        .get("https://gitee.com/api/v5/repos/PeiPeiY/zju-learning-assistant/releases/latest")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let json = res.json::<Value>().await.map_err(|err| err.to_string())?;

    info!(
        "get_latest_version_info (gitee): {:?}",
        json.get("tag_name")
    );

    let version_info = VersionInfo {
        version: json["tag_name"].as_str().unwrap_or("").to_string(),
        notes: json["body"].as_str().unwrap_or("").to_string(),
        url: format!(
            "https://gitee.com/PeiPeiY/zju-learning-assistant/releases/tag/{}",
            json["tag_name"].as_str().unwrap_or("")
        ),
    };

    Ok(version_info)
}

#[tauri::command]
pub async fn start_download_ppts(
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    config_state: State<'_, Arc<Mutex<Config>>>,
    state: State<'_, DashMap<String, Arc<AtomicBool>>>,
    window: Window,
    id: String,
    subject: Subject,
    to_pdf: bool,
) -> Result<(), String> {
    info!(
        "start_download_ppts: {} {} {}",
        id, subject.course_name, subject.sub_name
    );

    let mut zju_assist = zju_assist.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;

    // state -> true: downloading, false: cancel
    let download_state = Arc::new(AtomicBool::new(true));
    let config = config_state.lock().await.clone();
    state.insert(id.clone(), download_state.clone());

    tokio::task::spawn(async move {
        let ai_task_handle = if config.download_subtitle || config.llm_enabled {
            let zju_clone = zju_assist.clone();
            let subject_clone = subject.clone();
            let config_clone = config.clone();
            let window_clone = window.clone();
            let bg_id = format!("{}-bg", id);
            let state_clone = download_state.clone();

            Some(tokio::spawn(async move {
                if !state_clone.load(std::sync::atomic::Ordering::SeqCst) {
                    return Ok(());
                }

                // 1. 获取字幕
                match zju_clone.get_subtitle(subject_clone.sub_id).await {
                    Ok(contents) => {
                        let contents: Vec<SubtitleContent> = contents;
                        if !contents.is_empty() {
                            let sub_dir =
                                Path::new(&subject_clone.path).join(&subject_clone.sub_name);
                            let _ = std::fs::create_dir_all(&sub_dir);
                            let file_stem =
                                format!("{}-{}", subject_clone.course_name, subject_clone.sub_name);

                            // 2. 保存字幕
                            if config_clone.download_subtitle {
                                if let Err(e) =
                                    save_subtitle(&contents, &sub_dir, &file_stem, &config_clone)
                                        .await
                                {
                                    info!("后台保存字幕失败: {}", e);
                                    return Err(format!("保存字幕失败: {}", e));
                                }
                            }

                            // 3. AI 总结
                            if config_clone.llm_enabled {
                                if !state_clone.load(std::sync::atomic::Ordering::SeqCst) {
                                    return Ok(());
                                }
                                if let Err(e) = summarize_subtitle(
                                    &contents,
                                    &sub_dir,
                                    &file_stem,
                                    &config_clone,
                                    &window_clone,
                                    &bg_id,
                                )
                                .await
                                {
                                    info!("后台 AI 总结失败: {}", e);
                                    return Err(format!("AI总结失败: {}", e));
                                }
                            }
                        }
                        Ok(())
                    }
                    Err(e) => Err(format!("获取字幕失败: {}", e)),
                }
            }))
        } else {
            None
        };

        let mut count = 0;
        let total_size = subject.ppt_image_urls.len();
        let path = Path::new(&subject.path).join(&subject.sub_name);
        let urls = subject.ppt_image_urls.clone();

        let image_paths = urls
            .clone()
            .into_iter()
            .zip(1..=urls.len())
            .map(|(url, i)| {
                path.join("ppt_images")
                    .join(format!("{}.{}", i, url.split('.').last().unwrap()))
                    .to_str()
                    .unwrap()
                    .to_string()
            })
            .collect::<Vec<_>>();

        let mut tasks: Vec<JoinHandle<Result<(), String>>> = Vec::new();
        for (url, path) in urls
            .clone()
            .into_iter()
            .zip(image_paths.clone().into_iter())
        {
            let zju_assist = zju_assist.clone();
            let task = tokio::task::spawn(async move {
                let res = zju_assist
                    .download_ppt_image(&url, &path)
                    .await
                    .map_err(|err| err.to_string());
                // if download fail, retry once
                if let Err(_) = res {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    return zju_assist
                        .download_ppt_image(&url, &path)
                        .await
                        .map_err(|err| err.to_string());
                }
                Ok(())
            });
            tasks.push(task);
            // delay 50ms to avoid too many requests
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        for task in &mut tasks {
            if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "canceled".to_string(),
                            file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                            downloaded_size: count,
                            total_size: total_size as u64,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                // stop all tasks
                for task in tasks {
                    task.abort();
                }
                // stop AI task
                if let Some(handle) = ai_task_handle {
                    handle.abort();
                }
                // clean up
                let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_ppts: clean up fail: {}", err);
                }
                return;
            }
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "downloading".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: count,
                        total_size: total_size as u64,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
            let res = task.await.map_err(|err| err.to_string());
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                            downloaded_size: count,
                            total_size: total_size as u64,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_ppts: fail {} {} {} {}",
                    subject.course_name, subject.sub_name, subject.path, err
                );
                // stop AI task
                if let Some(handle) = ai_task_handle {
                    handle.abort();
                }
                // clean up
                let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_ppts: clean up fail: {}", err);
                }
                return;
            }
            let res = res.unwrap();
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                            downloaded_size: count,
                            total_size: total_size as u64,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_ppts: fail {} {} {} {}",
                    subject.course_name, subject.sub_name, subject.path, err
                );
                // stop AI task
                if let Some(handle) = ai_task_handle {
                    handle.abort();
                }
                // clean up
                let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_ppts: clean up fail: {}", err);
                }
                return;
            }
            count += 1;
        }

        if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "canceled".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: count,
                        total_size: total_size as u64,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
            // stop AI task
            if let Some(handle) = ai_task_handle {
                handle.abort();
            }
            // clean up
            let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
            if let Err(err) = res {
                debug!("download_upload: clean up fail: {}", err);
            }
            return;
        }

        if urls.len() > 0 && to_pdf {
            let pdf_path = path
                .join(format!("{}-{}.pdf", subject.course_name, subject.sub_name))
                .to_str()
                .unwrap()
                .to_string();

            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "writing".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: count,
                        total_size: total_size as u64,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
            let res = images_to_pdf(image_paths, &pdf_path).map_err(|err| err.to_string());
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                            downloaded_size: count,
                            total_size: total_size as u64,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_ppts: fail {} {} {} {}",
                    subject.course_name, subject.sub_name, subject.path, err
                );
                // stop AI task
                if let Some(handle) = ai_task_handle {
                    handle.abort();
                }
                // clean up
                let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
                }
                return;
            }
        }

        if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "canceled".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: count,
                        total_size: total_size as u64,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
            // stop AI task
            if let Some(handle) = ai_task_handle {
                handle.abort();
            }
            // clean up
            let res = std::fs::remove_dir_all(&path).map_err(|e| e.to_string());
            if let Err(err) = res {
                debug!("download_upload: clean up fail: {}", err);
            }
            return;
        }

        // wait for ai task
        if let Some(handle) = ai_task_handle {
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "writing".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: count,
                        total_size: total_size as u64,
                        msg: "正在进行 AI 总结".to_string(),
                    },
                )
                .unwrap();
            let res = handle.await;
            if let Ok(ai_res) = res {
                if let Err(err) = ai_res {
                    window
                        .emit(
                            "download-progress",
                            Progress {
                                id: id.clone(),
                                status: "failed".to_string(),
                                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                                downloaded_size: count,
                                total_size: total_size as u64,
                                msg: format!("AI 任务失败：{}", err),
                            },
                        )
                        .unwrap();
                    info!(
                        "download_ppts: AI task fail {} {} {}",
                        subject.course_name, subject.sub_name, subject.path
                    );
                    return;
                }
            } else {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                            downloaded_size: count,
                            total_size: total_size as u64,
                            msg: "AI 任务失败".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_ppts: AI task fail {} {} {}",
                    subject.course_name, subject.sub_name, subject.path
                );
                return;
            }
        }

        window
            .emit(
                "download-progress",
                Progress {
                    id: id.clone(),
                    status: "done".to_string(),
                    file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                    downloaded_size: count,
                    total_size: total_size as u64,
                    msg: "".to_string(),
                },
            )
            .unwrap();
        info!(
            "download_ppts: done {} {}",
            subject.course_name, subject.sub_name
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn start_download_playback(
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    state: State<'_, DashMap<String, Arc<AtomicBool>>>,
    window: Window,
    id: String,
    subject: Subject,
    sync_upload: bool,
) -> Result<(), String> {
    info!(
        "start_download_playback: {} {} {}",
        id, subject.course_name, subject.sub_name
    );

    let mut zju_assist = zju_assist.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;

    // state -> true: downloading, false: cancel
    let download_state = Arc::new(AtomicBool::new(true));
    state.insert(id.clone(), download_state.clone());

    let res = zju_assist
        .get_playback_response(subject.course_id, subject.sub_id)
        .await
        .map_err(|err| err.to_string())?;

    if !res.status().is_success() {
        debug!(
            "start_download_playback: fail {} {} {}",
            subject.course_name, subject.sub_name, subject.path
        );
        state.remove(&id);
        return Err("下载失败".to_string());
    }

    // create father dir if not exists
    std::fs::create_dir_all(Path::new(&subject.path)).map_err(|e| e.to_string())?;

    let content_length = res.content_length().unwrap_or(0);
    let file_name = format!("{}-{}.mp4", subject.course_name, subject.sub_name);
    let filepath = Path::new(&subject.path).join(&file_name);

    info!("download_playback - filepath: {:?}", filepath);

    // if path exists, and size match, then skip
    if sync_upload && filepath.exists() && filepath.metadata().unwrap().len() == content_length {
        debug!(
            "download_playback: skip {} {} {}",
            subject.course_name, subject.sub_name, subject.path
        );
        window
            .emit(
                "download-progress",
                Progress {
                    id: id.clone(),
                    status: "done".to_string(),
                    file_name: file_name.clone(),
                    downloaded_size: content_length,
                    total_size: content_length,
                    msg: "下载完成".to_string(),
                },
            )
            .unwrap();
        info!(
            "download_playback: done {} {} {}",
            subject.course_name, subject.sub_name, subject.path
        );
        return Ok(());
    }
    debug!(
        "download_playback: stream {} {} {:?}",
        subject.course_name, subject.sub_name, filepath
    );
    let mut file = tokio::fs::File::create(filepath.clone())
        .await
        .map_err(|e| e.to_string())?;

    tokio::task::spawn(async move {
        let mut current_size: u64 = 0;
        let mut stream = res.bytes_stream();
        loop {
            let res = stream.try_next().await.map_err(|e| e.to_string());
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_playback: fail {} {} {} {}",
                    subject.course_name, subject.sub_name, subject.path, err
                );
                // clean up
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_playback: clean up fail: {}", err);
                }
                break;
            }

            if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "canceled".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                // clean up
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_playback: clean up fail: {}", err);
                }
                return;
            }
            let item = res.unwrap();
            if item.is_none() {
                break;
            }
            let chunk = item.unwrap();
            current_size += chunk.len() as u64;
            let res = file.write_all(&chunk).await.map_err(|e| e.to_string());
            if let Err(err) = res {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            id: id.clone(),
                            status: "failed".to_string(),
                            file_name: file_name.clone(),
                            downloaded_size: current_size,
                            total_size: content_length,
                            msg: "".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_playback: fail {} {} {} {}",
                    subject.course_name, subject.sub_name, subject.path, err
                );
                // clean up
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_playback: clean up fail: {}", err);
                }
                break;
            }

            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "downloading".to_string(),
                        file_name: file_name.clone(),
                        downloaded_size: current_size,
                        total_size: content_length,
                        msg: "".to_string(),
                    },
                )
                .unwrap();
        }
        window
            .emit(
                "download-progress",
                Progress {
                    id: id.clone(),
                    status: "done".to_string(),
                    file_name: file_name.clone(),
                    downloaded_size: content_length,
                    total_size: content_length,
                    msg: "".to_string(),
                },
            )
            .unwrap();
        info!(
            "download_playback: done {} {} {}",
            subject.course_name, subject.sub_name, subject.path
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn get_sub_ppt_urls(
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    config: State<'_, Arc<Mutex<Config>>>,
    subs: Vec<Subject>,
) -> Result<Vec<Subject>, String> {
    info!("get_sub_ppt_urls");
    let mut zju_assist = zju_assist.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    let mut new_subs = Vec::new();
    let save_path = config.lock().await.save_path.clone();

    let mut tasks: Vec<JoinHandle<Result<Subject, String>>> = Vec::new();
    for sub in subs.into_iter() {
        let path = Path::new(&save_path)
            .join(&sub.course_name)
            .to_str()
            .unwrap()
            .to_string();
        let zju_assist = zju_assist.clone();
        let task = tokio::task::spawn(async move {
            let urls_res = zju_assist
                .get_ppt_urls(sub.course_id, sub.sub_id)
                .await
                .map_err(|err| err.to_string());
            let urls;
            if let Ok(urls_res) = urls_res {
                urls = urls_res;
            } else {
                tokio::time::sleep(Duration::from_secs(1)).await;
                // retry once
                urls = zju_assist
                    .get_ppt_urls(sub.course_id, sub.sub_id)
                    .await
                    .map_err(|err| err.to_string())?;
            }
            Ok(Subject {
                ppt_image_urls: urls,
                path,
                ..sub
            })
        });
        tasks.push(task);
        // delay 25ms to avoid too many requests
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    for task in tasks {
        let sub = task.await.map_err(|err| err.to_string())??;
        if sub.ppt_image_urls.len() > 0 {
            new_subs.push(sub);
        }
    }

    Ok(new_subs)
}

#[tauri::command]
pub async fn get_range_subs(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    config: State<'_, Arc<Mutex<Config>>>,
    start_at: String, // format: 2021-05-01
    end_at: String,
) -> Result<Vec<Subject>, String> {
    info!("get_range_subs: {} {}", start_at, end_at);
    let mut zju_assist = state.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    let mut subs = Vec::new();
    let mut tasks: Vec<JoinHandle<Result<Vec<Subject>, String>>> = Vec::new();
    let start = NaiveDate::parse_from_str(&start_at, "%Y-%m-%d").unwrap();
    let end = NaiveDate::parse_from_str(&end_at, "%Y-%m-%d").unwrap();
    let mut date = start;
    while date <= end {
        let date_str = date.format("%Y-%m-%d").to_string();
        let zju_assist = zju_assist.clone();
        tasks.push(tokio::task::spawn(async move {
            let sub = zju_assist
                .get_range_subs(&date_str, &date_str)
                .await
                .map_err(|err| err.to_string())?;
            Ok(sub)
        }));
        date = date + chrono::Duration::try_days(1).unwrap();
    }

    for task in tasks {
        let sub = task.await.map_err(|err| err.to_string())??;
        subs.extend(sub);
    }

    get_sub_ppt_urls(state, config, subs).await
}

#[tauri::command]
pub async fn get_month_subs(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    config: State<'_, Arc<Mutex<Config>>>,
    month: String,
) -> Result<Vec<Subject>, String> {
    info!("get_month_subs: {}", month);
    let mut zju_assist = state.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    let subs = zju_assist
        .get_month_subs(&month)
        .await
        .map_err(|err| err.to_string())?;
    get_sub_ppt_urls(state, config, subs).await
}

#[tauri::command]
pub async fn search_courses(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_name: String,
    teacher_name: String,
) -> Result<Vec<Subject>, String> {
    info!("search_courses: {} {}", course_name, teacher_name);
    let mut zju_assist = state.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    let courses = zju_assist
        .search_courses(&course_name, &teacher_name)
        .await
        .map_err(|err| err.to_string())?;
    let courses = courses
        .into_iter()
        .map(|course| {
            let course = course.as_object().unwrap();
            let course_id = course["course_id"].as_i64().unwrap_or(0);
            let course_name = course["title"].as_str().unwrap_or("").to_string();
            let lecturer_name = course["realname"].as_str().unwrap_or("").to_string();
            let path = "".to_string();
            let ppt_image_urls = Vec::new();
            let sub_id = 0;
            let sub_name = course
                .get("term_name")
                .map_or("", |v| v.as_str().unwrap_or(""))
                .to_string();
            Subject {
                course_id,
                course_name,
                lecturer_name,
                path,
                ppt_image_urls,
                sub_id,
                sub_name,
            }
        })
        .collect::<Vec<Subject>>();
    Ok(courses)
}

#[tauri::command]
pub async fn get_course_all_sub_ppts(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    config: State<'_, Arc<Mutex<Config>>>,
    course_ids: Vec<i64>,
) -> Result<Vec<Subject>, String> {
    info!("get_course_subs");
    let mut zju_assist = state.lock().await.clone();
    zju_assist
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    let mut subs = Vec::new();
    for course_id in course_ids {
        let sub = zju_assist
            .get_course_subs(course_id)
            .await
            .map_err(|err| err.to_string())?;
        subs.extend(sub);
    }
    get_sub_ppt_urls(state, config, subs).await
}

#[tauri::command]
pub async fn check_undergraduate_evaluation_done(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
    window: Window,
) -> Result<bool, String> {
    info!("check_undergraduate_evaluation_done");
    let mut zju_assist = state.lock().await.clone();
    let res = zju_assist
        .check_undergraduate_evaluation_done()
        .await
        .map_err(|err| err.to_string())?;

    drop(zju_assist);

    // if need evaluation, and the window is hide, send notification
    if !res && !window.is_visible().unwrap_or(false) {
        if let Err(error) = handle
            .notification()
            .builder()
            .title("教学评价未完成")
            .body("本学期尚未完成评价，无法查询最新成绩！")
            .show()
        {
            log::warn!("Failed to send evaluation notification: {}", error);
        }
    }

    Ok(res)
}

#[tauri::command]
pub async fn check_graduate_evaluation_done(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
    window: Window,
) -> Result<bool, String> {
    info!("check_graduate_evaluation_done");
    let mut zju_assist = state.lock().await.clone();
    let res = zju_assist
        .check_graduate_evaluation_done()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist);

    if !res && !window.is_visible().unwrap_or(false) {
        if let Err(error) = handle
            .notification()
            .builder()
            .title("研究生教学评价未完成")
            .body("部分课程需完成评价后才能查看成绩，请完成后重新刷新。")
            .show()
        {
            log::warn!("Failed to send evaluation notification: {}", error);
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn get_undergraduate_score(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<Vec<Value>, String> {
    info!("get_undergraduate_score");
    let mut zju_assist = state.lock().await.clone();
    let started = std::time::Instant::now();
    let result = zju_assist.get_undergraduate_score().await;
    info!(
        "get_undergraduate_score: success={}, elapsed={}ms",
        result.is_ok(),
        started.elapsed().as_millis()
    );
    result.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_graduate_score(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<Vec<Value>, String> {
    info!("get_graduate_score");
    let mut zju_assist = state.lock().await.clone();
    let started = std::time::Instant::now();
    let result = zju_assist.get_graduate_score().await;
    info!(
        "get_graduate_score: success={}, elapsed={}ms",
        result.is_ok(),
        started.elapsed().as_millis()
    );
    result.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn notify_score(
    handle: AppHandle,
    score: Value,
    old_total_gp: f64,
    old_total_credit: f64,
    total_gp: f64,
    total_credit: f64,
    ding_url: String,
    ding_secret: Option<String>,
    system_enabled: Option<bool>,
) -> Result<(), String> {
    info!("notify_score");

    // TODO: Add makeup_grade support

    let course_id = score["course_id"].as_str().unwrap();
    let course_name = score["course_name"].as_str().unwrap();
    let grade = score["grade"].as_str().unwrap();
    let credits = score["credits"].as_str().unwrap();
    let grade_point = score["grade_point"].as_str().unwrap();

    let old_gpa = if old_total_credit == 0.0 {
        0.0
    } else {
        old_total_gp / old_total_credit
    };
    let new_gpa = if total_credit == 0.0 {
        0.0
    } else {
        total_gp / total_credit
    };

    let mut errors = Vec::new();
    if !ding_url.trim().is_empty() {
        let text = if grade_point.trim().is_empty() {
            format!("### 考试成绩通知\n - **选课课号** {}\n - **课程名称** {}\n - **成绩** {}\n - **学分** {}", course_id, course_name, grade, credits)
        } else {
            format!(
            "### 考试成绩通知\n - **选课课号** {}\n - **课程名称** {}\n - **成绩** {}\n - **学分** {}\n - **绩点** {}\n - **成绩变化** {:.2}({:+.2}) / {:.1}({:+.1})",
            course_id, course_name, grade, credits, grade_point, new_gpa, new_gpa - old_gpa, total_credit, total_credit - old_total_credit
        )
        };
        if let Err(error) = crate::utils::dingtalk::send(
            &ding_url,
            ding_secret.as_deref().unwrap_or(""),
            "考试成绩通知",
            &text,
        )
        .await
        {
            errors.push(error);
        }
    }

    if system_enabled.unwrap_or(true) {
        if let Err(error) = handle
            .notification()
            .builder()
            .title(&format!("考试成绩通知 - {}", course_name))
            .body(&if grade_point.trim().is_empty() {
                format!("成绩: {}\n学分: {}", grade, credits)
            } else {
                format!(
                    "成绩: {}\n学分: {}\n绩点: {}\n成绩变化: {:.2}({:+.2}) / {:.1}({:+.1})",
                    grade,
                    credits,
                    grade_point,
                    new_gpa,
                    new_gpa - old_gpa,
                    total_credit,
                    total_credit - old_total_credit
                )
            })
            .show()
        {
            errors.push(error.to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[tauri::command]
pub async fn send_ding_notification(
    ding_url: String,
    ding_secret: String,
    title: String,
    text: String,
) -> Result<(), String> {
    crate::utils::dingtalk::send(&ding_url, &ding_secret, &title, &text).await
}

#[tauri::command]
pub async fn get_notification_scope(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
) -> Result<String, String> {
    Ok(state.lock().await.get_username().to_string())
}

#[tauri::command]
pub async fn get_config(
    config: State<'_, Arc<Mutex<Config>>>,
    store: State<'_, crate::utils::config_store::ConfigStore>,
) -> Result<Config, String> {
    let mut current = config.lock().await;
    let loaded = store.load()?;
    *current = loaded.clone();
    Ok(loaded)
}

// Startup initializes this snapshot with complete platform defaults and replaces
// it only after a successful load/save. Reading it never touches the config file.
#[tauri::command]
pub async fn get_runtime_config(config: State<'_, Arc<Mutex<Config>>>) -> Result<Config, String> {
    Ok(config.lock().await.clone())
}

#[tauri::command]
pub async fn set_config(
    handle: AppHandle,
    config_state: State<'_, Arc<Mutex<Config>>>,
    store: State<'_, crate::utils::config_store::ConfigStore>,
    patch: serde_json::Map<String, Value>,
) -> Result<Config, String> {
    let mut current = config_state.lock().await;
    store.update(&mut current, patch, |enabled| {
        let manager = handle.autolaunch();
        if enabled {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn test_llm_connection(
    api_base: String,
    api_key: String,
    model: String,
) -> Result<(), String> {
    info!("test_llm_connection: base={} model={}", api_base, model);

    let client = reqwest::Client::new();

    // 保持与 summarize_subtitle 一致的 URL 处理逻辑
    let api_url = normalize_llm_api_url(&api_base);

    // 发送一个极简请求
    let payload = json!({
        "model": model,
        "messages": [
            { "role": "user", "content": "Hi" }
        ],
        "max_tokens": 1 // 节省 token
    });

    let res = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API 报错 ({}): {}", status, text));
    }

    Ok(())
}
