use anyhow::{bail, Result};

/// Validate streamed exports before reporting success or saving a sync receipt.
pub struct UploadIntegrity {
    expected_length: Option<u64>,
    require_pdf: bool,
    signature: Vec<u8>,
    received: u64,
}

impl UploadIntegrity {
    pub fn new(expected_length: Option<u64>, require_pdf: bool) -> Self {
        Self {
            expected_length,
            require_pdf,
            signature: Vec::new(),
            received: 0,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<()> {
        self.received += chunk.len() as u64;
        if self.require_pdf {
            self.signature
                .extend(chunk.iter().take(5 - self.signature.len()).copied());
            if self.signature.len() == 5 && self.signature != b"%PDF-" {
                bail!("导出的文件不是 PDF，请刷新课件列表或重新登录后重试");
            }
        }
        Ok(())
    }

    pub fn finish(&self) -> Result<()> {
        if self.require_pdf && self.signature != b"%PDF-" {
            bail!("导出的 PDF 为空或不完整");
        }
        if self
            .expected_length
            .is_some_and(|length| length != self.received)
        {
            bail!("下载文件不完整，请重试");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_header_split_across_network_chunks_without_content_length() {
        let mut check = UploadIntegrity::new(None, true);
        for chunk in [b"%P".as_slice(), b"D", b"F-1.7\nbody"] {
            check.push(chunk).unwrap();
        }
        check.finish().unwrap();
    }

    #[test]
    fn rejects_html_error_pages_and_empty_or_truncated_exports() {
        assert!(UploadIntegrity::new(None, true).finish().is_err());
        let mut check = UploadIntegrity::new(None, true);
        check.push(b"%PD").unwrap();
        assert!(check.finish().is_err());
        let mut check = UploadIntegrity::new(None, true);
        assert!(check.push(b"<html>login required</html>").is_err());
        let mut check = UploadIntegrity::new(Some(100), true);
        check.push(b"%PDF-1.7").unwrap();
        assert!(check.finish().is_err());
    }

    #[test]
    fn original_files_keep_their_format_but_must_match_http_length() {
        let mut check = UploadIntegrity::new(Some(4), false);
        check.push(b"PK\x03\x04").unwrap();
        check.finish().unwrap();
        let mut check = UploadIntegrity::new(Some(5), false);
        check.push(b"PK\x03\x04").unwrap();
        assert!(check.finish().is_err());
        UploadIntegrity::new(Some(0), false).finish().unwrap();
    }
}
