pub mod common;

pub use common::*;

#[cfg(target_os = "macos")]
pub mod macos;

pub mod config_store;
pub mod dingtalk;
#[cfg(target_os = "linux")]
pub mod linux_chrome;
#[cfg(target_os = "windows")]
pub mod windows_chrome;
pub mod wps;
