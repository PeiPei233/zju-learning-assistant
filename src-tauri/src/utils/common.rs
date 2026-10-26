use crate::model::{Config, Progress};
use crate::zju_assist::SubtitleContent;
use image::{ColorType, GenericImageView, ImageFormat};
use log::info;
use miniz_oxide::deflate::{compress_to_vec_zlib, CompressionLevel};
use num::BigUint;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use regex::Regex;
use serde_json::{json, Value};
use std::{io::Write, path::Path};

use tauri::{AppHandle, Emitter, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
#[cfg(target_os = "macos")]
use {
    super::macos::add_event,
    chrono::{DateTime, Local, Utc},
    std::process::Command,
    tauri::{path::BaseDirectory, Manager},
};

// reference:
// https://github.com/typst/pdf-writer/blob/main/examples/image.rs
pub fn images_to_pdf(
    image_paths: Vec<String>,
    pdf_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut pdf = Pdf::new();

    let mut page_ids = Vec::new();
    let mut image_ids = Vec::new();
    let mut s_mask_ids = Vec::new();
    let mut content_ids = Vec::new();

    let catalog_id = Ref::new(1);
    let page_tree_id = Ref::new(2);

    for (index, path) in image_paths.iter().enumerate() {
        page_ids.push(Ref::new((index + 1) as i32 * 4 + 1));
        image_ids.push(Ref::new((index + 1) as i32 * 4 + 2));
        s_mask_ids.push(Ref::new((index + 1) as i32 * 4 + 3));
        content_ids.push(Ref::new((index + 1) as i32 * 4 + 4));

        let image_path = Path::new(path);
        let data = std::fs::read(image_path).unwrap();
        let format = image::guess_format(&data).map_err(|e| e.to_string())?;
        let dynamic = image::load_from_memory(&data).map_err(|e| e.to_string())?;

        let (filter, encoded, mask) = match format {
            ImageFormat::Jpeg => {
                assert!(dynamic.color() == ColorType::Rgb8);
                (Filter::DctDecode, data, None)
            }
            ImageFormat::Png => {
                let level = CompressionLevel::DefaultLevel as u8;
                let encoded = compress_to_vec_zlib(dynamic.to_rgb8().as_raw(), level);
                let mask = dynamic.color().has_alpha().then(|| {
                    let alphas: Vec<_> = dynamic.pixels().map(|p| (p.2).0[3]).collect();
                    compress_to_vec_zlib(&alphas, level)
                });
                (Filter::FlateDecode, encoded, mask)
            }
            _ => Err("unsupported image format")?,
        };

        let width = dynamic.width() as f32;
        let height = dynamic.height() as f32;
        let rect = Rect::new(0.0, 0.0, width, height);

        let mut page = pdf.page(page_ids[index]);
        page.media_box(rect);
        page.parent(page_tree_id);
        page.contents(content_ids[index]);
        let image_name = Name(image_path.file_stem().unwrap().to_str().unwrap().as_bytes());
        page.resources()
            .x_objects()
            .pair(image_name, image_ids[index]);
        page.finish();

        let mut image = pdf.image_xobject(image_ids[index], &encoded);
        image.filter(filter);
        image.width(dynamic.width() as i32);
        image.height(dynamic.height() as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        if mask.is_some() {
            image.s_mask(s_mask_ids[index]);
        }
        image.finish();

        if let Some(encoded) = &mask {
            let mut s_mask = pdf.image_xobject(s_mask_ids[index], encoded);
            s_mask.filter(filter);
            s_mask.width(dynamic.width() as i32);
            s_mask.height(dynamic.height() as i32);
            s_mask.color_space().device_gray();
            s_mask.bits_per_component(8);
            s_mask.finish();
        }

        let w = dynamic.width() as f32;
        let h = dynamic.height() as f32;

        let mut content = Content::new();
        content.save_state();
        content.transform([w, 0.0, 0.0, h, 0.0, 0.0]);
        content.x_object(image_name);
        content.restore_state();
        pdf.stream(content_ids[index], &content.finish());
    }

    pdf.catalog(catalog_id).pages(page_tree_id);
    let page_num = page_ids.len() as i32;
    pdf.pages(page_tree_id).kids(page_ids).count(page_num);

    std::fs::write(pdf_path, pdf.finish())?;

    Ok(())
}

pub fn rsa_no_padding(src: &str, modulus: &str, exponent: &str) -> String {
    let m = BigUint::parse_bytes(modulus.as_bytes(), 16).unwrap();
    let e = BigUint::parse_bytes(exponent.as_bytes(), 16).unwrap();

    let input_nr = BigUint::from_bytes_be(src.as_bytes());

    let crypt_nr = input_nr.modpow(&e, &m);

    crypt_nr
        .to_bytes_be()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

pub fn export_todo_ics(
    todo_list: Vec<Value>,
    ics_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let todo_list = todo_list
        .iter()
        .filter(|todo| !todo["end_time"].is_null())
        .map(|todo| todo.clone())
        .collect::<Vec<_>>();

    let mut ics_file = std::fs::File::create(ics_path)?;

    // write ics head
    writeln!(ics_file, "BEGIN:VCALENDAR")?;
    writeln!(ics_file, "VERSION:2.0")?;
    writeln!(ics_file, "PRODID:-//Learning in ZJU//EN")?;

    for todo in todo_list.iter() {
        let end_time = todo["end_time"]
            .as_str()
            .unwrap_or("1970-01-01T00:00:00Z")
            .replace("-", "")
            .replace(":", "");
        let course_name = todo["course_name"].as_str().unwrap();
        let title = todo["title"].as_str().unwrap();
        let url = format!(
            "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
            todo["course_id"].as_i64().unwrap(),
            todo["id"].as_i64().unwrap()
        );

        writeln!(ics_file, "BEGIN:VEVENT")?;
        writeln!(ics_file, "DTSTART:{}", end_time)?;
        writeln!(ics_file, "DTEND:{}", end_time)?;
        writeln!(ics_file, "SUMMARY:{}", title)?;
        writeln!(ics_file, "DESCRIPTION:{}", course_name)?;
        writeln!(ics_file, "URL:{}", url)?;

        // add alarm 1 hour before the event
        writeln!(ics_file, "BEGIN:VALARM")?;
        writeln!(ics_file, "TRIGGER:-PT1H")?;
        writeln!(ics_file, "ACTION:DISPLAY")?;
        writeln!(
            ics_file,
            "DESCRIPTION:距离 {} 的 {} 截止仅剩 1 小时",
            course_name, title
        )?;
        writeln!(ics_file, "END:VALARM")?;

        writeln!(ics_file, "END:VEVENT")?;
    }

    // write ics tail
    writeln!(ics_file, "END:VCALENDAR")?;

    Ok(())
}

pub fn format_srt_timestamp(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    format!("{:02}:{:02}:{:02},000", hours, minutes, secs)
}

pub async fn save_subtitle(
    contents: &Vec<SubtitleContent>,
    base_path: &Path,
    file_stem: &str,
    config: &Config,
) -> Result<(), String> {
    info!(
        "save_subtitle: 开始保存字幕, 语言配置: {:?}",
        config.subtitle_language
    );

    for lang in &config.subtitle_language {
        // 根据选项确定文件后缀和是否为双语模式
        let (suffix, is_mixed, is_en) = match lang.as_str() {
            "zh" => ("zh", false, false),
            "en" => ("en", false, true),
            "mixed" => ("zh-en", true, false), // 中英穿插
            _ => continue,                     // 未知选项跳过
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

        info!(
            "save_subtitle: 正在处理语言 {}, 目标路径: {:?}",
            lang, file_path
        );

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

        tokio::fs::write(&file_path, file_content)
            .await
            .map_err(|e| format!("保存字幕失败: {}", e))?;
        info!("Saved subtitle success: {:?}", file_path);
    }
    Ok(())
}

// Return a completion message, cancellation, or an error; callers choose how to notify.
pub async fn export_todo_to_destination(
    handle: AppHandle,
    window: Window,
    todo_list: Vec<Value>,
    location: String,
) -> Result<Option<String>, String> {
    if location == "help" {
        handle.opener().open_url(
            "https://github.com/PeiPei233/zju-learning-assistant?tab=readme-ov-file#todo-export",
            None::<&str>,
        ).map_err(|error| error.to_string())?;
        return Ok(None);
    }
    if location.starts_with("ics") {
        #[cfg(desktop)]
        window.set_focus().map_err(|error| error.to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let dialog = handle
            .dialog()
            .file()
            .add_filter("iCalendar", &["ics"])
            .set_file_name("Todo");
        #[cfg(desktop)]
        let dialog = dialog.set_parent(&window);
        dialog.save_file(move |path| {
            let _ = sender.send(path);
        });
        let Some(path) = receiver.await.map_err(|error| error.to_string())? else {
            return Ok(None);
        };
        return tokio::task::spawn_blocking(move || {
            export_todo_ics(todo_list, &path.to_string()).map_err(|error| error.to_string())?;
            Ok(Some(format!("文件已保存至：{}", path)))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    return tokio::task::spawn_blocking(move || {
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
            .map_err(|error| error.to_string())?;

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
                let output = res?;
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
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
                    let output = res?;
                    if !output.status.success() {
                        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                    }
                }
            }
        }

        Ok(Some(format!("已添加到{}", app_name.trim())))
    })
    .await
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    Err("当前系统不支持此导出方式".to_string())
}

pub async fn summarize_subtitle(
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
    let _ = window.emit(
        "download-progress",
        Progress {
            id: id.to_string(),
            status: "downloading".to_string(),
            file_name: format!("{}-AI总结", file_stem),
            downloaded_size: 60,
            total_size: 100,
            msg: "正在进行 AI 总结...".to_string(),
        },
    );

    // 2. 准备 Prompt 和 上下文
    let system_prompt = if config.llm_prompt.trim().is_empty() {
        "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。"
    } else {
        &config.llm_prompt
    };

    // 拼接所有字幕文本（使用原文字幕 text，通常比 trans_text 更准确）
    // 如果需要更精细的控制（比如只总结英文），可以根据 subtitle_language 判断
    let full_text = contents
        .iter()
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
    let res = client
        .post(&api_url)
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

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

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

    tokio::fs::write(&file_path, summary_text)
        .await
        .map_err(|e| format!("写入总结文件失败: {}", e))?;
    info!("AI 总结已保存: {:?}", file_path);

    // 发送进度提示：完成
    let _ = window.emit(
        "download-progress",
        Progress {
            id: id.to_string(),
            status: "downloading".to_string(), // 保持 downloading，直到整个任务结束
            file_name: file_name,
            downloaded_size: 100,
            total_size: 100,
            msg: "AI 总结完成".to_string(),
        },
    );

    Ok(())
}

// Helper: 规范化 LLM API URL，确保以 /chat/completions 结尾
pub fn normalize_llm_api_url(base: &str) -> String {
    let base_trimmed = base.trim_end_matches('/');
    if base_trimmed.ends_with("/v1") {
        format!("{}/chat/completions", base_trimmed)
    } else if base_trimmed.contains("chat/completions") {
        base_trimmed.to_string()
    } else {
        format!("{}/chat/completions", base_trimmed)
    }
}
