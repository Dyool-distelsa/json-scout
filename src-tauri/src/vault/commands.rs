//! Tauri command layer for the vault feature.
//!
//! Commands are `async` and run the synchronous service inside
//! `spawn_blocking`, so a slow `az` call never occupies an async worker.

use super::az_cli::{AzCliProvider, SystemRunner};
use super::domain::{Identity, VaultError};
use super::preview_gate::PreviewGate;
use super::service::{LocalChange, PullResult, PushPreview, PushResult, SecretListItem, VaultService};
use super::workspace::{Workspace, ROOT_DIR_NAME};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

type Service = VaultService<AzCliProvider<SystemRunner>>;

/// Folder name of the workspace inside the app data directory.
const WORKSPACE_DIR: &str = ROOT_DIR_NAME;

fn workspace_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(WORKSPACE_DIR)
}

fn workspace_for(app: &AppHandle) -> Result<Workspace, VaultError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|err| VaultError::Io(err.to_string()))?;
    Ok(Workspace::new(workspace_root(&app_data)))
}

fn service_for(workspace: Workspace) -> Service {
    let provider = AzCliProvider::new(SystemRunner::default(), workspace.staging_dir());
    VaultService::new(provider, workspace)
}

/// Run blocking work on the blocking pool, mapping a join failure (including
/// a panic inside the closure) to [`VaultError::Internal`].
async fn run_blocking<T, F>(work: F) -> Result<T, VaultError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, VaultError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| VaultError::Internal(format!("background task failed: {err}")))?
}

/// Clear the workspace. Failures are reported by kind only (never with a
/// value) and never propagate: cleanup must not block startup or shutdown.
pub fn cleanup_workspace_at(workspace: &Workspace) {
    if let Err(err) = workspace.clean(None) {
        eprintln!("vault workspace cleanup failed: {}", err.kind());
    }
}

/// Clear the workspace of the running app. Called on startup (this also
/// covers a crash, since `panic = "abort"` skips exit hooks) and when the
/// main window is destroyed.
pub fn cleanup_workspace(app: &AppHandle) {
    match workspace_for(app) {
        Ok(workspace) => cleanup_workspace_at(&workspace),
        Err(err) => eprintln!("vault workspace cleanup skipped: {}", err.kind()),
    }
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> Result<Identity, VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).status()).await
}

/// Open the Azure sign-in flow and wait for it. The CLI keeps the session;
/// only the signed-in identity comes back, never a token.
#[tauri::command]
pub async fn vault_login(app: AppHandle) -> Result<Identity, VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).login()).await
}

#[tauri::command]
pub async fn vault_list(app: AppHandle, vault: String) -> Result<Vec<SecretListItem>, VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).list(&vault)).await
}

#[tauri::command]
pub async fn vault_pull(
    app: AppHandle,
    vault: String,
    name: String,
) -> Result<PullResult, VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).pull(&vault, &name)).await
}

#[tauri::command]
pub async fn vault_clean(app: AppHandle, vault: Option<String>) -> Result<(), VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).clean(vault.as_deref())).await
}

/// Step one of a push: compare the working copy with its base, check the vault
/// for a newer version and remember what is about to be pushed. Writes
/// nothing to the vault. The frontend passes the returned `contentHash` to
/// `vault_push`.
#[tauri::command]
pub async fn vault_push_preview(
    app: AppHandle,
    gate: State<'_, PreviewGate>,
    vault: String,
    name: String,
) -> Result<PushPreview, VaultError> {
    let workspace = workspace_for(&app)?;
    let gate = gate.inner().clone();
    run_blocking(move || {
        service_for(workspace)
            .with_preview_gate(gate)
            .push_preview(&vault, &name)
    })
    .await
}

/// Step two of a push: write the previewed bytes as a new version. Refused
/// unless `contentHash` matches an unexpired preview. A missing `overwrite`
/// means `false`.
#[tauri::command]
pub async fn vault_push(
    app: AppHandle,
    gate: State<'_, PreviewGate>,
    vault: String,
    name: String,
    content_hash: String,
    overwrite: Option<bool>,
) -> Result<PushResult, VaultError> {
    let workspace = workspace_for(&app)?;
    let gate = gate.inner().clone();
    run_blocking(move || {
        service_for(workspace)
            .with_preview_gate(gate)
            .push(&vault, &name, &content_hash, overwrite.unwrap_or(false))
    })
    .await
}

/// The pulled secrets that have unpushed edits, across every vault. Reads only
/// the local disk, so it works offline and is cheap enough for a close guard.
#[tauri::command]
pub async fn vault_local_changes(app: AppHandle) -> Result<Vec<LocalChange>, VaultError> {
    let workspace = workspace_for(&app)?;
    run_blocking(move || service_for(workspace).local_changes()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn workspace_root_is_the_vault_sync_folder_inside_the_app_data_dir() {
        let root = workspace_root(Path::new("app-data"));
        assert_eq!(root, Path::new("app-data").join(WORKSPACE_DIR));
        assert_eq!(WORKSPACE_DIR, "vault-sync");
    }

    #[test]
    fn run_blocking_returns_the_value_produced_by_the_closure() {
        let result = tauri::async_runtime::block_on(run_blocking(|| Ok(41 + 1)));
        assert_eq!(result, Ok(42));
    }

    #[test]
    fn run_blocking_passes_a_vault_error_through_unchanged() {
        let result: Result<(), VaultError> =
            tauri::async_runtime::block_on(run_blocking(|| Err(VaultError::Forbidden)));
        assert_eq!(result, Err(VaultError::Forbidden));
    }

    #[test]
    fn run_blocking_maps_a_panicking_closure_to_an_internal_error() {
        let result: Result<(), VaultError> =
            tauri::async_runtime::block_on(run_blocking(|| panic!("boom")));
        assert!(matches!(result, Err(VaultError::Internal(_))), "{result:?}");
    }

    #[test]
    fn cleanup_workspace_at_removes_everything_under_the_workspace_root() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().join("vault-sync");
        std::fs::create_dir_all(root.join("kv").join(".base")).unwrap();
        std::fs::write(root.join("kv").join("a.txt"), "x").unwrap();
        let workspace = Workspace::new(root.clone());

        cleanup_workspace_at(&workspace);

        assert!(!root.exists());
    }

    #[test]
    fn cleanup_workspace_at_tolerates_a_workspace_that_does_not_exist() {
        let dir = tempdir().expect("tempdir");
        let workspace = Workspace::new(dir.path().join("vault-sync"));
        cleanup_workspace_at(&workspace);
        assert!(!dir.path().join("vault-sync").exists());
    }

    #[test]
    fn cleanup_workspace_at_leaves_a_folder_that_is_not_the_vault_sync_workspace_alone() {
        let dir = tempdir().expect("tempdir");
        std::fs::write(dir.path().join("keep.txt"), "x").unwrap();
        let workspace = Workspace::new(dir.path().to_path_buf());

        cleanup_workspace_at(&workspace);

        assert!(dir.path().join("keep.txt").exists());
    }
}
