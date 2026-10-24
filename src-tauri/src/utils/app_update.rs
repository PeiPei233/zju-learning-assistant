use crate::model::VersionInfo;
use anyhow::{anyhow, bail, Result};
use percent_encoding::percent_decode_str;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Window};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;
use url::Url;

#[derive(Clone, Copy)]
enum Source {
    Github,
    Gitee,
}

impl Source {
    fn repository(self) -> &'static str {
        match self {
            Self::Github => "https://github.com/PeiPei233/zju-learning-assistant",
            Self::Gitee => "https://gitee.com/PeiPeiY/zju-learning-assistant",
        }
    }

    fn api(self) -> &'static str {
        match self {
            Self::Github => {
                "https://api.github.com/repos/PeiPei233/zju-learning-assistant/releases/"
            }
            Self::Gitee => {
                "https://gitee.com/api/v5/repos/PeiPeiY/zju-learning-assistant/releases/"
            }
        }
    }

    fn alternate(self) -> Self {
        match self {
            Self::Github => Self::Gitee,
            Self::Gitee => Self::Github,
        }
    }
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

fn version(value: &str) -> Result<Version> {
    Ok(Version::parse(value.trim_start_matches('v'))?)
}

fn asset_url(source: Source, release: &Release, name: &str) -> Result<Url> {
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == name)
        .ok_or_else(|| anyhow!("此版本缺少所需的更新文件"))?;
    let url = Url::parse(&asset.browser_download_url)?;
    let mut prefix = Url::parse(&format!("{}/releases/download/", source.repository()))?;
    prefix
        .path_segments_mut()
        .map_err(|_| anyhow!("无效的发布地址"))?
        .pop_if_empty()
        .push(&release.tag_name)
        .push("");
    if !url.as_str().starts_with(prefix.as_str()) {
        bail!("更新文件地址与发布版本不匹配");
    }
    Ok(url)
}

async fn get_release(source: Source, tag: Option<&str>) -> Result<Release> {
    let mut url = Url::parse(source.api())?;
    if let Some(tag) = tag {
        url.path_segments_mut()
            .map_err(|_| anyhow!("无效的发布地址"))?
            .pop_if_empty()
            .push("tags")
            .push(tag);
    } else {
        url.path_segments_mut()
            .map_err(|_| anyhow!("无效的发布地址"))?
            .pop_if_empty()
            .push("latest");
    }
    let mut error = anyhow!("无法获取版本信息");
    for direct in [false, true] {
        let builder = reqwest::Client::builder()
            .user_agent("zju-learning-assistant")
            .timeout(Duration::from_secs(12));
        let client = if direct { builder.no_proxy() } else { builder }.build()?;
        let result = async {
            let release = client
                .get(url.clone())
                .send()
                .await?
                .error_for_status()?
                .json::<Release>()
                .await?;
            version(&release.tag_name)?;
            if tag.is_some_and(|tag| tag != release.tag_name) {
                bail!("发布版本不匹配");
            }
            Ok(release)
        }
        .await;
        match result {
            Ok(release) => return Ok(release),
            Err(err) => error = err,
        }
    }
    Err(error)
}

async fn prepare(app: &AppHandle, source: Source, release: &Release) -> Result<Update> {
    let endpoint = asset_url(source, release, "latest.json")?;
    let mut error = anyhow!("暂时无法获取更新包信息");
    for direct in [false, true] {
        let builder = app
            .updater_builder()
            .endpoints(vec![endpoint.clone()])?
            .timeout(Duration::from_secs(12));
        let builder = if direct { builder.no_proxy() } else { builder };
        let result = builder.build()?.check().await;
        match result {
            Ok(Some(mut update)) => {
                if version(&update.version)? != version(&release.tag_name)? {
                    bail!("更新清单与发布版本不一致");
                }
                let name = update
                    .download_url
                    .path_segments()
                    .and_then(|mut p| p.next_back())
                    .ok_or_else(|| anyhow!("无效的更新包地址"))?;
                let name = percent_decode_str(name).decode_utf8()?.into_owned();
                // Resolve the actual attachment instead of assuming a mirror URL exists.
                update.download_url = asset_url(source, release, &name)?;
                update.timeout = None;
                return Ok(update);
            }
            Ok(None) => bail!("当前没有适用的更新包"),
            Err(err) => error = err.into(),
        }
    }
    Err(error)
}

struct PreparedUpdate {
    update: Update,
    source: Source,
    tag: String,
    bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct AppUpdateState {
    prepared: Mutex<Option<PreparedUpdate>>,
    cancel_download: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

pub async fn check(app: &AppHandle, state: &AppUpdateState) -> Result<Option<VersionInfo>> {
    let mut prepared = state
        .prepared
        .try_lock()
        .map_err(|_| anyhow!("更新任务正在进行中"))?;
    let (source, release) = match get_release(Source::Github, None).await {
        Ok(release) => (Source::Github, release),
        Err(error) => {
            log::warn!("GitHub update check failed: {error}");
            (Source::Gitee, get_release(Source::Gitee, None).await?)
        }
    };
    if version(&release.tag_name)? <= app.package_info().version {
        *prepared = None;
        let current = format!("v{}", app.package_info().version);
        let mut notes_error = None;
        let mut release_source = source;
        let release = if version(&release.tag_name)? == app.package_info().version {
            Some(release)
        } else {
            match get_release(source, Some(&current)).await {
                Ok(release) => Some(release),
                Err(first_error) => match get_release(source.alternate(), Some(&current)).await {
                    Ok(release) => {
                        release_source = source.alternate();
                        Some(release)
                    },
                    Err(second_error) => {
                        let not_found = |error: &anyhow::Error| {
                            error.downcast_ref::<reqwest::Error>()
                                .and_then(reqwest::Error::status) == Some(reqwest::StatusCode::NOT_FOUND)
                        };
                        if !not_found(&first_error) || !not_found(&second_error) {
                            log::warn!("Current release notes failed: {first_error}; {second_error}");
                            notes_error = Some("版本说明获取失败，请重新检查更新。".into());
                        }
                        None
                    }
                },
            }
        };
        return Ok(Some(VersionInfo {
            update_available: false,
            version: current,
            url: release.as_ref().map(|release| format!("{}/releases/tag/{}", release_source.repository(), release.tag_name)).unwrap_or_default(),
            notes: release.and_then(|release| release.body).unwrap_or_default(),
            notes_error,
            can_install: false,
            prepare_error: None,
        }));
    }
    let mut info = VersionInfo {
        update_available: true,
        version: format!("v{}", version(&release.tag_name)?),
        notes: release.body.clone().unwrap_or_default(),
        notes_error: None,
        url: format!("{}/releases/tag/{}", source.repository(), release.tag_name),
        can_install: false,
        prepare_error: None,
    };
    *prepared = None;
    // Development builds must not replace the executable being worked on.
    if !cfg!(debug_assertions) {
        let result = prepare(app, source, &release).await;
        let result = match result {
            Ok(update) => Ok((source, update)),
            Err(error) => {
                log::warn!("Prepare update failed: {error}");
                let alternate = source.alternate();
                match get_release(alternate, Some(&release.tag_name)).await {
                    Ok(mirror) => prepare(app, alternate, &mirror)
                        .await
                        .map(|update| (alternate, update)),
                    Err(error) => Err(error),
                }
            }
        };
        match result {
            Ok((source, update)) => {
                info.can_install = true;
                *prepared = Some(PreparedUpdate {
                    update,
                    source,
                    tag: release.tag_name,
                    bytes: None,
                });
            }
            Err(error) => {
                log::warn!("No installable update: {error}");
                info.prepare_error = Some("暂时无法获取更新包，请稍后重试。".into());
            }
        }
    }
    Ok(Some(info))
}

pub fn cancel_download(state: &AppUpdateState) -> Result<()> {
    let sender = state
        .cancel_download
        .lock()
        .map_err(|_| anyhow!("更新状态不可用"))?;
    if let Some(sender) = sender.as_ref() {
        let _ = sender.send(true);
    }
    Ok(())
}

pub async fn download(window: &Window, state: &AppUpdateState) -> Result<bool> {
    let (sender, mut receiver) = tokio::sync::watch::channel(false);
    {
        let mut active = state
            .cancel_download
            .lock()
            .map_err(|_| anyhow!("更新状态不可用"))?;
        if active.is_some() {
            bail!("更新任务正在进行中");
        }
        *active = Some(sender);
    }
    let result = tokio::select! {
        biased;
        _ = receiver.changed() => Ok(false),
        result = download_inner(window, state) => result.map(|_| true),
    };
    *state
        .cancel_download
        .lock()
        .map_err(|_| anyhow!("更新状态不可用"))? = None;
    result
}

async fn download_inner(window: &Window, state: &AppUpdateState) -> Result<()> {
    let mut prepared = state
        .prepared
        .try_lock()
        .map_err(|_| anyhow!("更新任务正在进行中"))?;
    let prepared = prepared
        .as_mut()
        .ok_or_else(|| anyhow!("请先重新检查更新"))?;
    if prepared.bytes.is_some() {
        return Ok(());
    }
    let mut update = prepared.update.clone();
    let mut last_error = anyhow!("更新下载失败");
    // Retry the alternate route first, then the other release host, without changing the artifact.
    for attempt in 0..4 {
        if attempt == 1 || attempt == 3 {
            update.no_proxy = !update.no_proxy;
        }
        if attempt == 2 {
            let source = prepared.source.alternate();
            let mirror = match get_release(source, Some(&prepared.tag)).await {
                Ok(release) => release,
                Err(error) => {
                    log::warn!("Update mirror unavailable: {error}");
                    break;
                }
            };
            let name = prepared
                .update
                .download_url
                .path_segments()
                .and_then(|mut p| p.next_back())
                .ok_or_else(|| anyhow!("无效的更新包地址"))?;
            let name = percent_decode_str(name).decode_utf8()?;
            match asset_url(source, &mirror, &name) {
                Ok(url) => update.download_url = url,
                Err(error) => {
                    log::warn!("Update mirror artifact unavailable: {error}");
                    break;
                }
            }
            update.no_proxy = false;
        }
        let mut downloaded = 0;
        let mut last_emit = Instant::now();
        let _ = window.emit(
            "app-update-progress",
            UpdateProgress {
                downloaded,
                total: None,
            },
        );
        let result = update
            .download(
                |length, total| {
                    downloaded += length as u64;
                    if last_emit.elapsed() >= Duration::from_millis(150) {
                        let _ = window
                            .emit("app-update-progress", UpdateProgress { downloaded, total });
                        last_emit = Instant::now();
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                let size = bytes.len() as u64;
                let _ = window.emit(
                    "app-update-progress",
                    UpdateProgress {
                        downloaded: size,
                        total: Some(size),
                    },
                );
                prepared.bytes = Some(bytes);
                return Ok(());
            }
            Err(error) => {
                log::warn!("Update download failed: {error}");
                last_error = error.into();
            }
        }
    }
    Err(last_error)
}

pub async fn install(app: &AppHandle, state: &AppUpdateState) -> Result<()> {
    if cfg!(debug_assertions) {
        bail!("开发版本不支持安装更新，请使用正式安装包测试");
    }
    let mut prepared = state
        .prepared
        .try_lock()
        .map_err(|_| anyhow!("更新任务正在进行中"))?;
    let prepared = prepared.as_mut().ok_or_else(|| anyhow!("请先下载更新"))?;
    let bytes = prepared
        .bytes
        .take()
        .ok_or_else(|| anyhow!("请先下载更新"))?;
    let update = prepared.update.clone();
    let (result, bytes) = tokio::task::spawn_blocking(move || {
        let result = update.install(&bytes);
        (result, bytes)
    })
    .await?;
    prepared.bytes = Some(bytes);
    result?;
    app.restart();
}
