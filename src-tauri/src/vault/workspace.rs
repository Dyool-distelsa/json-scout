//! Local workspace for pulled secrets.
//!
//! Layout, per vault, under the workspace root:
//!
//! ```text
//! {root}/{vault}/{name}.json | {name}.txt     working copy (user edits this)
//! {root}/{vault}/.base/{name}.json | .txt     copy exactly as pulled
//! {root}/{vault}/{name}.meta.json             { baseVersion, pulledAt, format }
//! ```
//!
//! The metadata file is written last and doubles as the commit marker: a
//! secret without readable metadata counts as not pulled.
//!
//! Secret names cannot contain a dot, so `.base` and `*.meta.json` can never
//! collide with a secret's own files. Every name is validated before a path
//! is built, which also rules out path traversal.

use super::domain::{validate_name, SecretValue, VaultError};
use super::json_text;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

/// Folder name the workspace root must have. [`Workspace::clean`] refuses to
/// remove a whole root with any other name.
pub const ROOT_DIR_NAME: &str = "vault-sync";

const BASE_DIR: &str = ".base";
const STAGING_DIR: &str = ".tmp";

/// How a secret value is stored locally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Text,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Json => "json",
            Format::Text => "txt",
        }
    }

    const ALL: [Format; 2] = [Format::Json, Format::Text];
}

/// A secret value prepared for storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Normalised {
    pub text: String,
    pub format: Format,
}

/// Relation between a secret's working copy and what was last pulled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalState {
    /// Never pulled (or nothing usable left locally).
    Remote,
    /// Working copy is byte-identical to the pulled base.
    Clean,
    /// Working copy differs from the pulled base.
    Modified,
}

/// Where a pull landed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pulled {
    pub path: PathBuf,
    pub format: Format,
}

/// Turn a raw secret value into its stored form.
///
/// A value that is a JSON object or array is stored as `json`, re-indented by
/// the lossless formatter: 2-space indentation and a trailing newline, with
/// every number and string lexeme and the key order exactly as the remote
/// wrote them (keys are not sorted, duplicate keys are kept). Anything else
/// (including JSON scalars such as `123` or `true`, which are
/// indistinguishable from plain passwords, and text that is not valid JSON)
/// is stored verbatim as `text`.
pub fn normalise(value: &str) -> Normalised {
    let is_container = value.trim_start().starts_with(['{', '[']);
    match json_text::pretty(value) {
        Ok(text) if is_container => Normalised {
            text,
            format: Format::Json,
        },
        _ => Normalised {
            text: value.to_string(),
            format: Format::Text,
        },
    }
}

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn new(root: PathBuf) -> Self {
        Workspace { root }
    }

    #[cfg(test)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Store a freshly pulled secret: working copy, base copy and metadata.
    /// Any previous copy, including one stored in the other format, is
    /// replaced.
    ///
    /// The three files cannot be written atomically as a set, so the metadata
    /// is the commit marker: the previous one is removed first, the base copy
    /// and the working copy follow, and the new metadata is written last. A
    /// pull that stops anywhere in between leaves no metadata, which
    /// [`Workspace::local_state`] reads as "not pulled", so the files of an
    /// interrupted pull are never trusted.
    pub fn write_pull(
        &self,
        vault: &str,
        name: &str,
        value: &SecretValue,
    ) -> Result<Pulled, VaultError> {
        let vault_dir = self.vault_dir(vault)?;
        validate_name(name)?;

        let normalised = normalise(&value.value);
        let format = normalised.format;
        let working = working_path(&vault_dir, name, format);
        let base = base_path(&vault_dir, name, format);
        let meta = meta_path(&vault_dir, name);

        remove_if_present(&meta)?;
        fs::create_dir_all(vault_dir.join(BASE_DIR))?;
        for other in Format::ALL.into_iter().filter(|f| *f != format) {
            remove_if_present(&working_path(&vault_dir, name, other))?;
            remove_if_present(&base_path(&vault_dir, name, other))?;
        }
        write_atomic(&base, &normalised.text)?;
        write_atomic(&working, &normalised.text)?;
        write_atomic(&meta, &meta_document(&value.version, format))?;

        Ok(Pulled {
            path: working,
            format,
        })
    }

    /// Compare a secret's working copy with the base it was pulled from. A
    /// secret without readable metadata was never (fully) pulled, whatever
    /// files lie around.
    pub fn local_state(&self, vault: &str, name: &str) -> Result<LocalState, VaultError> {
        let vault_dir = self.vault_dir(vault)?;
        validate_name(name)?;

        let Some(meta) = read_meta(&vault_dir, name) else {
            return Ok(LocalState::Remote);
        };
        let Some(base) = read_if_present(&base_path(&vault_dir, name, meta.format))? else {
            return Ok(LocalState::Remote);
        };
        Ok(
            match read_if_present(&working_path(&vault_dir, name, meta.format))? {
                Some(working) if working == base => LocalState::Clean,
                Some(_) => LocalState::Modified,
                None => LocalState::Remote,
            },
        )
    }

    /// Remove one vault's folder, or the whole workspace when `vault` is
    /// `None`. A missing folder is not an error. Removing the whole root is
    /// refused unless its last path component is [`ROOT_DIR_NAME`], so a wrong
    /// root can never turn this into "delete an arbitrary folder".
    pub fn clean(&self, vault: Option<&str>) -> Result<(), VaultError> {
        let target = match vault {
            Some(vault) => self.vault_dir(vault)?,
            None => {
                if self.root.file_name() != Some(OsStr::new(ROOT_DIR_NAME)) {
                    return Err(VaultError::Internal(format!(
                        "refusing to remove a folder that is not named {ROOT_DIR_NAME}"
                    )));
                }
                self.root.clone()
            }
        };
        match fs::remove_dir_all(&target) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    /// Folder for short-lived files that must not live in `%TEMP%`: the
    /// staged value of a push. A vault name cannot contain a dot, so it can
    /// never collide with a vault's own folder, and `clean(None)` removes it
    /// with the rest of the workspace.
    pub fn staging_dir(&self) -> PathBuf {
        self.root.join(STAGING_DIR)
    }

    fn vault_dir(&self, vault: &str) -> Result<PathBuf, VaultError> {
        validate_name(vault)?;
        Ok(self.root.join(vault))
    }
}

fn working_path(vault_dir: &Path, name: &str, format: Format) -> PathBuf {
    vault_dir.join(format!("{name}.{}", format.extension()))
}

fn base_path(vault_dir: &Path, name: &str, format: Format) -> PathBuf {
    vault_dir
        .join(BASE_DIR)
        .join(format!("{name}.{}", format.extension()))
}

fn meta_path(vault_dir: &Path, name: &str) -> PathBuf {
    vault_dir.join(format!("{name}.meta.json"))
}

fn meta_document(version: &str, format: Format) -> String {
    let pulled_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let document = serde_json::json!({
        "baseVersion": version,
        "pulledAt": pulled_at.to_string(),
        "format": format,
    });
    let mut text = document.to_string();
    text.push('\n');
    text
}

/// The parsed `<name>.meta.json`, or `None` when it is missing, unreadable or
/// incomplete.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    base_version: String,
    format: Format,
}

fn read_meta(vault_dir: &Path, name: &str) -> Option<Meta> {
    let bytes = fs::read(meta_path(vault_dir, name)).ok()?;
    let meta: Meta = serde_json::from_slice(&bytes).ok()?;
    (!meta.base_version.is_empty()).then_some(meta)
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), VaultError> {
    crate::fs_ops::write_file_atomic(path, contents).map_err(VaultError::from)
}

fn read_if_present(path: &Path) -> Result<Option<Vec<u8>>, VaultError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn remove_if_present(path: &Path) -> Result<(), VaultError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tempfile::tempdir;

    fn secret(value: &str, version: &str) -> SecretValue {
        SecretValue {
            value: value.to_string(),
            version: version.to_string(),
            updated: None,
        }
    }

    fn workspace() -> (tempfile::TempDir, Workspace) {
        let dir = tempdir().expect("tempdir");
        let ws = Workspace::new(dir.path().join("vault-sync"));
        (dir, ws)
    }

    // --- normalise ---

    #[test]
    fn normalise_keeps_key_order_with_two_space_indent_and_a_trailing_newline() {
        let n = normalise(r#"{"b":1,"a":{"z":true,"y":[{"d":1,"c":2}]}}"#);
        assert_eq!(n.format, Format::Json);
        let expected = "{\n  \"b\": 1,\n  \"a\": {\n    \"z\": true,\n    \"y\": [\n      {\n        \"d\": 1,\n        \"c\": 2\n      }\n    ]\n  }\n}\n";
        assert_eq!(n.text, expected);
    }

    #[test]
    fn normalise_keeps_number_and_string_lexemes_exactly_as_the_remote_wrote_them() {
        let n = normalise(r#"{"a":1.50,"b":1e3,"c":12345678901234567890,"d":"é","e":-0}"#);
        assert_eq!(n.format, Format::Json);
        for lexeme in ["1.50", "1e3", "12345678901234567890", r#""é""#, "-0"] {
            assert!(n.text.contains(lexeme), "{lexeme} must survive: {}", n.text);
        }
    }

    #[test]
    fn normalise_keeps_every_member_of_an_object_with_duplicate_keys() {
        let n = normalise(r#"{"a":1,"a":2}"#);
        assert_eq!(n.format, Format::Json);
        assert_eq!(n.text, "{\n  \"a\": 1,\n  \"a\": 2\n}\n");
    }

    #[test]
    fn normalise_then_minify_reproduces_a_minified_remote_value_byte_for_byte() {
        let remote = r#"{"b":1.50,"a":[1e3,{"k":"é","k":null}],"n":12345678901234567890}"#;
        let n = normalise(remote);
        assert_eq!(crate::vault::json_text::minify(&n.text).unwrap(), remote);
    }

    #[test]
    fn normalise_keeps_array_element_order() {
        let n = normalise(r#"[3,1,2]"#);
        assert_eq!(n.format, Format::Json);
        assert_eq!(n.text, "[\n  3,\n  1,\n  2\n]\n");
    }

    #[test]
    fn normalise_is_idempotent_on_its_own_json_output() {
        let once = normalise(r#"{"b":[1,{"y":1,"x":2}],"a":null}"#);
        let twice = normalise(&once.text);
        assert_eq!(twice, once);
    }

    #[test]
    fn normalise_leaves_non_json_text_verbatim() {
        for raw in ["not json", "  padded value \n", "a=b;c=d", "{broken", ""] {
            let n = normalise(raw);
            assert_eq!(n.format, Format::Text, "{raw:?}");
            assert_eq!(n.text, raw);
        }
    }

    #[test]
    fn normalise_treats_json_scalars_as_plain_text() {
        for raw in ["123", "\"quoted\"", "true", "null", "1.50"] {
            let n = normalise(raw);
            assert_eq!(n.format, Format::Text, "{raw:?}");
            assert_eq!(n.text, raw);
        }
    }

    // --- write_pull ---

    #[test]
    fn write_pull_writes_the_working_copy_the_base_copy_and_the_metadata() {
        let (_dir, ws) = workspace();
        let pulled = ws
            .write_pull("kv", "app-config", &secret(r#"{"b":1,"a":2}"#, "v1"))
            .expect("pull");

        let expected_text = "{\n  \"b\": 1,\n  \"a\": 2\n}\n";
        assert_eq!(pulled.format, Format::Json);
        assert_eq!(pulled.path, ws.root().join("kv").join("app-config.json"));
        assert_eq!(fs::read_to_string(&pulled.path).unwrap(), expected_text);
        let base = ws.root().join("kv").join(".base").join("app-config.json");
        assert_eq!(fs::read_to_string(base).unwrap(), expected_text);

        let meta_path = ws.root().join("kv").join("app-config.meta.json");
        let meta: Value = serde_json::from_str(&fs::read_to_string(meta_path).unwrap()).unwrap();
        assert_eq!(meta["baseVersion"], json!("v1"));
        assert_eq!(meta["format"], json!("json"));
        let pulled_at = meta["pulledAt"].as_str().expect("pulledAt is a string");
        assert!(pulled_at.parse::<u64>().unwrap() > 0);
    }

    #[test]
    fn write_pull_stores_non_json_values_verbatim_as_txt() {
        let (_dir, ws) = workspace();
        let pulled = ws
            .write_pull("kv", "password", &secret("p@ss w0rd\n", "v9"))
            .expect("pull");

        assert_eq!(pulled.format, Format::Text);
        assert_eq!(pulled.path, ws.root().join("kv").join("password.txt"));
        assert_eq!(fs::read_to_string(&pulled.path).unwrap(), "p@ss w0rd\n");
        let base = ws.root().join("kv").join(".base").join("password.txt");
        assert_eq!(fs::read_to_string(base).unwrap(), "p@ss w0rd\n");
        let meta_path = ws.root().join("kv").join("password.meta.json");
        let meta: Value = serde_json::from_str(&fs::read_to_string(meta_path).unwrap()).unwrap();
        assert_eq!(meta["format"], json!("text"));
        assert_eq!(meta["baseVersion"], json!("v9"));
    }

    #[test]
    fn write_pull_again_overwrites_local_edits_and_resets_the_state_to_clean() {
        let (_dir, ws) = workspace();
        let first = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        fs::write(&first.path, "edited").unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Modified);

        ws.write_pull("kv", "cfg", &secret(r#"{"a":2}"#, "v2")).unwrap();

        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Clean);
        assert_eq!(
            fs::read_to_string(&first.path).unwrap(),
            "{\n  \"a\": 2\n}\n"
        );
    }

    #[test]
    fn write_pull_removes_the_stale_copy_when_the_format_changes_between_pulls() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        ws.write_pull("kv", "cfg", &secret("now plain text", "v2")).unwrap();

        let vault_dir = ws.root().join("kv");
        assert!(!vault_dir.join("cfg.json").exists());
        assert!(!vault_dir.join(".base").join("cfg.json").exists());
        assert!(vault_dir.join("cfg.txt").exists());
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Clean);
    }

    #[test]
    fn write_pull_rejects_invalid_names_without_touching_the_disk() {
        let (dir, ws) = workspace();
        let value = secret("x", "v1");
        for (vault, name) in [
            ("../evil", "ok"),
            ("ok", "../evil"),
            ("a/b", "ok"),
            ("ok", "a\\b"),
            ("", "ok"),
            ("ok", ""),
            ("ok", "a.b"),
            ("-rf", "ok"),
        ] {
            assert_eq!(
                ws.write_pull(vault, name, &value),
                Err(VaultError::InvalidName),
                "{vault:?}/{name:?}"
            );
        }
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert!(entries.is_empty(), "nothing may be created");
    }

    #[test]
    fn write_pull_leaves_no_temporary_files_behind() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();

        let mut stack = vec![ws.root().to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    assert!(!path.to_string_lossy().ends_with(".tmp"), "{path:?}");
                }
            }
        }
    }

    // --- local_state ---

    #[test]
    fn local_state_is_remote_for_a_secret_that_was_never_pulled() {
        let (_dir, ws) = workspace();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn local_state_is_clean_right_after_a_pull_and_modified_after_an_edit() {
        let (_dir, ws) = workspace();
        let pulled = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Clean);

        fs::write(&pulled.path, "{\n  \"a\": 99\n}\n").unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Modified);
    }

    #[test]
    fn local_state_detects_a_whitespace_only_edit_as_modified() {
        let (_dir, ws) = workspace();
        let pulled = ws.write_pull("kv", "note", &secret("hello", "v1")).unwrap();
        fs::write(&pulled.path, "hello\n").unwrap();
        assert_eq!(ws.local_state("kv", "note").unwrap(), LocalState::Modified);
    }

    #[test]
    fn local_state_is_remote_when_the_working_copy_was_deleted() {
        let (_dir, ws) = workspace();
        let pulled = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        fs::remove_file(&pulled.path).unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn local_state_rejects_invalid_names() {
        let (_dir, ws) = workspace();
        assert_eq!(ws.local_state("../x", "cfg"), Err(VaultError::InvalidName));
        assert_eq!(ws.local_state("kv", "a/b"), Err(VaultError::InvalidName));
    }

    #[test]
    fn local_state_is_remote_when_the_metadata_is_missing_and_orphan_files_are_ignored() {
        let (_dir, ws) = workspace();
        let pulled = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        fs::remove_file(ws.root().join("kv").join("cfg.meta.json")).unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);

        // Edited orphans change nothing either: without a meta there was no pull.
        fs::write(&pulled.path, "edited").unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn local_state_is_remote_when_the_metadata_is_unreadable_or_incomplete() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        let meta = ws.root().join("kv").join("cfg.meta.json");

        for broken in [
            "",
            "not json",
            "{}",
            r#"{"baseVersion":"v1"}"#,
            r#"{"format":"json"}"#,
            r#"{"baseVersion":"","format":"json"}"#,
            r#"{"baseVersion":"v1","format":"yaml"}"#,
            r#"{"baseVersion":7,"format":"json"}"#,
        ] {
            fs::write(&meta, broken).unwrap();
            assert_eq!(
                ws.local_state("kv", "cfg").unwrap(),
                LocalState::Remote,
                "{broken:?}"
            );
        }

        fs::remove_file(&meta).unwrap();
        fs::create_dir(&meta).unwrap();
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn local_state_follows_the_format_named_by_the_metadata_and_ignores_the_other_one() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        let vault_dir = ws.root().join("kv");
        fs::write(vault_dir.join(".base").join("cfg.txt"), "orphan base").unwrap();
        fs::write(vault_dir.join("cfg.txt"), "orphan working, different").unwrap();

        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Clean);
    }

    // --- atomic pull ---

    #[test]
    fn a_pull_that_fails_before_the_metadata_leaves_the_secret_not_pulled() {
        let (_dir, ws) = workspace();
        let vault_dir = ws.root().join("kv");
        // A directory where the working copy goes makes that step fail.
        fs::create_dir_all(vault_dir.join("cfg.json")).unwrap();

        let result = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1"));

        assert!(matches!(result, Err(VaultError::Io(_))), "{result:?}");
        assert!(
            vault_dir.join(".base").join("cfg.json").exists(),
            "the base copy is written first"
        );
        assert!(
            !vault_dir.join("cfg.meta.json").exists(),
            "the metadata is the commit marker and is written last"
        );
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn a_failed_re_pull_invalidates_the_previous_pull_instead_of_mixing_old_and_new_files() {
        let (_dir, ws) = workspace();
        let first = ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        // Break the working copy path so the second pull fails after the base
        // copy was already replaced.
        fs::remove_file(&first.path).unwrap();
        fs::create_dir(&first.path).unwrap();

        let result = ws.write_pull("kv", "cfg", &secret(r#"{"a":2}"#, "v2"));

        assert!(matches!(result, Err(VaultError::Io(_))), "{result:?}");
        assert!(
            !ws.root().join("kv").join("cfg.meta.json").exists(),
            "the old metadata must not describe the new base copy"
        );
        assert_eq!(ws.local_state("kv", "cfg").unwrap(), LocalState::Remote);
    }

    #[test]
    fn a_pull_removes_the_other_formats_files_before_it_commits() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "cfg", &secret(r#"{"a":1}"#, "v1")).unwrap();
        ws.write_pull("kv", "cfg", &secret("plain", "v2")).unwrap();

        let vault_dir = ws.root().join("kv");
        assert!(!vault_dir.join("cfg.json").exists());
        assert!(!vault_dir.join(".base").join("cfg.json").exists());
        let meta = fs::read_to_string(vault_dir.join("cfg.meta.json")).unwrap();
        assert!(meta.contains("\"v2\"") && meta.contains("\"text\""), "{meta}");
    }

    // --- staging ---

    #[test]
    fn the_staging_dir_is_a_dot_tmp_folder_inside_the_workspace_root() {
        let (_dir, ws) = workspace();
        assert_eq!(ws.staging_dir(), ws.root().join(".tmp"));
    }

    #[test]
    fn the_staging_dir_goes_with_the_workspace_and_is_not_touched_by_a_scoped_clean() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "a", &secret("1", "v1")).unwrap();
        fs::create_dir_all(ws.staging_dir()).unwrap();
        fs::write(ws.staging_dir().join("leftover.tmp"), "x").unwrap();

        ws.clean(Some("kv")).unwrap();
        assert!(ws.staging_dir().join("leftover.tmp").exists());

        ws.clean(None).unwrap();
        assert!(!ws.staging_dir().exists());
    }

    #[test]
    fn a_vault_cannot_be_named_like_the_staging_folder() {
        let (_dir, ws) = workspace();
        assert_eq!(
            ws.write_pull(".tmp", "a", &secret("1", "v1")),
            Err(VaultError::InvalidName)
        );
    }

    // --- clean ---

    #[test]
    fn clean_with_a_vault_removes_only_that_vault() {
        let (_dir, ws) = workspace();
        ws.write_pull("one", "a", &secret("1", "v1")).unwrap();
        ws.write_pull("two", "b", &secret("2", "v1")).unwrap();

        ws.clean(Some("one")).unwrap();

        assert!(!ws.root().join("one").exists());
        assert!(ws.root().join("two").join("b.txt").exists());
        assert_eq!(ws.local_state("one", "a").unwrap(), LocalState::Remote);
    }

    #[test]
    fn clean_without_a_vault_removes_the_whole_workspace() {
        let (_dir, ws) = workspace();
        ws.write_pull("one", "a", &secret("1", "v1")).unwrap();
        ws.write_pull("two", "b", &secret("2", "v1")).unwrap();

        ws.clean(None).unwrap();

        assert!(!ws.root().exists());
    }

    #[test]
    fn clean_treats_missing_folders_as_success() {
        let (_dir, ws) = workspace();
        assert_eq!(ws.clean(None), Ok(()));
        assert_eq!(ws.clean(Some("never-pulled")), Ok(()));
    }

    #[test]
    fn clean_everything_refuses_a_root_whose_last_component_is_not_vault_sync() {
        let dir = tempdir().expect("tempdir");
        let precious = dir.path().join("precious");
        fs::create_dir_all(&precious).unwrap();
        fs::write(precious.join("keep.txt"), "do not delete").unwrap();

        for root in [
            dir.path().to_path_buf(),
            precious.clone(),
            dir.path().join("vault-sync-backup"),
            dir.path().join("Vault-Sync-x"),
            dir.path().join("vault-sync").join(".."),
        ] {
            let ws = Workspace::new(root.clone());
            assert!(
                matches!(ws.clean(None), Err(VaultError::Internal(_))),
                "{root:?} must be refused"
            );
        }
        assert_eq!(fs::read_to_string(precious.join("keep.txt")).unwrap(), "do not delete");
    }

    #[test]
    fn clean_everything_still_removes_a_root_named_vault_sync_and_scoped_clean_is_unguarded() {
        let dir = tempdir().expect("tempdir");
        let ws = Workspace::new(dir.path().join("deep").join("vault-sync"));
        ws.write_pull("one", "a", &secret("1", "v1")).unwrap();
        ws.write_pull("two", "b", &secret("2", "v1")).unwrap();

        ws.clean(Some("one")).unwrap();
        assert!(ws.root().join("two").exists());
        ws.clean(None).unwrap();
        assert!(!ws.root().exists());
        assert!(dir.path().join("deep").exists(), "only the root itself goes");
    }

    #[test]
    fn clean_rejects_an_invalid_vault_name_and_keeps_the_workspace() {
        let (_dir, ws) = workspace();
        ws.write_pull("kv", "a", &secret("1", "v1")).unwrap();

        assert_eq!(ws.clean(Some("..")), Err(VaultError::InvalidName));
        assert_eq!(ws.clean(Some("kv/../kv")), Err(VaultError::InvalidName));

        assert!(ws.root().join("kv").join("a.txt").exists());
    }
}
