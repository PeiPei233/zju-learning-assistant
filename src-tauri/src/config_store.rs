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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn patch(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn invalid_values_are_rejected_on_reads_and_writes_without_changing_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let store = ConfigStore::new(Ok(path.clone()), Config::default());
        let mut memory = store.load().unwrap();
        for invalid in [
            json!({"max_concurrent_tasks":0}),
            json!({"llm_temperature":3}),
            json!({"llm_temperature":-0.1}),
            json!({"todo_reminder_minutes":[7]}),
        ] {
            fs::write(&path, "{}").unwrap();
            let before = serde_json::to_value(&memory).unwrap();
            let save_error = store
                .update(&mut memory, patch(invalid.clone()), |_| {
                    panic!("invalid settings must not change autostart")
                })
                .err()
                .unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
            let contents = serde_json::to_vec(&invalid).unwrap();
            fs::write(&path, &contents).unwrap();
            let load_error = store.load().err().unwrap();
            assert_eq!(load_error, save_error);
            assert!(store
                .update(&mut memory, patch(json!({"tray":false})), |_| {
                    panic!("invalid disk config must not change autostart")
                })
                .is_err());
            assert_eq!(fs::read(&path).unwrap(), contents);
            assert_eq!(serde_json::to_value(&memory).unwrap(), before);
        }
        fs::write(&path, r#"{"max_concurrent_tasks":1,"llm_temperature":2}"#).unwrap();
        assert_eq!(store.load().unwrap().max_concurrent_tasks, 1);
        assert!(store
            .update(&mut memory, patch(json!({"llm_temperature":0})), |_| Ok(()))
            .is_ok());
    }

    #[test]
    fn first_save_only_persists_overrides_and_reset_removes_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let store = ConfigStore::new(Ok(path.clone()), Config::default());
        let mut memory = store.load().unwrap();
        assert!(!path.exists(), "loading defaults must not create a file");
        store
            .update(
                &mut memory,
                patch(json!({"max_concurrent_tasks":7})),
                |_| Ok(()),
            )
            .unwrap();
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk, json!({"max_concurrent_tasks":7}));
        let restarted = ConfigStore::new(Ok(path.clone()), Config::default());
        let loaded = restarted.load().unwrap();
        assert_eq!(loaded.max_concurrent_tasks, 7);
        assert!(loaded.tray);
        assert_eq!(loaded.todo_reminder_minutes, vec![60]);
        store
            .update(
                &mut memory,
                patch(json!({"max_concurrent_tasks":3})),
                |_| Ok(()),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap(),
            json!({})
        );
        assert_eq!(store.load().unwrap().max_concurrent_tasks, 3);
    }

    #[test]
    fn legacy_full_config_is_compacted_without_losing_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let defaults = Config {
            save_path: "/actual/downloads".into(),
            ..Config::default()
        };
        let mut legacy = serde_json::to_value(&defaults).unwrap();
        legacy["tray"] = json!(false);
        legacy["todo_reminder_minutes"] = json!([]);
        legacy["future_option"] = json!({"enabled": false});
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let store = ConfigStore::new(Ok(path.clone()), defaults.clone());
        let mut memory = store.load().unwrap();
        store
            .update(&mut memory, patch(json!({"to_pdf":false})), |_| Ok(()))
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
            json!({"tray":false,"todo_reminder_minutes":[],"to_pdf":false,"future_option":{"enabled":false}})
        );
        let loaded = ConfigStore::new(Ok(path), defaults).load().unwrap();
        assert_eq!(loaded.save_path, "/actual/downloads");
        assert!(!loaded.tray && !loaded.to_pdf);
        assert!(loaded.todo_reminder_minutes.is_empty());
    }

    #[test]
    fn clearing_secret_removes_it_and_disabled_dependencies_use_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(
            &path,
            r#"{"ding_url":"url","ding_secret":"secret","score_ding_notification":true}"#,
        )
        .unwrap();
        let store = ConfigStore::new(Ok(path.clone()), Config::default());
        let mut memory = store.load().unwrap();
        store
            .update(
                &mut memory,
                patch(json!({"ding_url":"","ding_secret":""})),
                |_| Ok(()),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap(),
            json!({})
        );
        let loaded = store.load().unwrap();
        assert!(loaded.ding_url.is_empty() && loaded.ding_secret.is_empty());
        assert!(!loaded.score_ding_notification);
    }

    #[test]
    fn partial_updates_preserve_disk_values_and_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, r#"{"llm_api_key":"saved-key","future_option":42}"#).unwrap();
        let defaults = Config {
            save_path: "/actual/downloads".into(),
            ..Config::default()
        };
        let store = ConfigStore::new(Ok(path.clone()), defaults);
        let mut memory = store.load().unwrap();
        assert_eq!(memory.save_path, "/actual/downloads");
        // An external change after loading is preserved by the next partial save.
        fs::write(
            &path,
            r#"{"llm_api_key":"external-key","future_option":42}"#,
        )
        .unwrap();
        let saved = store
            .update(
                &mut memory,
                patch(json!({"max_concurrent_tasks":7})),
                |_| Ok(()),
            )
            .unwrap();
        assert_eq!(saved.llm_api_key, "external-key");
        assert_eq!(memory.max_concurrent_tasks, 7);
        let disk: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(disk["future_option"], 42);
        assert_eq!(disk["max_concurrent_tasks"], 7);
    }

    #[test]
    fn corrupt_or_unreadable_config_is_preserved_and_can_recover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let store = ConfigStore::new(Ok(path.clone()), Config::default());
        let mut memory = store.load().unwrap(); // Missing is a normal first run.
        for broken in ["{broken", "", "null", "[]", r#"{"tray":"wrong type"}"#] {
            fs::write(&path, broken).unwrap();
            assert!(store.load().is_err());
            assert!(store
                .update(&mut memory, patch(json!({"tray":false})), |_| panic!(
                    "must not change system settings"
                ))
                .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), broken);
            assert!(memory.tray);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap(); // Deterministic read error, even with elevated permissions.
        assert!(store.load().is_err());
        assert!(store
            .update(&mut memory, patch(json!({"tray":false})), |_| Ok(()))
            .is_err());
        fs::remove_dir(&path).unwrap();
        fs::write(&path, "{}").unwrap();
        assert!(
            !store
                .update(&mut memory, patch(json!({"tray":false})), |_| Ok(()))
                .unwrap()
                .tray
        );
    }

    #[test]
    fn backend_normalizes_dependencies_and_rejects_invalid_patches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let store = ConfigStore::new(Ok(path.clone()), Config::default());
        let mut memory = store.load().unwrap();
        store.update(&mut memory, patch(json!({"llm_enabled":true,"llm_api_base":"https://example.invalid","llm_api_key":"key","llm_model":"model","ding_url":"url","score_ding_notification":true,"todo_ding_notification":true})), |_| Ok(())).unwrap();
        assert!(memory.llm_enabled);
        store
            .update(
                &mut memory,
                patch(json!({"llm_api_key":"","ding_url":"","todo_reminder_minutes":[60,15,60]})),
                |_| Ok(()),
            )
            .unwrap();
        assert!(
            !memory.llm_enabled
                && !memory.score_ding_notification
                && !memory.todo_ding_notification
        );
        assert_eq!(memory.todo_reminder_minutes, vec![15, 60]);
        let before = fs::read(&path).unwrap();
        for invalid in [
            json!({"tray":null}),
            json!({"unknown":true}),
            json!({"max_concurrent_tasks":1.5}),
            json!({"todo_reminder_minutes":[7]}),
            json!({"llm_temperature":3}),
        ] {
            assert!(store
                .update(&mut memory, patch(invalid), |_| Ok(()))
                .is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        store
            .update(
                &mut memory,
                patch(json!({"llm_api_key":"new-key","ding_url":"url"})),
                |_| Ok(()),
            )
            .unwrap();
        assert!(!memory.llm_enabled && !memory.score_ding_notification);
    }

    #[test]
    fn failed_save_keeps_memory_and_rolls_back_autostart() {
        let mut memory = Config::default();
        let next = Config {
            auto_start: true,
            tray: false,
            ..memory.clone()
        };
        let mut calls = vec![];
        assert!(commit(
            &mut memory,
            next,
            |enabled| {
                calls.push(enabled);
                Ok(())
            },
            || Err("disk full".into())
        )
        .is_err());
        assert_eq!(calls, vec![true, false]);
        assert!(!memory.auto_start && memory.tray);
        let next = Config {
            auto_start: true,
            ..memory.clone()
        };
        assert!(commit(
            &mut memory,
            next,
            |_| Err("autostart unavailable".into()),
            || panic!("must not write")
        )
        .is_err());
        assert!(!memory.auto_start);
    }

    #[test]
    fn atomic_write_failure_preserves_existing_file_and_cleans_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::create_dir(&path).unwrap();
        assert!(write_atomically(&path, b"{}").is_err());
        assert!(path.is_dir());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(
            ConfigStore::new(Err("no config directory".into()), Config::default())
                .load()
                .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn writes_preserve_symlink_and_file_permissions() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.json");
        let link = dir.path().join("config.json");
        fs::write(&target, "{}").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, &link).unwrap();
        let store = ConfigStore::new(Ok(link.clone()), Config::default());
        let mut memory = store.load().unwrap();
        store
            .update(&mut memory, patch(json!({"tray":false})), |_| Ok(()))
            .unwrap();
        assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        assert_eq!(
            fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
