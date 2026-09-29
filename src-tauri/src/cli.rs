use serde::Serialize;
use std::path::Path;

/// What kind of thing the app was launched with, so the frontend knows
/// whether to load a single file or scan a folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PayloadKind {
    File,
    Dir,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartupPayload {
    pub kind: PayloadKind,
    pub path: Option<String>,
}

impl StartupPayload {
    pub fn none() -> Self {
        StartupPayload {
            kind: PayloadKind::None,
            path: None,
        }
    }
}

/// Parse process argv into a startup payload.
///
/// `args` is expected to include the executable name as `args[0]`
/// (i.e. the raw output of `std::env::args()` or the argv handed to the
/// single-instance plugin's second-instance callback). The first
/// argument that is not a flag (does not start with `-`) and points to
/// an existing file or directory on disk wins.
pub fn parse_argv(args: &[String]) -> StartupPayload {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = Path::new(arg);
        if path.is_file() {
            return StartupPayload {
                kind: PayloadKind::File,
                path: Some(arg.clone()),
            };
        }
        if path.is_dir() {
            return StartupPayload {
                kind: PayloadKind::Dir,
                path: Some(arg.clone()),
            };
        }
    }
    StartupPayload::none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn returns_none_payload_for_no_arguments() {
        let payload = parse_argv(&["json-scout.exe".to_string()]);
        assert_eq!(payload.kind, PayloadKind::None);
        assert_eq!(payload.path, None);
    }

    #[test]
    fn returns_none_payload_when_only_flags_are_present() {
        let payload = parse_argv(&["json-scout.exe".to_string(), "--flag".to_string()]);
        assert_eq!(payload.kind, PayloadKind::None);
    }

    #[test]
    fn detects_an_existing_file_argument() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("data.json");
        fs::write(&file_path, "{}").unwrap();

        let payload = parse_argv(&[
            "json-scout.exe".to_string(),
            file_path.to_string_lossy().to_string(),
        ]);
        assert_eq!(payload.kind, PayloadKind::File);
        assert_eq!(payload.path, Some(file_path.to_string_lossy().to_string()));
    }

    #[test]
    fn detects_an_existing_directory_argument() {
        let dir = tempdir().unwrap();

        let payload = parse_argv(&[
            "json-scout.exe".to_string(),
            dir.path().to_string_lossy().to_string(),
        ]);
        assert_eq!(payload.kind, PayloadKind::Dir);
    }

    #[test]
    fn ignores_a_nonexistent_path_argument() {
        let payload = parse_argv(&[
            "json-scout.exe".to_string(),
            "Z:\\this\\path\\does\\not\\exist.json".to_string(),
        ]);
        assert_eq!(payload.kind, PayloadKind::None);
    }

    #[test]
    fn skips_leading_flags_to_find_the_path_argument() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("data.json");
        fs::write(&file_path, "{}").unwrap();

        let payload = parse_argv(&[
            "json-scout.exe".to_string(),
            "--updated".to_string(),
            file_path.to_string_lossy().to_string(),
        ]);
        assert_eq!(payload.kind, PayloadKind::File);
    }
}
