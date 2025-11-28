mod controller;
mod model;
mod utils;
mod zju_assist;

use dashmap::DashMap;
use log::info;
use std::sync::{atomic::AtomicBool, Arc};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(target_os = "windows")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_cli::CliExt;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use zju_assist::ZjuAssist;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                #[cfg(desktop)]
                #[cfg(not(target_os = "macos"))]
                window.hide().unwrap();

                #[cfg(target_os = "macos")]
                window.app_handle().hide().unwrap();

                api.prevent_close();
                window.app_handle().emit("close-requested", {}).unwrap();
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(desktop)]
            match app.cli().matches() {
                Ok(matches) => {
                    println!("{:?}", matches);
                    if matches.args.contains_key("debug")
                        && matches.args["debug"].value.as_bool() == Some(true)
                    {
                        app.handle().plugin(
                            tauri_plugin_log::Builder::default()
                                .targets([
                                    Target::new(TargetKind::Stdout),
                                    Target::new(TargetKind::Folder {
                                        path: std::env::current_dir()
                                            .unwrap_or(std::path::PathBuf::from(".")),
                                        file_name: Some("zju-learning-assistant.log".to_string()),
                                    }),
                                ])
                                .level(log::LevelFilter::Debug)
                                .build(),
                        )?;
                    } else {
                        app.handle().plugin(
                            tauri_plugin_log::Builder::default()
                                .level(log::LevelFilter::Info)
                                .build(),
                        )?;
                    }
                }
                Err(_) => {}
            }
            #[cfg(not(desktop))]
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let mut config = model::Config {
                save_path: "Downloads".to_string(),
                to_pdf: true,
                auto_download: true,
                ding_url: "".to_string(),
                auto_open_download_list: true,
                tray: true,
                max_concurrent_tasks: 3,
                auto_start: false,
            };

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                use tauri_plugin_autostart::ManagerExt;

                let _ = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                ));

                // Get the autostart manager
                let autostart_manager = app.autolaunch();
                // Enable autostart
                // let _ = autostart_manager.enable();
                // Check enable state
                // println!(
                //     "registered for autostart? {}",
                //     autostart_manager.is_enabled().unwrap()
                // );
                // Disable autostart
                // let _ = autostart_manager.disable();
                config.auto_start = autostart_manager.is_enabled().unwrap();
            }

            let zju_assist = Arc::new(Mutex::new(ZjuAssist::new()));

            // get user download path
            if let Ok(download_dir) = app.path().download_dir() {
                config.save_path = download_dir.to_str().unwrap().to_string();
            }

            if let Ok(config_dir) = app.path().app_config_dir() {
                if let Ok(config_local) = std::fs::read_to_string(config_dir.join("config.json")) {
                    if let Ok(config_local) = serde_json::from_str::<model::Config>(&config_local) {
                        info!("Loaded config from file");
                        config = config_local;
                    }
                }
            }
            let config_state = Arc::new(Mutex::new(config));

            let download_states: DashMap<String, Arc<AtomicBool>> = DashMap::new();

            app.manage(zju_assist);
            app.manage(config_state);
            app.manage(download_states);

            let version = app.config().version.clone();
            info!("Current version: {:?}", version);
            let platform = tauri_plugin_os::platform();
            info!("Platform: {}", platform);
            let os_type = tauri_plugin_os::type_();
            info!("OS Type: {}", os_type);
            let os_version = tauri_plugin_os::version();
            info!("OS Version: {}", os_version);
            let arch = tauri_plugin_os::arch();
            info!("Arch: {}", arch);
            let locale = tauri_plugin_os::locale();
            info!("Locale: {:?}", locale);
            let hostname = tauri_plugin_os::hostname();
            info!("Hostname: {}", hostname);
            let family = tauri_plugin_os::family();
            info!("Family: {}", family);
            if let Ok(path) = std::env::current_dir() {
                info!("Current path: {}", path.display());
            }

            #[cfg(desktop)]
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "id", "未登录", false, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        "open",
                        "打开 ZJU Learning Assistant",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        app,
                        "quit",
                        "退出 ZJU Learning Assistant",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;
            #[cfg(desktop)]
            app.tray_by_id("main")
                .unwrap()
                .set_menu(Some(menu))
                .unwrap();
            #[cfg(desktop)]
            app.tray_by_id("main").unwrap().on_menu_event(|app, event| {
                let id = event.id.as_ref();
                if id == "quit" {
                    app.exit(0);
                } else if id == "open" {
                    app.get_webview_window("main").unwrap().show().unwrap();
                    app.get_webview_window("main").unwrap().set_focus().unwrap();
                } else if id.starts_with("export-todo-") {
                    app.emit("export-todo", id[12..].to_string()).unwrap();
                } else if id.starts_with("todo-") {
                    let course_id_id = id.split("-").collect::<Vec<&str>>();
                    let course_id = course_id_id[1];
                    let id = course_id_id[2];
                    let url = format!(
                        "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
                        course_id, id
                    );
                    if let Err(e) = app.shell().open(url, None) {
                        info!("Failed to open url: {}", e);
                    }
                }
            });

            #[cfg(target_os = "windows")]
            {
                app.tray_by_id("main")
                    .unwrap()
                    .set_tooltip(Some("ZJU Learning Assistant"))
                    .unwrap();
                app.tray_by_id("main")
                    .unwrap()
                    .set_show_menu_on_left_click(false)
                    .unwrap();
                app.tray_by_id("main")
                    .unwrap()
                    .on_tray_icon_event(|tray, event| match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            println!("left click pressed and released");
                            // in this example, let's show and focus the main window when the tray is clicked
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {
                            println!("unhandled event {event:?}");
                        }
                    });
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
            controller::open_file_asr_text,
            controller::get_latest_version_info,
            controller::start_download_ppts,
            controller::start_download_asr_text,
            controller::start_download_playback,
            controller::get_range_subs,
            controller::search_courses,
            controller::get_course_all_sub_ppts,
            controller::get_sub_ppt_urls,
            controller::get_month_subs,
            controller::check_evaluation_done,
            controller::get_score,
            controller::notify_score,
            controller::get_config,
            controller::set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
