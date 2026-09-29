/// Pure string-building helpers for the HKCU registry keys this app
/// manages. Kept separate from any registry I/O so the key paths can be
/// unit tested without touching the real Windows registry.
pub mod key_paths {
    pub fn json_file_shell() -> String {
        r"Software\Classes\SystemFileAssociations\.json\shell\JSONScout".to_string()
    }

    pub fn json_file_command() -> String {
        format!(r"{}\command", json_file_shell())
    }

    pub fn dir_background_shell() -> String {
        r"Software\Classes\Directory\Background\shell\JSONScout".to_string()
    }

    pub fn dir_background_command() -> String {
        format!(r"{}\command", dir_background_shell())
    }

    pub fn dir_shell() -> String {
        r"Software\Classes\Directory\shell\JSONScout".to_string()
    }

    pub fn dir_command() -> String {
        format!(r"{}\command", dir_shell())
    }

    /// The three top-level `shell\JSONScout` keys this app installs.
    pub fn all_shell_roots() -> [String; 3] {
        [json_file_shell(), dir_background_shell(), dir_shell()]
    }
}

/// Build the registry `command` key default value: the quoted path to
/// this executable followed by the placeholder Explorer substitutes
/// with the clicked file/folder path.
fn quoted_exe_command(exe_path: &str, arg_placeholder: &str) -> String {
    format!("\"{}\" \"{}\"", exe_path, arg_placeholder)
}

#[cfg(windows)]
mod registry {
    use super::{key_paths, quoted_exe_command};
    use winreg::enums::*;
    use winreg::RegKey;

    fn exe_path() -> Result<String, String> {
        std::env::current_exe()
            .map_err(|e| format!("Could not determine executable path: {}", e))
            .map(|p| p.to_string_lossy().to_string())
    }

    fn install_entry(
        shell_key: &str,
        command_key: &str,
        label: &str,
        arg_placeholder: &str,
    ) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe = exe_path()?;

        let (shell, _) = hkcu
            .create_subkey(shell_key)
            .map_err(|e| format!("Failed to create key '{}': {}", shell_key, e))?;
        shell
            .set_value("MUIVerb", &label)
            .map_err(|e| e.to_string())?;
        shell
            .set_value("Icon", &exe)
            .map_err(|e| e.to_string())?;

        let (command, _) = hkcu
            .create_subkey(command_key)
            .map_err(|e| format!("Failed to create key '{}': {}", command_key, e))?;
        let command_value = quoted_exe_command(&exe, arg_placeholder);
        command
            .set_value("", &command_value)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    fn remove_entry(shell_key: &str) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        match hkcu.delete_subkey_all(shell_key) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Failed to remove key '{}': {}", shell_key, e)),
        }
    }

    fn entry_exists(shell_key: &str) -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey(shell_key).is_ok()
    }

    pub fn install() -> Result<(), String> {
        // "Open in JSON Scout" on a right-clicked .json file: %1 expands
        // to the clicked file's full path.
        install_entry(
            &key_paths::json_file_shell(),
            &key_paths::json_file_command(),
            "Open in JSON Scout",
            "%1",
        )?;
        // "JSON Scout here" on a folder background: %V expands to the
        // full path of the folder being viewed.
        install_entry(
            &key_paths::dir_background_shell(),
            &key_paths::dir_background_command(),
            "JSON Scout here",
            "%V",
        )?;
        // "JSON Scout here" on a right-clicked folder: %1 expands to the
        // full path of the clicked folder.
        install_entry(
            &key_paths::dir_shell(),
            &key_paths::dir_command(),
            "JSON Scout here",
            "%1",
        )?;
        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        for root in key_paths::all_shell_roots() {
            remove_entry(&root)?;
        }
        Ok(())
    }

    pub fn is_installed() -> bool {
        key_paths::all_shell_roots().iter().all(|root| entry_exists(root))
    }
}

#[cfg(not(windows))]
mod registry {
    pub fn install() -> Result<(), String> {
        Err("Explorer context-menu integration is only available on Windows".to_string())
    }

    pub fn uninstall() -> Result<(), String> {
        Err("Explorer context-menu integration is only available on Windows".to_string())
    }

    pub fn is_installed() -> bool {
        false
    }
}

/// Install the three HKCU context-menu entries (no admin rights needed).
#[tauri::command]
pub fn install_context_menu() -> Result<(), String> {
    registry::install()
}

/// Remove the three HKCU context-menu entries, if present.
#[tauri::command]
pub fn uninstall_context_menu() -> Result<(), String> {
    registry::uninstall()
}

/// Whether all three context-menu entries are currently installed.
#[tauri::command]
pub fn is_context_menu_installed() -> bool {
    registry::is_installed()
}

#[cfg(test)]
mod tests {
    use super::key_paths;

    #[test]
    fn json_file_shell_key_lives_under_system_file_associations_for_dot_json() {
        assert_eq!(
            key_paths::json_file_shell(),
            r"Software\Classes\SystemFileAssociations\.json\shell\JSONScout"
        );
    }

    #[test]
    fn json_file_command_key_is_nested_under_the_shell_key() {
        assert_eq!(
            key_paths::json_file_command(),
            r"Software\Classes\SystemFileAssociations\.json\shell\JSONScout\command"
        );
    }

    #[test]
    fn dir_background_shell_key_targets_the_folder_background_verb() {
        assert_eq!(
            key_paths::dir_background_shell(),
            r"Software\Classes\Directory\Background\shell\JSONScout"
        );
    }

    #[test]
    fn dir_background_command_key_is_nested_under_the_shell_key() {
        assert_eq!(
            key_paths::dir_background_command(),
            r"Software\Classes\Directory\Background\shell\JSONScout\command"
        );
    }

    #[test]
    fn dir_shell_key_targets_the_folder_itself() {
        assert_eq!(
            key_paths::dir_shell(),
            r"Software\Classes\Directory\shell\JSONScout"
        );
    }

    #[test]
    fn dir_command_key_is_nested_under_the_shell_key() {
        assert_eq!(
            key_paths::dir_command(),
            r"Software\Classes\Directory\shell\JSONScout\command"
        );
    }

    #[test]
    fn all_shell_roots_returns_three_distinct_keys() {
        let roots = key_paths::all_shell_roots();
        assert_eq!(roots.len(), 3);
        let unique: std::collections::HashSet<_> = roots.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn none_of_the_managed_keys_reference_hklm_and_all_start_under_hkcu_software() {
        for root in key_paths::all_shell_roots() {
            assert!(!root.to_uppercase().contains("HKEY_LOCAL_MACHINE"));
            assert!(root.starts_with("Software"));
        }
    }

    #[test]
    fn quoted_exe_command_quotes_both_the_exe_path_and_the_placeholder() {
        assert_eq!(
            super::quoted_exe_command("C:\\Program Files\\json-scout.exe", "%1"),
            "\"C:\\Program Files\\json-scout.exe\" \"%1\""
        );
    }
}
