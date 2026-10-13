//! Git working-tree changes for the folder opened in the Files panel.

use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangedFile {
    /// Path relative to the opened folder, with `/` separators.
    pub relative: String,
    /// Absolute path, built on the opened folder so it matches the tree's paths.
    pub path: String,
    pub kind: ChangeKind,
}

fn run_git(dir: &str, args: &[&str]) -> Option<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(dir)
        .args(args)
        // A background status must never take the index lock away from the
        // user's own git commands.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    output.status.success().then_some(output.stdout)
}

fn kind_of(x: u8, y: u8) -> ChangeKind {
    match (x, y) {
        (b'?', b'?') => ChangeKind::Untracked,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => ChangeKind::Conflict,
        (b'D', _) | (_, b'D') => ChangeKind::Deleted,
        (b'R', _) | (_, b'R') | (b'C', _) => ChangeKind::Renamed,
        (b'A', _) => ChangeKind::Added,
        _ => ChangeKind::Modified,
    }
}

/// Parse `git status --porcelain=v1 -z` output, keeping `*.json` entries.
/// Paths come relative to the repository root; `prefix` (from
/// `git rev-parse --show-prefix`) is stripped so they are relative to the
/// opened folder.
fn parse_porcelain(out: &[u8], prefix: &str) -> Vec<(String, ChangeKind)> {
    let mut fields = out.split(|b| *b == 0).filter(|f| !f.is_empty());
    let mut changes = Vec::new();
    while let Some(field) = fields.next() {
        if field.len() < 4 {
            continue;
        }
        let (x, y) = (field[0], field[1]);
        if x == b'R' || x == b'C' {
            // The original path of a rename/copy follows as its own field.
            fields.next();
        }
        let path = String::from_utf8_lossy(&field[3..]).into_owned();
        if path.ends_with('/') || !path.to_lowercase().ends_with(".json") {
            continue;
        }
        let relative = path.strip_prefix(prefix).unwrap_or(&path).to_string();
        changes.push((relative, kind_of(x, y)));
    }
    changes.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    changes
}

/// The changed `*.json` files under `path`, or `None` when it is not inside
/// a git repository (or git is not installed).
#[tauri::command(async)]
pub fn git_changed_json(path: String) -> Option<Vec<ChangedFile>> {
    let prefix = run_git(&path, &["rev-parse", "--show-prefix"])?;
    let prefix = String::from_utf8_lossy(&prefix).trim().to_string();
    let out = run_git(
        &path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    )?;
    Some(
        parse_porcelain(&out, &prefix)
            .into_iter()
            .map(|(relative, kind)| {
                let mut absolute = PathBuf::from(&path);
                absolute.extend(relative.split('/'));
                ChangedFile {
                    path: absolute.to_string_lossy().into_owned(),
                    relative,
                    kind,
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_porcelain_entries_keeping_only_json() {
        let out = b" M sub/a.json\0?? sub/new.JSON\0D  sub/gone.json\0R  sub/to.json\0sub/from.json\0 M sub/readme.md\0UU sub/c.json\0A  sub/added.json\0";
        let changes = parse_porcelain(out, "sub/");
        assert_eq!(
            changes,
            vec![
                ("a.json".to_string(), ChangeKind::Modified),
                ("added.json".to_string(), ChangeKind::Added),
                ("c.json".to_string(), ChangeKind::Conflict),
                ("gone.json".to_string(), ChangeKind::Deleted),
                ("new.JSON".to_string(), ChangeKind::Untracked),
                ("to.json".to_string(), ChangeKind::Renamed),
            ]
        );
    }

    #[test]
    fn returns_none_outside_a_repository() {
        let dir = tempdir().unwrap();
        assert_eq!(git_changed_json(dir.path().to_string_lossy().to_string()), None);
    }

    #[test]
    fn lists_changed_json_files_of_a_subfolder_with_absolute_paths() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        if run_git(&root, &["init", "-q"]).is_none() {
            return; // git not installed here
        }
        let sub = dir.path().join("cfg");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.json"), "{}").unwrap();
        fs::write(dir.path().join("outside.json"), "{}").unwrap();

        let changes = git_changed_json(sub.to_string_lossy().to_string()).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].relative, "a.json");
        assert_eq!(changes[0].kind, ChangeKind::Untracked);
        assert_eq!(PathBuf::from(&changes[0].path), sub.join("a.json"));
    }
}
