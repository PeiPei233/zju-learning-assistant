use crate::model::Config;
use serde_json::{Map, Value};
use std::{fs, io::Write, path::PathBuf};

/// All callers hold the shared Config mutex while loading or updating this store.
pub struct ConfigStore {
    path: Result<PathBuf, String>,
    defaults: Config,
}

impl ConfigStore {
    pub fn new(path: Result<PathBuf, String>, defaults: Config) -> Self {
        Self { path, defaults }
    }

    fn read(&self) -> Result<(PathBuf, Value, Config), String> {
        let path = self.path.clone()?;
        // Follow existing symlinks rather than replacing the link on save.
        let path = match fs::symlink_metadata(&path) {
            Ok(_) => fs::canonicalize(&path).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => path,
            Err(e) => return Err(e.to_string()),
        };
        let mut document = serde_json::to_value(&self.defaults).map_err(|e| e.to_string())?;
        match fs::read_to_string(&path) {
            Ok(contents) => {
                let saved: Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
                let fields = saved.as_object().ok_or("配置文件必须是 JSON 对象")?;
                document.as_object_mut().unwrap().extend(fields.clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let config = serde_json::from_value(document.clone()).map_err(|e| e.to_string())?;
        validate(&config)?;
        Ok((path, document, config))
    }

    pub fn load(&self) -> Result<Config, String> {
        self.read().map(|(_, _, config)| config)
    }

    pub fn update(
        &self,
        current: &mut Config,
        patch: Map<String, Value>,
        apply_autostart: impl FnMut(bool) -> Result<(), String>,
    ) -> Result<Config, String> {
        let (path, mut document, _) = self.read()?;
        let known = serde_json::to_value(&self.defaults).map_err(|e| e.to_string())?;
        for key in patch.keys() {
            if known.get(key).is_none() {
                return Err(format!("未知配置项：{key}"));
            }
        }
        document.as_object_mut().unwrap().extend(patch);
        let mut next: Config =
            serde_json::from_value(document.clone()).map_err(|e| e.to_string())?;
        normalize(&mut next)?;
        // Keep unrecognized on-disk fields, but never accept them through the update API.
        document.as_object_mut().unwrap().extend(
            serde_json::to_value(&next)
                .map_err(|e| e.to_string())?
                .as_object()
                .unwrap()
                .clone(),
        );
        // Missing fields inherit defaults when loaded. Preserve unknown fields from
        // existing files, while compacting legacy full configurations on the next save.
        document
            .as_object_mut()
            .unwrap()
            .retain(|key, value| known.get(key) != Some(value));
        let contents = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
        commit(current, next, apply_autostart, || {
            write_atomically(&path, &contents)
        })
    }
}

fn normalize(config: &mut Config) -> Result<(), String> {
    validate(config)?;
    if config.ding_url.trim().is_empty() {
        config.score_ding_notification = false;
        config.todo_ding_notification = false;
    }
    if config.llm_api_base.trim().is_empty()
        || config.llm_api_key.trim().is_empty()
        || config.llm_model.trim().is_empty()
    {
        config.llm_enabled = false;
    }
    config.todo_reminder_minutes.sort_unstable();
    config.todo_reminder_minutes.dedup();
    Ok(())
}

// Validate without changing disk or runtime state, on both reads and writes.
fn validate(config: &Config) -> Result<(), String> {
    if config.max_concurrent_tasks == 0 {
        return Err("最大并行下载任务数必须大于零".into());
    }
    if config
        .todo_reminder_minutes
        .iter()
        .any(|m| ![15, 30, 60, 120, 1440].contains(m))
    {
        return Err("无效的待办提前提醒时间".into());
    }
    if !config.llm_temperature.is_finite() || !(0.0..=2.0).contains(&config.llm_temperature) {
        return Err("LLM 温度值必须在 0.0 到 2.0 之间".into());
    }
    Ok(())
}

fn commit(
    current: &mut Config,
    next: Config,
    mut apply_autostart: impl FnMut(bool) -> Result<(), String>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<Config, String> {
    let changed_autostart = current.auto_start != next.auto_start;
    if changed_autostart {
        apply_autostart(next.auto_start)?;
    }
    if let Err(error) = persist() {
        if changed_autostart {
            if let Err(rollback) = apply_autostart(current.auto_start) {
                return Err(format!("{error}；恢复开机启动设置失败：{rollback}"));
            }
        }
        return Err(error);
    }
    *current = next;
    Ok(current.clone())
}

fn write_atomically(path: &std::path::Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("无法确定配置目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Ok(metadata) = fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| e.to_string())?;
    }
    temporary.write_all(contents).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}
