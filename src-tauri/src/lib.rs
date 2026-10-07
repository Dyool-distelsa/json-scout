mod cli;
mod drafts;
mod fs_ops;
mod shell_integration;
mod vault;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// The most recent startup payload (initial launch argv, or the argv
/// handed to us by a later invocation via the single-instance plugin).
pub struct StartupState(pub Mutex<cli::StartupPayload>);

/// The frontend calls this once it has mounted, in case it registers
/// its `startup-payload` event listener too late to catch an event
/// emitted before the window existed.
#[tauri::command]
fn get_startup_payload(state: tauri::State<StartupState>) -> cli::StartupPayload {
    state.0.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial_payload = cli::parse_argv(&args);

    tauri::Builder::default()
        // Ensures a second "Open with" / context-menu click reuses this
        // running instance instead of spawning a duplicate window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let payload = cli::parse_argv(&argv);
            if let Some(state) = app.try_state::<StartupState>() {
                *state.0.lock().unwrap() = payload.clone();
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.emit("startup-payload", payload);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // Opens the Help panel links in the system browser (scoped to the repo).
        .plugin(tauri_plugin_opener::init())
        // Closing the main window MUST end the process. The single-instance
        // plugin owns a hidden helper window that can keep the event loop
        // alive after the real window is gone, leaving an orphaned process.
        // That orphan is worse than a leak: every later launch is forwarded
        // to it by the single-instance handler and silently does nothing, so
        // the app appears to stop opening until it is killed by hand.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                // The workspace is discarded on close. The frontend asks first
                // when a pulled secret still has unpushed edits.
                vault::commands::cleanup_workspace(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        // Startup cleanup also covers a crash, which skips the exit hook above.
        .setup(|app| {
            vault::commands::cleanup_workspace(app.handle());
            Ok(())
        })
        .manage(StartupState(Mutex::new(initial_payload)))
        // Shared by every vault command call, so a push preview made by one
        // call is seen by the push of the next.
        .manage(vault::preview_gate::PreviewGate::default())
        .invoke_handler(tauri::generate_handler![
            get_startup_payload,
            fs_ops::read_json_file,
            fs_ops::write_json_file,
            fs_ops::scan_dir_for_json,
            drafts::drafts_list,
            drafts::draft_save,
            drafts::draft_delete,
            shell_integration::install_context_menu,
            shell_integration::uninstall_context_menu,
            shell_integration::is_context_menu_installed,
            vault::commands::vault_status,
            vault::commands::vault_login,
            vault::commands::vault_list,
            vault::commands::vault_pull,
            vault::commands::vault_clean,
            vault::commands::vault_push_preview,
            vault::commands::vault_push,
            vault::commands::vault_local_changes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running json-scout");
}
