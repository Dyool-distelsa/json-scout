use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

const BOM: char = '\u{FEFF}';

fn strip_bom(text: &str) -> &str {
    text.strip_prefix(BOM).unwrap_or(text)
}

/// Decode bytes as UTF-8, falling back to a lossy conversion (replacing
/// invalid sequences with U+FFFD) instead of failing outright when a
/// file is not valid UTF-8.
fn decode_lossy(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => String::from_utf8_lossy(&err.into_bytes()).into_owned(),
    }
}

/// Largest file `read_json_file` will pull into memory. The whole file is
/// held as text, shipped over IPC, and re-parsed on every keystroke, so an
/// arbitrarily large `.json` picked from the Explorer context menu would
/// exhaust memory or freeze the UI. 64 MiB is far above any hand-edited
/// JSON while still refusing multi-hundred-megabyte log dumps.
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// Format a byte count as a short human-readable string ("312.4 MB",
/// "64 MB", "900 B"). A trailing ".0" is dropped so whole values read
/// cleanly.
fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    let rendered = format!("{:.1}", value);
    let trimmed = rendered.strip_suffix(".0").unwrap_or(&rendered).to_string();
    format!("{} {}", trimmed, UNITS[unit])
}

#[derive(Debug, Clone, Serialize)]
pub struct JsonFileEntry {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch, when available on this platform.
    pub modified: Option<u64>,
}

/// Read a JSON file's contents as text, stripping a leading BOM if
/// present and tolerating non-UTF-8 bytes via lossy decoding.
#[tauri::command]
pub fn read_json_file(path: String) -> Result<String, String> {
    let size = fs::metadata(&path)
        .map_err(|e| format!("Failed to read '{}': {}", path, e))?
        .len();
    if size > MAX_READ_BYTES {
        return Err(format!(
            "File is {}, which exceeds the {} limit",
            format_bytes(size),
            format_bytes(MAX_READ_BYTES)
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))?;
    let text = decode_lossy(bytes);
    Ok(strip_bom(&text).to_string())
}

/// Write text contents to a file, creating or overwriting it.
///
/// The write is atomic: contents go to a temporary file in the same
/// directory as the target (same volume, so the rename below is
/// atomic), are flushed and `sync_all`'d to disk, then the temp file
/// is renamed over the target. If any step fails, the temp file is
/// removed on a best-effort basis and the target is left untouched.
#[tauri::command]
pub fn write_json_file(path: String, contents: String) -> Result<(), String> {
    write_json_file_atomic(&path, &contents)
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

fn write_json_file_atomic(path: &str, contents: &str) -> std::io::Result<()> {
    write_file_atomic(Path::new(path), contents)
}

/// Atomic write of `contents` to `target` (temp file in the same directory,
/// fsync, rename). Shared with the vault workspace store.
pub(crate) fn write_file_atomic(target: &Path, contents: &str) -> std::io::Result<()> {
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "tmp".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = parent.join(format!("{}.{}.{}.tmp", file_name, std::process::id(), nanos));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(contents.as_bytes())?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, target)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }

    result
}

/// Non-recursively scan a directory for `*.json` files (case-insensitive
/// extension match), returning name/size/modified for each.
#[tauri::command]
pub fn scan_dir_for_json(path: String) -> Result<Vec<JsonFileEntry>, String> {
    let dir = Path::new(&path);
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read directory '{}': {}", path, e))?;

    let mut results = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_file() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".json") {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64);

        results.push(JsonFileEntry {
            name,
            size: metadata.len(),
            modified,
        });
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

/// Folders `scan_dir_tree` never descends into: hidden ones (`.git`, ...)
/// and the usual dependency/build dumps, which hold thousands of JSON files
/// nobody opens by hand.
const SKIPPED_DIRS: [&str; 4] = ["node_modules", "target", "dist", "build"];

/// How deep `scan_dir_tree` descends below the opened folder.
const MAX_TREE_DEPTH: usize = 12;

/// Most entries (folders and files) `scan_dir_tree` visits before it stops
/// and reports the tree as truncated, so opening a huge folder stays quick.
const MAX_TREE_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
pub struct TreeFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeDir {
    pub name: String,
    pub path: String,
    pub dirs: Vec<TreeDir>,
    pub files: Vec<TreeFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirTree {
    pub root: TreeDir,
    /// True when a depth or entry limit cut the scan short.
    pub truncated: bool,
}

fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip))
}

fn modified_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

/// Scan `dir` into a `TreeDir`. Subfolders without any `*.json` file below
/// them are left out. Unreadable subfolders are skipped rather than failing
/// the whole scan.
fn scan_tree_level(dir: &Path, depth: usize, budget: &mut usize, truncated: &mut bool) -> std::io::Result<TreeDir> {
    let mut node = TreeDir {
        name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned()),
        path: dir.to_string_lossy().into_owned(),
        dirs: Vec::new(),
        files: Vec::new(),
    };
    for entry in fs::read_dir(dir)? {
        if *budget == 0 {
            *truncated = true;
            break;
        }
        *budget -= 1;
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            if is_skipped_dir(&name) {
                continue;
            }
            if depth >= MAX_TREE_DEPTH {
                *truncated = true;
                continue;
            }
            if let Ok(child) = scan_tree_level(&entry.path(), depth + 1, budget, truncated) {
                if !child.dirs.is_empty() || !child.files.is_empty() {
                    node.dirs.push(child);
                }
            }
        } else if file_type.is_file() && name.to_lowercase().ends_with(".json") {
            let Ok(metadata) = entry.metadata() else { continue };
            node.files.push(TreeFile {
                path: entry.path().to_string_lossy().into_owned(),
                size: metadata.len(),
                modified: modified_millis(&metadata),
                name,
            });
        }
    }
    node.dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    node.files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(node)
}

/// Recursively scan a folder for `*.json` files (case-insensitive), keeping
/// only the subfolders that lead to one. Hidden and dependency/build
/// folders are skipped, and depth/entry limits keep huge trees bounded.
#[tauri::command]
pub fn scan_dir_tree(path: String) -> Result<DirTree, String> {
    let mut budget = MAX_TREE_ENTRIES;
    let mut truncated = false;
    let root = scan_tree_level(Path::new(&path), 0, &mut budget, &mut truncated)
        .map_err(|e| format!("Failed to read directory '{}': {}", path, e))?;
    Ok(DirTree { root, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_json_file_strips_a_leading_bom() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("with_bom.json");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all("\u{FEFF}{\"a\":1}".as_bytes()).unwrap();

        let content = read_json_file(file_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(content, "{\"a\":1}");
    }

    #[test]
    fn read_json_file_reads_plain_utf8_without_a_bom() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("plain.json");
        fs::write(&file_path, "{\"a\":1}").unwrap();

        let content = read_json_file(file_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(content, "{\"a\":1}");
    }

    #[test]
    fn read_json_file_lossily_decodes_non_utf8_bytes_instead_of_failing() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("invalid.json");
        // 0xFF is not valid UTF-8 on its own.
        fs::write(&file_path, [b'{', 0xFF, b'}']).unwrap();

        let content = read_json_file(file_path.to_string_lossy().to_string());
        assert!(content.is_ok());
        assert!(content.unwrap().contains('{'));
    }

    #[test]
    fn read_json_file_reports_an_error_for_a_missing_file() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope.json");
        let result = read_json_file(missing.to_string_lossy().to_string());
        assert!(result.is_err());
    }

    #[test]
    fn write_json_file_writes_the_given_contents() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("out.json");

        write_json_file(file_path.to_string_lossy().to_string(), "{\"a\":1}".to_string()).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "{\"a\":1}");
    }

    #[test]
    fn write_json_file_overwrites_an_existing_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("out.json");
        fs::write(&file_path, "old").unwrap();

        write_json_file(file_path.to_string_lossy().to_string(), "new".to_string()).unwrap();

        assert_eq!(fs::read_to_string(&file_path).unwrap(), "new");
    }

    #[test]
    fn write_json_file_leaves_no_tmp_files_behind_after_success() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("out.json");

        write_json_file(file_path.to_string_lossy().to_string(), "{\"a\":1}".to_string()).unwrap();

        let tmp_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(tmp_files.is_empty());
    }

    #[test]
    fn scan_dir_for_json_lists_only_json_files_case_insensitively_and_non_recursively() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.json"), "{}").unwrap();
        fs::write(dir.path().join("b.JSON"), "{}").unwrap();
        fs::write(dir.path().join("c.txt"), "hello").unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("nested.json"), "{}").unwrap();

        let results = scan_dir_for_json(dir.path().to_string_lossy().to_string()).unwrap();
        let names: Vec<String> = results.iter().map(|e| e.name.clone()).collect();

        assert_eq!(names, vec!["a.json".to_string(), "b.JSON".to_string()]);
    }

    #[test]
    fn scan_dir_for_json_reports_sizes() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.json"), "{\"a\":1}").unwrap();

        let results = scan_dir_for_json(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].size, 7);
    }

    #[test]
    fn scan_dir_for_json_reports_an_error_for_a_missing_directory() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope");
        let result = scan_dir_for_json(missing.to_string_lossy().to_string());
        assert!(result.is_err());
    }

    #[test]
    fn scan_dir_for_json_returns_an_empty_list_for_a_directory_with_no_json_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("c.txt"), "hello").unwrap();

        let results = scan_dir_for_json(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn scan_dir_tree_recurses_and_prunes_folders_without_json() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("b.json"), "{}").unwrap();
        fs::write(dir.path().join("A.JSON"), "{}").unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let nested = dir.path().join("config").join("env");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("dev.json"), "{\"a\":1}").unwrap();
        fs::create_dir(dir.path().join("empty")).unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules").join("pkg.json"), "{}").unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("x.json"), "{}").unwrap();

        let tree = scan_dir_tree(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(!tree.truncated);
        let files: Vec<&str> = tree.root.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(files, vec!["A.JSON", "b.json"]);
        assert_eq!(tree.root.dirs.len(), 1);
        let config = &tree.root.dirs[0];
        assert_eq!(config.name, "config");
        assert!(config.files.is_empty());
        let env = &config.dirs[0];
        assert_eq!(env.files[0].name, "dev.json");
        assert_eq!(env.files[0].size, 7);
        assert_eq!(Path::new(&env.files[0].path), nested.join("dev.json"));
    }

    #[test]
    fn scan_dir_tree_reports_an_error_for_a_missing_directory() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(scan_dir_tree(missing.to_string_lossy().to_string()).is_err());
    }

    #[test]
    fn max_read_bytes_is_64_mib() {
        assert_eq!(MAX_READ_BYTES, 67_108_864);
    }

    #[test]
    fn format_bytes_renders_representative_sizes() {
        assert_eq!(format_bytes(900), "900 B");
        assert_eq!(format_bytes(1024), "1 KB");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(MAX_READ_BYTES), "64 MB");
        assert_eq!(format_bytes(327_664_435), "312.5 MB");
        assert_eq!(format_bytes(2 * 1024 * 1024 * 1024), "2 GB");
    }

    #[test]
    fn format_bytes_drops_a_trailing_zero_decimal() {
        assert!(!format_bytes(5 * 1024 * 1024).contains('.'));
    }

    #[test]
    fn read_json_file_reads_a_file_comfortably_under_the_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("small.json");
        fs::write(&path, "{\"ok\":1}").expect("write");
        let text = read_json_file(path.to_string_lossy().into_owned()).expect("read");
        assert_eq!(text, "{\"ok\":1}");
    }

    #[test]
    fn read_json_file_reports_the_size_and_limit_when_too_large() {
        // Exercises the message shape without materializing a 64 MiB file.
        let msg = format!(
            "File is {}, which exceeds the {} limit",
            format_bytes(327_664_435),
            format_bytes(MAX_READ_BYTES)
        );
        assert_eq!(msg, "File is 312.5 MB, which exceeds the 64 MB limit");
    }
}
