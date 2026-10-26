mod controller;
#[cfg(target_os = "linux")]
use utils::linux_chrome;
mod model;
mod utils;
#[cfg(target_os = "windows")]
use utils::windows_chrome;
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
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use utils::config_store;
use zju_assist::ZjuAssist;

#[tauri::command]
fn set_window_chrome_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows_chrome::set_theme(&window, dark);
    #[cfg(target_os = "linux")]
    return window
        .run_on_main_thread(move || linux_chrome::theme(dark))
        .map_err(|e| e.to_string());
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (window, dark);
        Ok(())
    }
}

#[tauri::command]
fn set_window_chrome_layout(
    window: tauri::WebviewWindow,
    left: i32,
    width: i32,
    height: i32,
    opaque: bool,
    color: u32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        window
            .run_on_main_thread(move || unsafe {
                windows_chrome::set_layout(hwnd, left, width, height, opaque, color);
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, left, width, height, opaque, color);
        Ok(())
    }
}

#[tauri::command]
fn set_native_navigation(
    window: tauri::WebviewWindow,
    visible: bool,
    collapsed: bool,
    peek: bool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return window
        .run_on_main_thread(move || linux_chrome::navigation(visible, collapsed, peek))
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, visible, collapsed, peek);
        Ok(())
    }
}

#[tauri::command]
fn has_native_backdrop() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_chrome::has_native_backdrop()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn get_native_chrome_height() -> i32 {
    #[cfg(target_os = "linux")]
    {
        linux_chrome::height()
    }
    #[cfg(not(target_os = "linux"))]
    {
        0
    }
}

// Called after the saved appearance and native chrome are ready. Desktop
// windows start hidden to avoid showing the system theme before settings load.
#[tauri::command]
fn show_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(desktop)]
    {
        static SHOWN: AtomicBool = AtomicBool::new(false);
        if !SHOWN.swap(true, std::sync::atomic::Ordering::SeqCst) {
            window.show().map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(desktop))]
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_opener::init())
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
            #[cfg(target_os = "linux")]
            linux_chrome::install(&app.get_webview_window("main").expect("main window"))?;
            #[cfg(target_os = "windows")]
            windows_chrome::install(&app.get_webview_window("main").expect("main window"))?;
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

            let mut config = model::Config::default();

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

            let config_store = config_store::ConfigStore::new(
                app.path()
                    .app_config_dir()
                    .map(|dir| dir.join("config.json"))
                    .map_err(|e| e.to_string()),
                config.clone(),
            );
            match config_store.load() {
                Ok(saved) => config = saved,
                Err(error) => log::error!("Failed to load settings: {error}"),
            }
            app.manage(config_store);
            app.manage(utils::app_update::AppUpdateState::default());
            let config_state = Arc::new(Mutex::new(config));

            let download_states: DashMap<String, tokio_util::sync::CancellationToken> =
                DashMap::new();

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
            let login_status = MenuItem::with_id(app, "id", "未登录", false, None::<&str>)?;
            #[cfg(desktop)]
            app.manage(login_status.clone());
            #[cfg(desktop)]
            let menu = Menu::with_items(
                app,
                &[
                    &login_status,
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
                    if let Err(e) = app.opener().open_url(url, None::<&str>) {
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
            show_main_window,
            set_window_chrome_theme,
            set_native_navigation,
            get_native_chrome_height,
            has_native_backdrop,
            set_window_chrome_layout,
            controller::login,
            controller::complete_login_setup,
            controller::get_auto_login_info,
            controller::check_login,
            controller::logout,
            controller::sync_todo_once,
            controller::export_todo,
            controller::connect_caldav,
            controller::export_caldav,
            controller::export_todo_from_tray,
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
            controller::download_app_update,
            controller::cancel_app_update_download,
            controller::install_app_update,
            controller::start_download_ppts,
            controller::start_download_playback,
            controller::get_range_subs,
            controller::search_courses,
            controller::get_course_all_sub_ppts,
            controller::get_sub_ppt_urls,
            controller::get_month_subs,
            controller::check_zdbk_evaluation_done,
            controller::check_yjsy_evaluation_done,
            controller::get_zdbk_score,
            controller::get_yjsy_score,
            controller::notify_score,
            controller::send_ding_notification,
            controller::get_notification_scope,
            controller::get_config,
            controller::get_runtime_config,
            controller::set_config,
            controller::test_llm_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
