// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod controller;
mod zju_assist;
mod model;
mod util;

use fern::Dispatch;
use log::info;
use log::LevelFilter;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::Manager;
use tokio::sync::Mutex;
use zju_assist::ZjuAssist;

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
                    if matches.args.contains_key("debug")
                        && matches.args["debug"].value.as_bool() == Some(true)
                    {
                        setup_logging(true).expect("Failed to setup logging");
                    } else {
                        setup_logging(false).expect("Failed to setup logging");
                    }
                }
                Err(_) => {}
            }
            let zju_assist = Arc::new(Mutex::new(ZjuAssist::new()));
            app.manage(zju_assist);
            let download_state = model::DownloadState {
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
            controller::login,
            controller::check_login,
            controller::logout,
            controller::get_courses,
            controller::get_academic_year_list,
            controller::get_semester_list,
            controller::get_activities_uploads,
            controller::get_homework_uploads,
            controller::download_file,
            controller::get_uploads_list,
            controller::download_uploads,
            controller::cancel_download,
            controller::update_path,
            controller::open_save_path,
            controller::get_latest_version_info,
            controller::download_ppts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
