use crate::model::{Config, Progress, Subject, Upload};
use crate::utils::{export_todo_ics, images_to_pdf};
use crate::zju_assist::{ZjuAssist, SubtitleContent};
use crate::utils::format_srt_timestamp;

use regex::Regex;
use chrono::{DateTime, Local, NaiveDate, Utc};
use dashmap::DashMap;
use futures::TryStreamExt;
use keyring::Entry;
use log::{debug, info};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::cmp::min;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use std::{path::Path, process::Command, sync::Arc};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[cfg(target_os = "macos")]
use crate::utils::macos::add_event;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub async fn login(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
    username: String,
    password: String,
    auto_login: bool,
) -> Result<(), String> {
    info!("login: {} auto_login: {}", username, auto_login);
    let mut zju_assist = state.lock().await;
    zju_assist
        .login(&username, &password)
        .await
        .map_err(|err| err.to_string())?;

    #[cfg(desktop)]
    let res = handle
        .app_handle()
        .tray_by_id("main")
        .unwrap()
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
    #[cfg(desktop)]
    if let Err(e) = res {
        return Err(e.to_string());
    }

    if auto_login {
        let entry = Entry::new("zju-assist", "auto-login").map_err(|err| err.to_string())?;
        entry
            .set_password(&format!("{}\n{}", username, password))
            .map_err(|err| err.to_string())?;
    } else {
        let entry = Entry::new("zju-assist", "auto-login");
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return Ok(()),
        };
        let _ = entry.delete_password();
    }

    Ok(())
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
    let mut zju_assist = state.lock().await;
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
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
) -> Result<Vec<Value>, String> {
    info!("sync_todo_once");
    let zju_assist = zju_assist.lock().await.clone();
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

    #[cfg(desktop)]
    handle
        .tray_by_id("main")
        .unwrap()
        .set_menu(Some(menu))
        .unwrap();

    Ok(todo_list)
}

#[tauri::command]
pub fn export_todo(
    handle: AppHandle,
    window: Window,
    todo_list: Vec<Value>,
    location: String,
) -> Result<(), String> {
    info!("export_todo to {}", location);

    if location == "help" {
        let res = handle.shell().open(
            "https://github.com/PeiPei233/zju-learning-assistant?tab=readme-ov-file#导出学在浙大待办事项",
            None,
        )
        .map_err(|err| err.to_string());
        if let Err(err) = res {
            handle
                .notification()
                .builder()
                .title("打开帮助页面失败")
                .body(&err)
                .show()
                .unwrap();
        }

        return Ok(());
    } else if location.starts_with("ics") {
        #[cfg(desktop)]
        window.set_focus().unwrap();
        #[cfg(desktop)]
        handle
            .dialog()
            .file()
            .add_filter("iCalendar", &[&"ics"])
            .set_file_name("Todo")
            .set_parent(&window)
            .save_file(move |ics_path| {
                let ics_path = match ics_path {
                    Some(ics_path) => ics_path,
                    None => return,
                };
                let res = export_todo_ics(todo_list, &ics_path.to_string())
                    .map_err(|err| err.to_string());
                match res {
                    Ok(_) => {
                        handle
                            .notification()
                            .builder()
                            .title("导出待办事项成功")
                            .body(&format!("文件已保存至：{}", ics_path.to_string()))
                            .show()
                            .unwrap();
                    }
                    Err(err) => {
                        handle
                            .notification()
                            .builder()
                            .title("导出待办事项失败")
                            .body(&err)
                            .show()
                            .unwrap();
                    }
                }
            });
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let mut todo_list_with_end_time = todo_list
            .iter()
            .filter(|todo| !todo["end_time"].is_null())
            .map(|todo| todo.clone())
            .collect::<Vec<_>>();

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

        let app_name = match location.as_str() {
            "calendar" => "日历 App ",
            "reminder" => "提醒事项 App ",
            _ => return Err("Invalid location".to_string()),
        };
        let script_path = match location.as_str() {
            "calendar" => "scripts/export_todo_calendar.applescript",
            "reminder" => "scripts/export_todo_reminder.applescript",
            _ => return Err("Invalid location".to_string()),
        };
        let script_path = handle
            .path()
            .resolve(script_path, BaseDirectory::Resource)
            .expect("Failed to resolve script path");

        for todo in todo_list_with_end_time.iter() {
            let end_time = todo["end_time"]
                .as_str()
                .unwrap_or("1970-01-01T00:00:00Z")
                .parse::<DateTime<Utc>>()
                .unwrap_or("1970-01-01T00:00:00Z".parse().unwrap());
            let course_name = todo["course_name"].as_str().unwrap();
            let title = todo["title"].as_str().unwrap();
            let url = format!(
                "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
                todo["course_id"].as_i64().unwrap(),
                todo["id"].as_i64().unwrap()
            );

            let mut use_apple_script = true;
            if location == "calendar" {
                let res = add_event(title, course_name, &url, end_time, end_time)
                    .map_err(|err| err.to_string());
                if let Err(err) = res {
                    println!("export_todo: add_event failed {}", err);
                } else {
                    use_apple_script = false; // skip apple script if add_event success
                }
            }
            if use_apple_script {
                let end_time = end_time
                    .with_timezone(&Local)
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string();
                let res = Command::new("osascript")
                    .arg(&script_path)
                    .arg(&title)
                    .arg(&end_time)
                    .arg(&course_name)
                    .arg(&url)
                    .output()
                    .map_err(|err| err.to_string());
                if let Err(err) = res {
                    println!("export_todo: {}", err);
                    handle
                        .notification()
                        .builder()
                        .title(&format!("添加待办事项到{}失败", app_name))
                        .body(&err)
                        .show()
                        .unwrap();
                    return Err(err);
                }
            }
        }

        if location == "reminder" {
            // add those with no end time to reminder
            for todo in todo_list.iter() {
                if todo["end_time"].is_null() {
                    let course_name = todo["course_name"].as_str().unwrap();
                    let title = todo["title"].as_str().unwrap();
                    let url = format!(
                        "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
                        todo["course_id"].as_i64().unwrap(),
                        todo["id"].as_i64().unwrap()
                    );

                    let res = Command::new("osascript")
                        .arg(&script_path)
                        .arg(&title)
                        .arg("None")
                        .arg(&course_name)
                        .arg(&url)
                        .output()
                        .map_err(|err| err.to_string());
                    if let Err(err) = res {
                        println!("export_todo: {}", err);
                        handle
                            .notification()
                            .builder()
                            .title(&format!("添加待办事项到{}失败", app_name))
                            .body(&err)
                            .show()
                            .unwrap();
                        return Err(err);
                    }
                }
            }
        }

        handle
            .notification()
            .builder()
            .title(&format!("添加待办事项到{}", app_name))
            .body("添加成功")
            .show()
            .unwrap();
    }
    Ok(())
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
            if !Path::new(&filepath).exists()
                || Path::new(&filepath).metadata().unwrap().len() != upload.size as u64
            {
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
        .await
        .map_err(|err| err.to_string())?;

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

    let content_length = res.content_length().unwrap_or(upload.size as u64);
    let mut file_name = upload.file_name.clone();
    let url = res.url().to_string();
    if let Some(start) = url.find("name=") {
        let start = start + 5;
        let end = url[start..].find("&").unwrap_or(url.len() - start);
        file_name = percent_decode_str(&url[start..start + end])
            .decode_utf8_lossy()
            .to_string();
    }
    let filepath = Path::new(&upload.path).join(&file_name);

    info!("download_upload - filepath: {:?}", filepath);

    // if path exists, and size match, then skip
    if sync_upload && filepath.exists() && filepath.metadata().unwrap().len() == content_length {
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
                    msg: "下载完成".to_string()
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
                            msg: "下载失败".to_string(),
                        },
                    )
                    .unwrap();
                info!(
                    "download_upload: fail {} {} {} {}",
                    upload.id, upload.reference_id, upload.file_name, upload.path
                );
                // clean up
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
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
                            msg: "已取消".to_string(),
                        },
                    )
                    .unwrap();
                // clean up
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
                let res = tokio::fs::remove_file(&filepath.clone())
                    .await
                    .map_err(|e| e.to_string());
                if let Err(err) = res {
                    debug!("download_upload: clean up fail: {}", err);
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
                        msg: "下载中".to_string(),
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
                    msg: "下载完成".to_string(),
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
pub fn open_file_asr_text(handle: AppHandle, subject: Subject, folder: bool) -> Result<(), String> {
    info!(
        "open_file_asr_text: {}-{} {}",
        subject.course_name, subject.sub_name, folder
    );
    let path = Path::new(&subject.path)
        .join(&subject.sub_name)
        .to_str()
        .unwrap()
        .to_string();
    if Path::new(&path).exists() {
        let txt_path = Path::new(&path)
            .join(format!("asr_text.txt"))
            .to_str()
            .unwrap()
            .to_string();
        if Path::new(&txt_path).exists() {
            open_file(handle, txt_path, folder)
        } else {
            Err("转录文本文件已删除或未生成".to_string())
        }
    } else {
        Err("下载已删除或未下载".to_string())
    }
}

#[tauri::command]
pub async fn get_latest_version_info() -> Result<Value, String> {
    info!("get_latest_version_info");

    let client = ZjuAssist::new();

    let res = client
        .get("https://api.github.com/repos/PeiPei233/zju-learning-assistant/releases/latest")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let json = res.json::<Value>().await.map_err(|err| err.to_string())?;

    info!("get_latest_version_info: {:?}", json.get("tag_name"));

    Ok(json)
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

    let mut zju_assist_mut = zju_assist.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);

    // state -> true: downloading, false: cancel
    let download_state = Arc::new(AtomicBool::new(true));
    state.insert(id.clone(), download_state.clone());

    let zju_assist = zju_assist.lock().await.clone();
    let config = config_state.lock().await.clone();

    let ai_task_handle = if config.auto_download_subtitle || config.llm_enabled {
        let zju_clone = zju_assist.clone();
        let subject_clone = subject.clone();
        let config_clone = config.clone();
        let window_clone = window.clone();
        let bg_id = format!("{}-bg", id); 
        let state_clone = download_state.clone();

        Some(tokio::spawn(async move {
            // 检查取消状态
            if !state_clone.load(std::sync::atomic::Ordering::SeqCst) { return Ok(()); }

            // 1. 获取字幕
            match zju_clone.get_subtitle(subject_clone.sub_id).await {
                Ok(contents) => {
                    let contents: Vec<SubtitleContent> = contents;
                    if !contents.is_empty() {
                        let sub_dir = Path::new(&subject_clone.path).join(&subject_clone.sub_name);
                        let _ = std::fs::create_dir_all(&sub_dir);
                        let file_stem = format!("{}-{}", subject_clone.course_name, subject_clone.sub_name);

                        // 2. 保存字幕
                        if config_clone.auto_download_subtitle {
                            if let Err(e) = save_subtitle(&contents, &sub_dir, &file_stem, &config_clone).await {
                                info!("后台保存字幕失败: {}", e);
                            }
                        }

                        // 3. AI 总结
                        if config_clone.llm_enabled {
                            if !state_clone.load(std::sync::atomic::Ordering::SeqCst) { return Ok(()); }
                            if let Err(e) = summarize_subtitle(&contents, &sub_dir, &file_stem, &config_clone, &window_clone, &bg_id).await {
                                info!("后台 AI 总结失败: {}", e);
                                return Err(format!("AI总结失败: {}", e));
                            }
                        }
                    }
                    Ok(())
                },
                Err(e) => Err(format!("获取字幕失败: {}", e))
            }
        }))
    } else {
        None
    };

    let ppt_task_result = async {
        let mut count = 0;
        let total_size = subject.ppt_image_urls.len();
        let path = Path::new(&subject.path).join(&subject.sub_name);
        let urls = subject.ppt_image_urls.clone();

        let image_paths = urls.clone().into_iter().zip(1..=urls.len()).map(|(url, i)| {
            path.join("ppt_images").join(format!("{}.{}", i, url.split('.').last().unwrap())).to_str().unwrap().to_string()
        }).collect::<Vec<_>>();

        let mut tasks: Vec<JoinHandle<Result<(), String>>> = Vec::new();
        for (url, path) in urls.clone().into_iter().zip(image_paths.clone().into_iter()) {
            let zju_assist = zju_assist.clone();
            tasks.push(tokio::task::spawn(async move {
                let res = zju_assist.download_ppt_image(&url, &path).await.map_err(|err| err.to_string());
                if let Err(_) = res {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    return zju_assist.download_ppt_image(&url, &path).await.map_err(|err| err.to_string());
                }
                Ok(())
            }));
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        for task in &mut tasks {
            if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
                for task in tasks { task.abort(); }
                let _ = std::fs::remove_dir_all(&path);
                return Err("已取消".to_string());
            }

            window.emit("download-progress", Progress {
                id: id.clone(), status: "downloading".to_string(),
                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                downloaded_size: count, total_size: total_size as u64, msg: "下载 PPT 中".to_string()
            }).unwrap();

            let res = task.await.map_err(|e| e.to_string())?;
            if let Err(e) = res {
                let _ = std::fs::remove_dir_all(&path);
                return Err(format!("下载图片失败: {}", e));
            }
            count += 1;
        }

        if urls.len() > 0 && to_pdf {
            if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
                let _ = std::fs::remove_dir_all(&path);
                return Err("已取消".to_string());
            }

            let pdf_path = path.join(format!("{}-{}.pdf", subject.course_name, subject.sub_name)).to_str().unwrap().to_string();
            
            window.emit("download-progress", Progress {
                id: id.clone(), status: "writing".to_string(),
                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                downloaded_size: count, total_size: total_size as u64, msg: "正在合成 PDF".to_string()
            }).unwrap();

            if let Err(e) = images_to_pdf(image_paths, &pdf_path) {
                let _ = std::fs::remove_dir_all(&path);
                return Err(format!("PDF 合成失败: {}", e));
            }
        }
        
        Ok::<(), String>(())
    }.await; // 等待 PPT 流程结束

    // 处理 PPT 任务结果（失败或取消）
    if let Err(e) = ppt_task_result {
        if e != "已取消" {
            window.emit("download-progress", Progress {
                id: id.clone(), status: "failed".to_string(),
                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                downloaded_size: 0, total_size: 100, msg: e
            }).unwrap();
        } else {
             window.emit("download-progress", Progress {
                id: id.clone(), status: "canceled".to_string(),
                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                downloaded_size: 0, total_size: 100, msg: "已取消".to_string()
            }).unwrap();
        }
        // 如果主任务失败，也要等待/取消后台 AI 任务
        if let Some(handle) = ai_task_handle { handle.abort(); }
        return Ok(());
    }

    if let Some(handle) = ai_task_handle {
        // 此时 PPT 已完成，如果 AI 还没完，更新 UI 提示
        if !handle.is_finished() {
            window.emit("download-progress", Progress {
                id: id.clone(), status: "downloading".to_string(),
                file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                // 进度条设为 99% 或循环状态，提示用户正在等待 AI
                downloaded_size: 99, total_size: 100, msg: "PPT 完成，等待 AI 总结...".to_string()
            }).unwrap();
        }

        // 真正的回收点
        match handle.await {
            Ok(res) => {
                if let Err(e) = res {
                    info!("AI 任务报错: {}", e);
                }
            },
            Err(_) => {
                info!("AI 任务被取消或 Panic");
            }
        }
    }

    if !download_state.load(std::sync::atomic::Ordering::SeqCst) {
         window.emit("download-progress", Progress {
            id: id.clone(), status: "canceled".to_string(), file_name: format!("{}-{}", subject.course_name, subject.sub_name),
            downloaded_size: 0, total_size: 100, msg: "已取消".to_string()
        }).unwrap();
        return Ok(());
    }

    window.emit("download-progress", Progress {
        id: id.clone(), status: "done".to_string(),
        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
        downloaded_size: 100, total_size: 100, msg: "全部完成".to_string()
    }).unwrap();
    
    info!("download_ppts: done {} {}", subject.course_name, subject.sub_name);

    Ok(())
}
#[tauri::command]
pub async fn start_download_asr_text(
    zju_assist: State<'_, Arc<Mutex<ZjuAssist>>>,
    state: State<'_, DashMap<String, Arc<AtomicBool>>>,
    window: Window,
    id: String,
    subject: Subject,
) -> Result<(), String> {
    info!(
        "start_download_asr_text: {} {} {}",
        id, subject.course_name, subject.sub_name
    );

    let mut zju_assist_mut = zju_assist.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);

    let zju_assist = zju_assist.lock().await.clone();
    let path = Path::new(&subject.path).join(&subject.sub_name);
    debug!("start_download_asr_text - path: {:?}", path);

    // state -> true: downloading, false: cancel
    let download_state = Arc::new(AtomicBool::new(true));
    state.insert(id.clone(), download_state.clone());
    let res = zju_assist.download_asr_text(subject.sub_id, &path).await;

    match res {
        Ok(()) => {
            info!(
                "download_asr_text: done {} {} {}",
                subject.course_name, subject.sub_name, subject.path
            );
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "done".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: 1,
                        total_size: 1,
                    },
                )
                .unwrap();
            Ok(())
        }
        Err(err) => {
            info!(
                "download_asr_text: fail {} {} {} {}",
                subject.course_name, subject.sub_name, subject.path, err
            );
            window
                .emit(
                    "download-progress",
                    Progress {
                        id: id.clone(),
                        status: "fail".to_string(),
                        file_name: format!("{}-{}", subject.course_name, subject.sub_name),
                        downloaded_size: 0,
                        total_size: 1,
                    },
                )
                .unwrap();
            Err(err.to_string())
        }
    }
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

    let mut zju_assist_mut = zju_assist.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);

    let zju_assist = zju_assist.lock().await.clone();
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
                    msg: "下载完成".to_string()
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
                            msg: "".to_string()
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
                            msg: "".to_string()
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
                            msg: "".to_string()
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
                        msg: "".to_string()
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
                    msg: "".to_string()
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
    let mut zju_assist_mut = zju_assist.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);
    let zju_assist = zju_assist.lock().await.clone();
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
    let mut zju_assist_mut = state.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);
    let zju_assist = state.lock().await.clone();
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
    let mut zju_assist_mut = state.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);
    let zju_assist = state.lock().await.clone();
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
    let mut zju_assist_mut = state.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);
    let zju_assist = state.lock().await.clone();
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
    let mut zju_assist_mut = state.lock().await;
    zju_assist_mut
        .keep_classroom_alive()
        .await
        .map_err(|err| err.to_string())?;
    drop(zju_assist_mut);
    let zju_assist = state.lock().await.clone();
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
pub async fn check_evaluation_done(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    handle: AppHandle,
    window: Window,
) -> Result<bool, String> {
    info!("check_evaluation_done");
    let mut zju_assist = state.lock().await;
    let res = zju_assist
        .check_evaluation_done()
        .await
        .map_err(|err| err.to_string())?;

    drop(zju_assist);

    // if need evaluation, and the window is hide, send notification
    if !res && !window.is_visible().unwrap_or(false) {
        handle
            .notification()
            .builder()
            .title("教学评价未完成")
            .body("本学期尚未完成评价，无法查询最新成绩！")
            .show()
            .map_err(|err| err.to_string())?;
    }

    Ok(res)
}

#[tauri::command]
pub async fn get_score(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
    info!("get_score");
    let mut zju_assist = state.lock().await;
    let score = zju_assist
        .get_score()
        .await
        .map_err(|err| err.to_string())?;
    Ok(score)
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
) -> Result<(), String> {
    info!("notify_score");

    // TODO: Add bkcj support

    let xkkh = score["xkkh"].as_str().unwrap();
    let kcmc = score["kcmc"].as_str().unwrap();
    let cj = score["cj"].as_str().unwrap();
    let xf = score["xf"].as_str().unwrap();
    let jd = score["jd"].as_str().unwrap();

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

    if !ding_url.is_empty() {
        let markdown_text = format!(
            "### 考试成绩通知\n - **选课课号**\t{}\n - **课程名称**\t{}\n - **成绩**\t{}\n - **学分**\t{}\n - **绩点**\t{}\n - **成绩变化**\t{:.2}({:+.2}) / {:.1}({:+.1})",
            xkkh, kcmc, cj, xf, jd, new_gpa, new_gpa - old_gpa, total_credit, total_credit - old_total_credit
        );
        info!("notify_score - ding md text: {}", markdown_text);
        let json = json!({
            "msgtype": "markdown",
            "markdown": {
                "title": "考试成绩通知",
                "text": markdown_text
            }
        });
        let client = reqwest::Client::new();
        let res = client
            .post(&ding_url)
            .json(&json)
            .send()
            .await
            .map_err(|err| err.to_string())?;
        info!("notify_score - ding res: {:?}", res);
    }

    // notify_rust::Notification::new()
    //     .summary(&format!("考试成绩通知 - {}", kcmc))
    //     .body(&format!(
    //         "成绩: {}\n学分: {}\n绩点: {}\n成绩变化: {:.2}({:+.2}) / {:.1}({:+.1})",
    //         cj,
    //         xf,
    //         jd,
    //         new_gpa,
    //         new_gpa - old_gpa,
    //         total_credit,
    //         total_credit - old_total_credit
    //     ))
    //     .show()
    //     .map_err(|err| err.to_string())?;

    handle
        .notification()
        .builder()
        .title(&format!("考试成绩通知 - {}", kcmc))
        .body(&format!(
            "成绩: {}\n学分: {}\n绩点: {}\n成绩变化: {:.2}({:+.2}) / {:.1}({:+.1})",
            cj,
            xf,
            jd,
            new_gpa,
            new_gpa - old_gpa,
            total_credit,
            total_credit - old_total_credit
        ))
        .show()
        .unwrap();

    Ok(())
}

#[tauri::command]
pub async fn get_config(config: State<'_, Arc<Mutex<Config>>>) -> Result<Config, String> {
    info!("get_config");
    Ok(config.lock().await.clone())
}

#[tauri::command]
pub async fn set_config(
    handle: AppHandle,
    config_state: State<'_, Arc<Mutex<Config>>>,
    config: Config,
) -> Result<(), String> {
    info!("set_config");
    // 检查 llm_temperature 范围
    if config.llm_temperature < 0.0 || config.llm_temperature > 2.0 {
        return Err("LLM 温度值必须在 0.0 到 2.0 之间".to_string());
    }
    let mut current_config = config_state.lock().await;
    let origin_auto_start = current_config.auto_start;
    let new_auto_start = config.auto_start;
    if origin_auto_start != new_auto_start {
        if new_auto_start {
            let autostart_manager = handle.autolaunch();
            autostart_manager.enable().map_err(|err| err.to_string())?;
        } else {
            let autostart_manager = handle.autolaunch();
            autostart_manager.disable().map_err(|err| err.to_string())?;
        }
    }
    *current_config = config.clone();
    drop(current_config);

    // save config to file
    if let Ok(config_path) = handle.path().app_config_dir() {
        // if config path not exists, create it
        if !config_path.exists() {
            std::fs::create_dir_all(config_path.clone()).map_err(|err| err.to_string())?;
        }
        let config_str = serde_json::to_string_pretty(&config).unwrap();
        std::fs::write(config_path.join("config.json"), config_str)
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn save_subtitle(
    contents: &Vec<SubtitleContent>,
    base_path: &Path,
    file_stem: &str,
    config: &Config,
) -> Result<(), String> {
    info!("save_subtitle: 开始保存字幕, 语言配置: {:?}", config.subtitle_language);

    for lang in &config.subtitle_language {
        // 根据选项确定文件后缀和是否为双语模式
        let (suffix, is_mixed, is_en) = match lang.as_str() {
            "zh" => ("zh", false, false),
            "en" => ("en", false, true),
            "mixed" => ("zh-en", true, false), // 中英穿插
            _ => continue, // 未知选项跳过
        };
        
        let ext = match config.subtitle_format.as_str() {
            "srt" => "srt",
            "md" => "md",
            "txt" => "txt",
            _ => "srt",
        };

        // 文件名类似：课程名-子课程名.zh-en.srt
        let file_name = format!("{}.{}.{}", file_stem, suffix, ext);
        let file_path = base_path.join(&file_name);
        
        info!("save_subtitle: 正在处理语言 {}, 目标路径: {:?}", lang, file_path);
        
        let mut file_content = String::new();

        for (index, content) in contents.iter().enumerate() {
            // 获取文本内容
            let text_content = if is_mixed {
                // 双语穿插：中文在上，英文在下（如果都有的话）
                let zh = &content.text;
                let en = &content.trans_text;
                if en.trim().is_empty() {
                    zh.clone()
                } else if zh.trim().is_empty() {
                    en.clone()
                } else {
                    format!("{}\n{}", zh, en)
                }
            } else if is_en {
                content.trans_text.clone()
            } else {
                content.text.clone()
            };

            if text_content.trim().is_empty() {
                continue;
            }

            match config.subtitle_format.as_str() {
                "srt" => {
                    file_content.push_str(&format!("{}\n", index + 1));
                    file_content.push_str(&format!(
                        "{} --> {}\n",
                        format_srt_timestamp(content.begin_sec),
                        format_srt_timestamp(content.end_sec)
                    ));
                    file_content.push_str(&text_content);
                    file_content.push_str("\n\n");
                }
                "md" => {
                    if config.subtitle_with_timestamps {
                        file_content.push_str(&format!(
                            "**[{}]**\n{}\n\n",
                            format_srt_timestamp(content.begin_sec),
                            text_content
                        ));
                    } else {
                        file_content.push_str(&text_content);
                        file_content.push_str("\n\n");
                    }
                }
                "txt" => {
                    if config.subtitle_with_timestamps {
                        file_content.push_str(&format!(
                            "[{}]\n{}\n\n",
                            format_srt_timestamp(content.begin_sec),
                            text_content
                        ));
                    } else {
                        file_content.push_str(&text_content);
                        file_content.push_str("\n");
                    }
                }
                _ => {}
            }
        }

        if !file_content.is_empty() {
            tokio::fs::write(&file_path, file_content)
                .await
                .map_err(|e| format!("保存字幕失败: {}", e))?;
            info!("Saved subtitle success: {:?}", file_path);
        } else {
            info!("Skipped saving {:?}: Content is empty", file_name);
        }
    }
    Ok(())
}

async fn summarize_subtitle(
    contents: &Vec<SubtitleContent>,
    base_path: &Path,
    file_stem: &str,
    config: &Config,
    window: &Window,
    id: &str,
) -> Result<(), String> {
    // 1. 检查开关和 API Key
    if !config.llm_enabled {
        return Ok(());
    }
    if config.llm_api_key.is_empty() {
        info!("LLM enabled but no API Key provided, skipping summary.");
        // 可以选择在这里给前端发个提示，或者静默跳过
        return Ok(());
    }

    info!("summarize_subtitle: 开始 AI 总结 - {}", file_stem);

    // 发送进度提示：正在总结
    let _ = window.emit("download-progress", Progress {
        id: id.to_string(),
        status: "downloading".to_string(),
        file_name: format!("{}-AI总结", file_stem),
        downloaded_size: 60, 
        total_size: 100,
        msg: "正在进行 AI 总结...".to_string(),
    });

    // 2. 准备 Prompt 和 上下文
    let system_prompt = if config.llm_prompt.trim().is_empty() {
        "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。"
    } else {
        &config.llm_prompt
    };

    // 拼接所有字幕文本（使用原文字幕 text，通常比 trans_text 更准确）
    // 如果需要更精细的控制（比如只总结英文），可以根据 subtitle_language 判断
    let full_text = contents.iter()
        .map(|c| c.text.clone())
        .collect::<Vec<String>>()
        .join("\n");

    // 3. 构建请求
    let client = reqwest::Client::new();

    let api_url = normalize_llm_api_url(&config.llm_api_base);

    let payload = json!({
        "model": config.llm_model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": full_text }
        ],
        "temperature": config.llm_temperature,
        "stream": false 
    });

    // 4. 调用 API
    let res = client.post(&api_url)
        .header("Authorization", format!("Bearer {}", config.llm_api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("LLM 请求失败: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("LLM API 返回错误 {}: {}", status, text));
    }

    let json: Value = res.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    
    // 提取内容
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("响应中未找到 content 字段")?;
    
    let mut summary_text = content.to_string();

    // 5. 过滤 <think> 标签 (针对 DeepSeek R1 等推理模型)
    if config.llm_hide_think_tag {
        // 使用 (?s) 开启 dot matches newline 模式
        if let Ok(re) = Regex::new(r"(?s)<think>.*?</think>") {
            summary_text = re.replace_all(&summary_text, "").to_string();
            summary_text = summary_text.trim().to_string();
        }
    }

    // 6. 保存为 Markdown 文件
    let file_name = format!("{}-AI总结.md", file_stem);
    let file_path = base_path.join(&file_name);
    
    tokio::fs::write(&file_path, summary_text).await.map_err(|e| format!("写入总结文件失败: {}", e))?;
    info!("AI 总结已保存: {:?}", file_path);

    // 发送进度提示：完成
    let _ = window.emit("download-progress", Progress {
        id: id.to_string(),
        status: "downloading".to_string(), // 保持 downloading，直到整个任务结束
        file_name: file_name,
        downloaded_size: 100,
        total_size: 100,
        msg: "AI 总结完成".to_string(),
    });

    Ok(())
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

    let res = client.post(&api_url)
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


// Helper: 规范化 LLM API URL，确保以 /chat/completions 结尾
fn normalize_llm_api_url(base: &str) -> String {
    let base_trimmed = base.trim_end_matches('/');
    if base_trimmed.ends_with("/v1") {
        format!("{}/chat/completions", base_trimmed)
    } else if base_trimmed.contains("chat/completions") {
        base_trimmed.to_string()
    } else {
        format!("{}/chat/completions", base_trimmed)
    }
}