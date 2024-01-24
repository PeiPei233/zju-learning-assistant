use crate::model;
use crate::model::Subject;
use crate::util::images_to_pdf;
use crate::zju_assist::{download_ppt_image, get_ppt_urls, ZjuAssist};

use chrono::NaiveDate;
use futures::TryStreamExt;
use log::{debug, info};
use model::{DownloadState, Progress, Uploads};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::{path::Path, process::Command, sync::Arc};
use tauri::{State, Window};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[tauri::command]
pub async fn login(
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
pub async fn check_login(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<bool, String> {
    info!("check_login");
    let zju_assist = state.lock().await;
    match zju_assist.is_login() {
        true => Ok(true),
        false => Err("Not login".to_string()),
    }
}

#[tauri::command]
pub async fn logout(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<(), String> {
    info!("logout");
    let mut zju_assist = state.lock().await;
    zju_assist.logout();
    Ok(())
}

#[tauri::command]
pub async fn get_courses(state: State<'_, Arc<Mutex<ZjuAssist>>>) -> Result<Vec<Value>, String> {
    info!("get_courses");
    let zju_assist = state.lock().await;
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
    let zju_assist = state.lock().await;
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
    let zju_assist = state.lock().await;
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
    let zju_assist = state.lock().await;
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
    let zju_assist = state.lock().await;
    zju_assist
        .get_homework_uploads(course_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn download_file(
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

#[tauri::command]
pub async fn get_uploads_list(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    courses: Value,
    sync_upload: bool,
) -> Result<Vec<Uploads>, String> {
    info!("get_uploads_list: {}", sync_upload);
    let zju_assist = state.lock().await.clone();
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut all_uploads = Vec::new();
    let mut tasks: Vec<JoinHandle<Result<Vec<Uploads>, String>>> = Vec::new();
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
                let reference_id = upload["reference_id"].as_i64().unwrap();
                let file_name = upload["name"].as_str().unwrap().to_string();
                let path = Path::new(&save_path)
                    .join(&course_name)
                    .to_str()
                    .unwrap()
                    .to_string();
                let size = upload["size"].as_u64().unwrap_or(1000) as u128;
                debug!(
                    "get_uploads_list: uploads - {} {} {} {}",
                    reference_id, file_name, path, size
                );
                uploads.push(Uploads {
                    reference_id,
                    file_name,
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
pub async fn download_uploads(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    window: Window,
    uploads: Vec<Uploads>,
    sync_upload: bool,
) -> Result<Vec<Uploads>, String> {
    info!("download_uploads: {} {}", uploads.len(), sync_upload);
    download_state
        .should_cancel
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let zju_assist = state.lock().await;
    let total_size = uploads.iter().map(|upload| upload.size).sum::<u128>();
    let mut downloaded_size: u128 = 0;
    let mut downloaded_uploads = Vec::new();
    for (i, upload) in uploads.iter().enumerate() {
        debug!(
            "download_uploads: start {} {} {} {}",
            i, upload.reference_id, upload.file_name, upload.path
        );
        if download_state
            .should_cancel
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "cancel".to_string(),
                        ..Default::default()
                    },
                )
                .unwrap();
            debug!("download_uploads: cancel");
            return Ok(downloaded_uploads);
        }
        let res = zju_assist
            .get_uploads_response(upload.reference_id)
            .await
            .map_err(|err| err.to_string())?;

        if !res.status().is_success() {
            debug!(
                "download_uploads: fail {} {} {}",
                i, upload.reference_id, upload.file_name
            );
            continue;
        }

        // create father dir if not exists
        std::fs::create_dir_all(Path::new(&upload.path)).map_err(|e| e.to_string())?;

        let content_length = res.content_length().unwrap_or(upload.size as u64) as u128;
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

        info!("download_uploads - filepath: {:?}", filepath);
        if sync_upload {
            // if path exists, and size match, then skip
            if filepath.exists() && filepath.metadata().unwrap().len() == content_length as u64 {
                debug!(
                    "download_uploads: skip {} {} {}",
                    i, upload.reference_id, upload.file_name
                );
                downloaded_size += upload.size;
                downloaded_uploads.push(upload.clone());
                continue;
            }
        }

        debug!(
            "download_uploads: stream {} {} {:?}",
            i, upload.reference_id, filepath
        );
        let mut file = tokio::fs::File::create(filepath.clone())
            .await
            .map_err(|e| e.to_string())?;
        let mut current_size: u128 = 0;
        let mut stream = res.bytes_stream();
        while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
            if download_state
                .should_cancel
                .load(std::sync::atomic::Ordering::SeqCst)
            {
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
        downloaded_uploads.push(upload.clone());
        debug!(
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
    Ok(downloaded_uploads)
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>) -> Result<(), String> {
    info!("cancel_download");
    state
        .should_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn update_path(
    state: State<'_, DownloadState>,
    path: String,
    uploads: Vec<Value>,
) -> Result<Vec<Value>, String> {
    info!("update_path: {}", path);
    let mut new_uploads = uploads.clone();
    for upload in &mut new_uploads {
        let new_path = Path::new(&path)
            .join(
                Path::new(upload["path"].as_str().unwrap())
                    .file_name()
                    .unwrap_or_default()
                    .to_str()
                    .unwrap(),
            )
            .to_str()
            .unwrap()
            .to_string();
        upload["path"] = Value::String(new_path);
    }

    let mut save_path = state.save_path.lock().unwrap();
    *save_path = path;

    Ok(new_uploads)
}

#[tauri::command]
pub fn open_save_path(state: State<'_, DownloadState>) -> Result<(), String> {
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
pub async fn download_ppts(
    state: State<'_, DownloadState>,
    window: Window,
    subs: Vec<Subject>,
    to_pdf: bool,
) -> Result<Vec<Subject>, String> {
    info!("download_ppts {} {}", subs.len(), to_pdf);
    state
        .should_cancel
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let mut count = 0;
    let total_size = subs
        .iter()
        .map(|sub| sub.ppt_image_urls.len())
        .sum::<usize>() as u128;
    for i in 0..subs.len() {
        if state
            .should_cancel
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "cancel".to_string(),
                        ..Default::default()
                    },
                )
                .unwrap();
            return Ok(subs[0..i].to_vec());
        }
        let sub = &subs[i];
        let path = Path::new(&sub.path).join(&sub.sub_name);
        let urls = sub.ppt_image_urls.clone();

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

        let mut tasks = urls
            .clone()
            .into_iter()
            .zip(image_paths.clone())
            .map(|(url, path)| {
                tokio::task::spawn(async move {
                    download_ppt_image(&url, &path)
                        .await
                        .map_err(|err| err.to_string())
                })
            })
            .collect::<Vec<_>>();

        for task in &mut tasks {
            if state
                .should_cancel
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                window
                    .emit(
                        "download-progress",
                        Progress {
                            status: "cancel".to_string(),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                // stop all tasks
                for task in tasks {
                    task.abort();
                }
                // clean up
                std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
                return Ok(subs[0..i].to_vec());
            }
            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "downloading".to_string(),
                        file_name: Some(format!("{}-{}", sub.course_name, sub.sub_name)),
                        downloaded_size: Some(count as u128),
                        total_size: Some(total_size as u128),
                        current: Some(i as u128 + 1),
                        total: Some(subs.len() as u128),
                    },
                )
                .unwrap();
            task.await.map_err(|err| err.to_string())??;
            count += 1;
        }

        if state
            .should_cancel
            .load(std::sync::atomic::Ordering::SeqCst)
        {
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
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            return Ok(subs[0..i].to_vec());
        }

        if to_pdf && urls.len() > 0 {
            let pdf_path = path
                .join(format!("{}-{}.pdf", sub.course_name, sub.sub_name))
                .to_str()
                .unwrap()
                .to_string();

            window
                .emit(
                    "download-progress",
                    Progress {
                        status: "writing".to_string(),
                        file_name: Some(format!("{}-{}", sub.course_name, sub.sub_name)),
                        downloaded_size: Some(count as u128),
                        total_size: Some(total_size as u128),
                        current: Some(i as u128 + 1),
                        total: Some(subs.len() as u128),
                    },
                )
                .unwrap();
            images_to_pdf(image_paths, &pdf_path).map_err(|err| err.to_string())?;
        }
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
    Ok(subs)
}

#[tauri::command]
pub async fn get_sub_ppt_urls(
    state: State<'_, DownloadState>,
    subs: Vec<Subject>,
) -> Result<Vec<Subject>, String> {
    info!("get_sub_ppt_urls");
    let mut new_subs = Vec::new();
    let save_path = state.save_path.lock().unwrap().clone();

    let tasks = subs
        .into_iter()
        .map(|sub| {
            let path = Path::new(&save_path)
                .join(&sub.course_name)
                .to_str()
                .unwrap()
                .to_string();
            tokio::task::spawn(async move {
                let urls = get_ppt_urls(sub.course_id, sub.sub_id)
                    .await
                    .map_err(|err| err.to_string())?;
                Ok(Subject {
                    ppt_image_urls: urls,
                    path,
                    ..sub
                })
            })
        })
        .collect::<Vec<JoinHandle<Result<Subject, String>>>>();

    for task in tasks {
        new_subs.push(task.await.map_err(|err| err.to_string())??);
    }

    Ok(new_subs)
}

#[tauri::command]
pub async fn get_range_subs(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    start_at: String, // format: 2021-05-01
    end_at: String,
) -> Result<Vec<Subject>, String> {
    info!("get_range_subs: {} {}", start_at, end_at);
    let zju_assist = state.lock().await.clone();
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut subs = Vec::new();
    let mut tasks: Vec<JoinHandle<Result<Vec<Subject>, String>>> = Vec::new();
    let start = NaiveDate::parse_from_str(&start_at, "%Y-%m-%d").unwrap();
    let end = NaiveDate::parse_from_str(&end_at, "%Y-%m-%d").unwrap();
    let mut date = start;
    while date <= end {
        let date_str = date.format("%Y-%m-%d").to_string();
        let zju_assist = zju_assist.clone();
        let save_path = save_path.clone();
        tasks.push(tokio::task::spawn(async move {
            let sub = zju_assist
                .get_range_subs(&date_str, &date_str, &save_path)
                .await
                .map_err(|err| err.to_string())?;
            Ok(sub)
        }));
        date = date + chrono::Duration::days(1);
    }

    for task in tasks {
        let sub = task.await.map_err(|err| err.to_string())??;
        subs.extend(sub);
    }

    Ok(subs)
}

#[tauri::command]
pub async fn get_month_subs(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    month: String,
) -> Result<Vec<Subject>, String> {
    info!("get_month_subs: {}", month);
    let zju_assist = state.lock().await;
    let save_path = download_state.save_path.lock().unwrap().clone();
    let subs = zju_assist
        .get_month_subs(&month, &save_path)
        .await
        .map_err(|err| err.to_string())?;
    Ok(subs)
}

#[tauri::command]
pub async fn search_courses(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    course_name: String,
    teacher_name: String,
) -> Result<Vec<Value>, String> {
    info!("search_courses: {} {}", course_name, teacher_name);
    let zju_assist = state.lock().await;
    let courses = zju_assist
        .search_courses(&course_name, &teacher_name)
        .await
        .map_err(|err| err.to_string())?;
    Ok(courses)
}

#[tauri::command]
pub async fn get_course_subs(
    state: State<'_, Arc<Mutex<ZjuAssist>>>,
    download_state: State<'_, DownloadState>,
    course_ids: Vec<i64>,
) -> Result<Vec<Subject>, String> {
    info!("get_course_subs");
    let zju_assist = state.lock().await;
    let save_path = download_state.save_path.lock().unwrap().clone();
    let mut subs = Vec::new();
    for course_id in course_ids {
        let sub = zju_assist
            .get_course_subs(course_id, &save_path)
            .await
            .map_err(|err| err.to_string())?;
        subs.extend(sub);
    }
    Ok(subs)
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

    notify_rust::Notification::new()
        .summary(&format!("考试成绩通知 - {}", kcmc))
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
        .map_err(|err| err.to_string())?;

    Ok(())
}
