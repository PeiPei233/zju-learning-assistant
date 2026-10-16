use crate::model::Upload;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const DOWNLOAD_STRATEGY_VERSION: u8 = 1;

#[derive(Serialize, Deserialize)]
struct Receipt {
    #[serde(default)]
    download_strategy_version: u8,
    upload_id: i64,
    source_name: String,
    source_size: u64,
    file_name: String,
    downloaded_size: u64,
}

fn receipt_path(upload: &Upload) -> PathBuf {
    Path::new(&upload.path)
        .join(".zla")
        .join(format!("preview-{}.json", upload.reference_id))
}

pub fn is_current(upload: &Upload) -> bool {
    let check = || -> Option<bool> {
        let receipt: Receipt =
            serde_json::from_slice(&std::fs::read(receipt_path(upload)).ok()?).ok()?;
        let mut components = Path::new(&receipt.file_name).components();
        if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
            return Some(false);
        }
        let size = Path::new(&upload.path)
            .join(&receipt.file_name)
            .metadata()
            .ok()?
            .len();
        Some(
            receipt.download_strategy_version == DOWNLOAD_STRATEGY_VERSION
                && receipt.upload_id == upload.id
                && receipt.source_name == upload.file_name
                && receipt.source_size == upload.size
                && receipt.downloaded_size > 0
                && size == receipt.downloaded_size,
        )
    };
    check().unwrap_or(false)
}

pub fn save(upload: &Upload, file_name: &str, downloaded_size: u64) -> Result<()> {
    let path = receipt_path(upload);
    std::fs::create_dir_all(path.parent().unwrap())?;
    let temporary = path.with_extension("json.tmp");
    let receipt = Receipt {
        download_strategy_version: DOWNLOAD_STRATEGY_VERSION,
        upload_id: upload.id,
        source_name: upload.file_name.clone(),
        source_size: upload.size,
        file_name: file_name.to_string(),
        downloaded_size,
    };
    std::fs::write(&temporary, serde_json::to_vec(&receipt)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_size_is_independent_of_original_size() {
        let directory =
            std::env::temp_dir().join(format!("zla-preview-test-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut upload = Upload {
            id: 42,
            reference_id: 7,
            file_name: "slides.pptx".into(),
            course_name: "course".into(),
            path: directory.to_string_lossy().into(),
            size: 10000,
            activity_id: Some(8),
            allow_private_wps_office_view: true,
        };
        std::fs::write(directory.join("slides.preview.pdf"), b"%PDF-preview").unwrap();
        save(&upload, "slides.preview.pdf", 12).unwrap();
        assert!(is_current(&upload));
        // Old print-only receipts must not prevent trying the new original route.
        let mut old: serde_json::Value =
            serde_json::from_slice(&std::fs::read(receipt_path(&upload)).unwrap()).unwrap();
        old.as_object_mut()
            .unwrap()
            .remove("download_strategy_version");
        std::fs::write(receipt_path(&upload), serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(!is_current(&upload));
        save(&upload, "slides.preview.pdf", 12).unwrap();
        upload.size += 1;
        assert!(!is_current(&upload));
        upload.size -= 1;
        std::fs::remove_file(directory.join("slides.preview.pdf")).unwrap();
        assert!(!is_current(&upload));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
