// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod controller;
mod model;
mod util;
mod zju_assist;

use dashmap::DashMap;
use directories_next::{ProjectDirs, UserDirs};
use fern::Dispatch;
use log::info;
use log::LevelFilter;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::CustomMenuItem;
use tauri::Manager;
use tauri::SystemTray;
use tauri::SystemTrayEvent;
use tauri::SystemTrayMenu;
use tauri::SystemTrayMenuItem;
use tokio::sync::Mutex;
use zju_assist::ZjuAssist;

fn setup_logging(level: LevelFilter, to_file: bool) -> Result<(), fern::InitError> {
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
        .level(level);

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
    let zju_assist = Arc::new(Mutex::new(ZjuAssist::new()));

    // get user download path
    let mut save_path = "Downloads".to_string();
    if let Some(user_dirs) = UserDirs::new() {
        if let Some(download_dir) = user_dirs.download_dir() {
            save_path = download_dir.to_str().unwrap().to_string();
        }
    }

    let mut config = model::Config {
        save_path,
        to_pdf: true,
        auto_download: true,
        ding_url: "".to_string(),
        auto_open_download_list: true,
        tray: true,
    };

    if let Some(proj_dirs) = ProjectDirs::from("", "", "zju-learning-assistant") {
        let config_path = proj_dirs.config_dir();
        if let Ok(config_local) = std::fs::read_to_string(config_path.join("config.json")) {
            if let Ok(config_local) = serde_json::from_str::<model::Config>(&config_local) {
                info!("Loaded config from file");
                config = config_local;
            }
        }
    }
    let config_state = Arc::new(Mutex::new(config));

    let download_states: DashMap<String, Arc<AtomicBool>> = DashMap::new();

    let system_tray = SystemTray::new().with_menu(
        SystemTrayMenu::new()
            .add_item(CustomMenuItem::new("id", "未登录").disabled())
            .add_native_item(SystemTrayMenuItem::Separator)
            .add_item(CustomMenuItem::new(
                "open".to_string(),
                "打开 ZJU Learning Assistant",
            ))
            .add_item(CustomMenuItem::new(
                "quit".to_string(),
                "退出 ZJU Learning Assistant",
            )),
    );

    #[cfg(target_os = "windows")]
    let system_tray = system_tray.with_tooltip("ZJU Learning Assistant");

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            #[cfg(target_os = "windows")]
            SystemTrayEvent::LeftClick { .. } => {
                app.get_window("main").unwrap().show().unwrap();
                app.get_window("main").unwrap().set_focus().unwrap();
            }
            SystemTrayEvent::MenuItemClick { id, .. } => {
                if id == "quit" {
                    app.exit(0);
                } else if id == "open" {
                    app.get_window("main").unwrap().show().unwrap();
                    app.get_window("main").unwrap().set_focus().unwrap();
                } else if id.starts_with("export-todo-") {
                    app.emit_all("export-todo", id.split("-").collect::<Vec<&str>>()[2])
                        .unwrap();
                } else if id.starts_with("todo-") {
                    let course_id_id = id.split("-").collect::<Vec<&str>>();
                    let course_id = course_id_id[1];
                    let id = course_id_id[2];
                    let url = format!(
                        "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
                        course_id, id
                    );
                    if let Err(e) = tauri::api::shell::open(&app.shell_scope(), url, None) {
                        info!("Failed to open url: {}", e);
                    }
                }
            }
            _ => {}
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                #[cfg(not(target_os = "macos"))]
                event.window().hide().unwrap();

                #[cfg(target_os = "macos")]
                event.window().app_handle().hide().unwrap();

                api.prevent_close();
                event.window().emit("close-requested", {}).unwrap();
            }
            _ => {}
        })
        .setup(|app| {
            match app.get_cli_matches() {
                Ok(matches) => {
                    println!("{:?}", matches);
                    if matches.args.contains_key("debug")
                        && matches.args["debug"].value.as_bool() == Some(true)
                    {
                        setup_logging(LevelFilter::Debug, true).expect("Failed to setup logging");
                    } else {
                        setup_logging(LevelFilter::Info, false).expect("Failed to setup logging");
                    }
                }
                Err(_) => {}
            }
            app.manage(zju_assist);
            app.manage(config_state);
            app.manage(download_states);

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
            controller::login,
            controller::get_auto_login_info,
            controller::check_login,
            controller::test_connection,
            controller::logout,
            controller::sync_todo_once,
            controller::export_todo,
            controller::get_courses,
            controller::get_academic_year_list,
            controller::get_semester_list,
            controller::get_activities_uploads,
            controller::get_homework_uploads,
            controller::download_file,
            controller::get_uploads_list,
            controller::start_download_upload,
            controller::cancel_download,
            controller::open_file,
            controller::open_file_upload,
            controller::open_file_ppts,
            controller::get_latest_version_info,
            controller::start_download_ppts,
            controller::start_download_playback,
            controller::get_range_subs,
            controller::search_courses,
            controller::get_course_all_sub_ppts,
            controller::get_sub_ppt_urls,
            controller::get_month_subs,
            controller::get_score,
            controller::notify_score,
            controller::get_config,
            controller::set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
