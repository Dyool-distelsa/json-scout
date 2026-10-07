//! Unsaved "Untitled" documents, kept in the app data folder so they survive
//! closing the app (like Notepad). The frontend owns the ids; each draft is one
//! file named `<id>.draft`. The folder is separate from the vault workspace,
//! which is wiped on every start and exit.

use crate::fs_ops::write_file_atomic;
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const DRAFTS_DIR: &str = "drafts";
const EXTENSION: &str = "draft";
const MAX_ID_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Draft {
    pub id: String,
    pub contents: String,
}

/// Ids become file names, so only `[a-z0-9-]` is accepted: no separators, no
/// dots, nothing a path could be built from.
fn validate_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if valid {
        Ok(())
    } else {
        Err("Invalid draft id".to_string())
    }
}

fn draft_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    Ok(dir.join(format!("{id}.{EXTENSION}")))
}

fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(DRAFTS_DIR))
        .map_err(|e| format!("Drafts folder unavailable: {e}"))
}

/// Every stored draft, ordered by id. A missing folder means no drafts; an
/// unreadable entry is skipped rather than hiding the others.
pub fn list_in(dir: &Path) -> Result<Vec<Draft>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Failed to read drafts: {e}")),
    };
    let mut drafts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some(EXTENSION) {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if validate_id(id).is_err() {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(&path) {
            drafts.push(Draft {
                id: id.to_string(),
                contents,
            });
        }
    }
    drafts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(drafts)
}

pub fn save_in(dir: &Path, id: &str, contents: &str) -> Result<(), String> {
    let path = draft_path(dir, id)?;
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create drafts folder: {e}"))?;
    write_file_atomic(&path, contents).map_err(|e| format!("Failed to save draft: {e}"))
}

/// Deleting a draft that does not exist is not an error.
pub fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    let path = draft_path(dir, id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete draft: {e}")),
    }
}

#[tauri::command]
pub fn drafts_list(app: AppHandle) -> Result<Vec<Draft>, String> {
    list_in(&drafts_dir(&app)?)
}

#[tauri::command]
pub fn draft_save(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    save_in(&drafts_dir(&app)?, &id, &contents)
}

#[tauri::command]
pub fn draft_delete(app: AppHandle, id: String) -> Result<(), String> {
    delete_in(&drafts_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn a_missing_folder_has_no_drafts() {
        let dir = tempdir().unwrap();
        assert_eq!(list_in(&dir.path().join("drafts")).unwrap(), Vec::new());
    }

    #[test]
    fn saved_drafts_are_listed_in_id_order_and_can_be_overwritten() {
        let dir = tempdir().unwrap();
        let drafts = dir.path().join("drafts");
        save_in(&drafts, "b-2", "{\"b\":1}").unwrap();
        save_in(&drafts, "a-1", "first").unwrap();
        save_in(&drafts, "a-1", "second").unwrap();
        let listed = list_in(&drafts).unwrap();
        assert_eq!(
            listed,
            vec![
                Draft {
                    id: "a-1".into(),
                    contents: "second".into()
                },
                Draft {
                    id: "b-2".into(),
                    contents: "{\"b\":1}".into()
                },
            ]
        );
    }

    #[test]
    fn delete_removes_a_draft_and_tolerates_a_missing_one() {
        let dir = tempdir().unwrap();
        save_in(dir.path(), "x", "text").unwrap();
        delete_in(dir.path(), "x").unwrap();
        delete_in(dir.path(), "x").unwrap();
        assert!(list_in(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn ids_that_could_name_another_path_are_refused() {
        let dir = tempdir().unwrap();
        for id in ["", "../x", "a/b", "a\\b", "A", "a.b", &"a".repeat(65)] {
            assert!(save_in(dir.path(), id, "x").is_err(), "{id:?} was accepted");
            assert!(delete_in(dir.path(), id).is_err(), "{id:?} was accepted");
        }
        assert!(list_in(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn unrelated_files_in_the_folder_are_ignored() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        fs::write(dir.path().join("Bad.draft"), "x").unwrap();
        save_in(dir.path(), "ok", "y").unwrap();
        let ids: Vec<String> = list_in(dir.path())
            .unwrap()
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids, vec!["ok".to_string()]);
    }
}
