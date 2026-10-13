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
    /// Repository-relative path of the committed version (the original path
    /// of a rename), or `None` when the file is not in `HEAD`.
    pub head: Option<String>,
}

struct Entry {
    relative: String,
    kind: ChangeKind,
    head: Option<String>,
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
fn parse_porcelain(out: &[u8], prefix: &str) -> Vec<Entry> {
    let mut fields = out.split(|b| *b == 0).filter(|f| !f.is_empty());
    let mut changes = Vec::new();
    while let Some(field) = fields.next() {
        if field.len() < 4 {
            continue;
        }
        let (x, y) = (field[0], field[1]);
        let path = String::from_utf8_lossy(&field[3..]).into_owned();
        // The original path of a rename/copy follows as its own field.
        let original = if x == b'R' || x == b'C' {
            fields.next().map(|f| String::from_utf8_lossy(f).into_owned())
        } else {
            None
        };
        if path.ends_with('/') || !path.to_lowercase().ends_with(".json") {
            continue;
        }
        let kind = kind_of(x, y);
        let head = match kind {
            ChangeKind::Untracked | ChangeKind::Added => None,
            _ => Some(original.unwrap_or_else(|| path.clone())),
        };
        let relative = path.strip_prefix(prefix).unwrap_or(&path).to_string();
        changes.push(Entry { relative, kind, head });
    }
    changes.sort_by(|a, b| a.relative.to_lowercase().cmp(&b.relative.to_lowercase()));
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
            .map(|Entry { relative, kind, head }| {
                let mut absolute = PathBuf::from(&path);
                absolute.extend(relative.split('/'));
                ChangedFile {
                    path: absolute.to_string_lossy().into_owned(),
                    relative,
                    kind,
                    head,
                }
            })
            .collect(),
    )
}

/// The committed (`HEAD`) text of `head`, a repository-relative path as
/// `git_changed_json` reports it, read from the repository holding `dir`.
#[tauri::command(async)]
pub fn git_head_text(dir: String, head: String) -> Result<String, String> {
    let bytes = run_git(&dir, &["show", &format!("HEAD:{}", head)])
        .ok_or_else(|| format!("Could not read the committed version of '{}'", head))?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_porcelain_entries_keeping_only_json() {
        let out = b" M sub/a.json\0?? sub/new.JSON\0D  sub/gone.json\0R  sub/to.json\0sub/from.json\0 M sub/readme.md\0UU sub/c.json\0A  sub/added.json\0";
        let changes: Vec<(String, ChangeKind, Option<String>)> = parse_porcelain(out, "sub/")
            .into_iter()
            .map(|e| (e.relative, e.kind, e.head))
            .collect();
        let some = |p: &str| Some(p.to_string());
        assert_eq!(
            changes,
            vec![
                ("a.json".to_string(), ChangeKind::Modified, some("sub/a.json")),
                ("added.json".to_string(), ChangeKind::Added, None),
                ("c.json".to_string(), ChangeKind::Conflict, some("sub/c.json")),
                ("gone.json".to_string(), ChangeKind::Deleted, some("sub/gone.json")),
                ("new.JSON".to_string(), ChangeKind::Untracked, None),
                ("to.json".to_string(), ChangeKind::Renamed, some("sub/from.json")),
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

    #[test]
    fn reads_the_committed_text_of_a_modified_file() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        if run_git(&root, &["init", "-q"]).is_none() {
            return; // git not installed here
        }
        let sub = dir.path().join("cfg");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.json"), r#"{"v":1}"#).unwrap();
        run_git(&root, &["add", "."]).unwrap();
        run_git(&root, &["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]).unwrap();
        fs::write(sub.join("a.json"), r#"{"v":2}"#).unwrap();

        let sub_dir = sub.to_string_lossy().to_string();
        let changes = git_changed_json(sub_dir.clone()).unwrap();
        assert_eq!(changes[0].kind, ChangeKind::Modified);
        let head = changes[0].head.clone().unwrap();
        assert_eq!(head, "cfg/a.json");
        assert_eq!(git_head_text(sub_dir, head).unwrap(), r#"{"v":1}"#);
    }
}
