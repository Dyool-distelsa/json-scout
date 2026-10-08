//! Vault use cases: who am I, what is in this vault, pull one secret.
//!
//! The service owns no I/O of its own. It combines a [`SecretProvider`] (the
//! remote side) with a [`Workspace`] (the local side) and validates names
//! before either is touched.

use super::domain::{validate_name, Identity, SecretProvider, SecretRef, VaultError};
use super::json_text;
use super::preview_gate::{content_hash, PreviewGate};
use super::workspace::{normalise, Format, LocalState, PulledSecret, Workspace};
use serde::Serialize;

/// One row of a vault listing, merged with what is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretListItem {
    pub name: String,
    pub enabled: bool,
    pub local_state: LocalState,
}

/// Outcome of a successful pull.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    /// Absolute path of the working copy.
    pub path: String,
    pub base_version: String,
    pub format: Format,
}

/// Where a vault sits in the promotion chain, read from its name. The UI uses
/// it to decide how much ceremony a push needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Qa,
    Stg,
    Prod,
    Unknown,
}

/// What the vault holds right now, compared with what the working copy was
/// pulled from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCheck {
    /// The vault's current version of the secret.
    pub current_version: String,
    /// True when `current_version` is not the version the working copy was
    /// pulled from (or last pushed at).
    pub conflict: bool,
    /// The vault's current value, formatted like a pulled copy, present only
    /// on a conflict so the UI can show what would be overwritten.
    pub remote_text: Option<String>,
}

/// Everything the confirm dialog needs about one push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPreview {
    /// False when the working copy is equivalent to the base: there is
    /// nothing to push, and the preview is not remembered.
    pub changed: bool,
    pub format: Format,
    /// Version the working copy was pulled from (or last pushed at).
    pub base_version: String,
    pub base_text: String,
    pub working_text: String,
    pub remote: RemoteCheck,
    pub environment: Environment,
    /// SHA-256 (hex) of the exact bytes a push would send. `vault_push` must
    /// be given this value.
    pub content_hash: String,
}

/// Outcome of a successful push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub new_version: String,
}

/// A pulled secret with unpushed edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChange {
    pub vault: String,
    pub name: String,
}

/// The environment a vault name stands for: the part after its last hyphen,
/// compared case-insensitively. `main` and `prod` both mean production.
pub fn environment_of(vault: &str) -> Environment {
    let lowercase = vault.to_ascii_lowercase();
    match lowercase.rsplit_once('-') {
        Some((_, "dev")) => Environment::Dev,
        Some((_, "qa")) => Environment::Qa,
        Some((_, "stg")) => Environment::Stg,
        Some((_, "main" | "prod")) => Environment::Prod,
        _ => Environment::Unknown,
    }
}

/// Validate both names and build the reference, so nothing is read, written
/// or sent for a name that could escape a path or an argument.
fn validated_ref(vault: &str, name: &str) -> Result<SecretRef, VaultError> {
    validate_name(vault)?;
    validate_name(name)?;
    Ok(SecretRef {
        vault: vault.to_string(),
        name: name.to_string(),
    })
}

/// A working copy checked against its base: the bytes a push would send and
/// whether they differ from what was pulled.
struct Prepared {
    pulled: PulledSecret,
    /// Minified JSON, or the working text verbatim for a text secret.
    bytes: String,
    changed: bool,
}

pub struct VaultService<P: SecretProvider> {
    provider: P,
    workspace: Workspace,
    gate: PreviewGate,
}

impl<P: SecretProvider> VaultService<P> {
    pub fn new(provider: P, workspace: Workspace) -> Self {
        VaultService {
            provider,
            workspace,
            gate: PreviewGate::default(),
        }
    }

    /// Share the push gate that lives in the app's managed state, so a
    /// preview made by one command call is seen by the push of the next.
    pub fn with_preview_gate(mut self, gate: PreviewGate) -> Self {
        self.gate = gate;
        self
    }

    /// Diff the working copy against its base, check the vault for a newer
    /// version and remember what is about to be pushed.
    pub fn push_preview(&self, vault: &str, name: &str) -> Result<PushPreview, VaultError> {
        let reference = validated_ref(vault, name)?;
        let prepared = self.prepare(vault, name)?;

        let remote = self.provider.get(&reference)?;
        let base_version = prepared.pulled.base_version.clone();
        let conflict = remote.version != base_version;
        let content_hash = content_hash(&prepared.bytes);
        if prepared.changed {
            // A conflicting preview is remembered too: "overwrite anyway"
            // goes through the same gate.
            self.gate
                .remember(vault, name, &content_hash, &base_version, &remote.version);
        }

        Ok(PushPreview {
            changed: prepared.changed,
            format: prepared.pulled.format,
            base_version,
            base_text: prepared.pulled.base_text,
            working_text: prepared.pulled.working_text,
            remote: RemoteCheck {
                current_version: remote.version,
                conflict,
                remote_text: conflict.then(|| normalise(&remote.value).text),
            },
            environment: environment_of(vault),
            content_hash,
        })
    }

    /// Push the working copy as a new version of the secret. Refused unless
    /// `content_hash` matches an unexpired preview of exactly these bytes.
    pub fn push(
        &self,
        vault: &str,
        name: &str,
        confirmed_hash: &str,
        overwrite: bool,
    ) -> Result<PushResult, VaultError> {
        let reference = validated_ref(vault, name)?;
        // The working copy is read again here, not trusted from the preview:
        // it may have been edited since.
        let prepared = self.prepare(vault, name)?;
        if !prepared.changed {
            return Err(VaultError::NoChanges);
        }
        if content_hash(&prepared.bytes) != confirmed_hash {
            return Err(VaultError::PreviewRequired);
        }
        // Take the preview out of the gate before anything slow happens, so a
        // second push with the same hash cannot also reach `set`.
        let taken = self
            .gate
            .take(vault, name, confirmed_hash)
            .ok_or(VaultError::PreviewRequired)?;
        let previewed = taken.previewed();
        let base_version = &prepared.pulled.base_version;
        if previewed.base_version != *base_version {
            // The secret was pulled again since the preview, so that preview
            // describes a base that no longer exists: it stays consumed.
            return Err(VaultError::PreviewRequired);
        }

        // Look again right before writing: the preview may be minutes old.
        let remote = match self.provider.get(&reference) {
            Ok(remote) => remote,
            Err(err) => {
                self.gate.restore(taken);
                return Err(err);
            }
        };
        // Without `overwrite` the vault must still hold the version the
        // working copy came from. With it, the vault must hold exactly the
        // version the user saw in the preview: a version nobody reviewed is
        // never overwritten.
        let expected = if overwrite {
            &previewed.remote_version
        } else {
            base_version
        };
        if remote.version != *expected {
            self.gate.restore(taken);
            return Err(VaultError::Conflict);
        }

        let stored = match self.provider.set(&reference, &prepared.bytes) {
            Ok(stored) => stored,
            Err(err) => {
                // Nothing was written, so the same confirmed push can be retried.
                self.gate.restore(taken);
                return Err(err);
            }
        };
        self.workspace
            .record_push(vault, name, &prepared.pulled.working_text, &stored.version)
            .map_err(|err| {
                VaultError::Io(format!(
                    "the secret was pushed as version {}, but updating the local copy failed ({}); pull it again before editing",
                    stored.version,
                    err.kind()
                ))
            })?;
        Ok(PushResult {
            new_version: stored.version,
        })
    }

    /// Pulled secrets with unpushed edits, across every vault.
    pub fn local_changes(&self) -> Result<Vec<LocalChange>, VaultError> {
        Ok(self
            .workspace
            .local_changes()?
            .into_iter()
            .map(|(vault, name)| LocalChange { vault, name })
            .collect())
    }

    /// Read a secret's working copy and decide what a push would send and
    /// whether it differs from the base. A JSON working copy is validated,
    /// its keys sorted and the result minified, in that order: invalid JSON
    /// (or, when it differs, duplicate keys) refuses the push. Runs for the
    /// preview and again when the confirmed push is sent.
    fn prepare(&self, vault: &str, name: &str) -> Result<Prepared, VaultError> {
        let pulled = self.workspace.read_pulled(vault, name)?;
        let (bytes, changed) = match pulled.format {
            Format::Json => {
                let bytes = json_text::sorted_minify(&pulled.working_text).map_err(|err| {
                    VaultError::InvalidJson {
                        line: err.line,
                        column: err.column,
                    }
                })?;
                // Compared in the same sorted, minified form: reformatting or
                // reordering keys alone is not a change. A base that cannot be
                // read as JSON cannot vouch for equality, so the working copy
                // counts as changed.
                let changed =
                    json_text::sorted_minify(&pulled.base_text).map_or(true, |base| base != bytes);
                if changed {
                    let duplicates = json_text::duplicate_keys(&pulled.working_text)
                        .map_err(|err| VaultError::InvalidJson {
                            line: err.line,
                            column: err.column,
                        })?;
                    if !duplicates.is_empty() {
                        return Err(VaultError::DuplicateKeys(
                            duplicates.iter().map(|key| key.line).collect(),
                        ));
                    }
                }
                (bytes, changed)
            }
            Format::Text => {
                let changed = pulled.working_text != pulled.base_text;
                (pulled.working_text.clone(), changed)
            }
        };
        Ok(Prepared {
            pulled,
            bytes,
            changed,
        })
    }

    pub fn status(&self) -> Result<Identity, VaultError> {
        self.provider.whoami()
    }

    /// Sign in through the provider (a browser flow that can take minutes),
    /// then report who is signed in.
    pub fn login(&self) -> Result<Identity, VaultError> {
        self.provider.login()
    }

    /// List a vault's secrets, sorted by name (case-insensitive), each with
    /// its local state.
    pub fn list(&self, vault: &str) -> Result<Vec<SecretListItem>, VaultError> {
        validate_name(vault)?;
        let mut secrets = self.provider.list(vault)?;
        secrets.sort_by_key(|secret| secret.name.to_lowercase());
        secrets
            .into_iter()
            .map(|secret| {
                let local_state = match self.workspace.local_state(vault, &secret.name) {
                    Ok(state) => state,
                    // A remote name that cannot be stored locally was never
                    // pulled, so it is simply remote rather than a failure.
                    Err(VaultError::InvalidName) => LocalState::Remote,
                    // Anything else (an unreadable file, say) means the local
                    // state is unknown, which must not be shown as remote.
                    Err(other) => return Err(other),
                };
                Ok(SecretListItem {
                    name: secret.name,
                    enabled: secret.enabled,
                    local_state,
                })
            })
            .collect()
    }

    /// Fetch one secret and store it in the workspace.
    pub fn pull(&self, vault: &str, name: &str) -> Result<PullResult, VaultError> {
        validate_name(vault)?;
        validate_name(name)?;
        let reference = SecretRef {
            vault: vault.to_string(),
            name: name.to_string(),
        };
        let value = self.provider.get(&reference)?;
        let pulled = self.workspace.write_pull(vault, name, &value)?;
        Ok(PullResult {
            path: pulled.path.to_string_lossy().into_owned(),
            base_version: value.version,
            format: pulled.format,
        })
    }

    /// Drop the local copies of one vault, or of everything.
    pub fn clean(&self, vault: Option<&str>) -> Result<(), VaultError> {
        self.workspace.clean(vault)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::domain::{SecretSummary, SecretValue};
    use crate::vault::preview_gate::PREVIEW_TTL;
    use std::collections::HashMap;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;
    use tempfile::tempdir;

    struct FakeProvider {
        identity: Result<Identity, VaultError>,
        login: Result<Identity, VaultError>,
        listing: Result<Vec<SecretSummary>, VaultError>,
        values: Mutex<HashMap<String, Result<SecretValue, VaultError>>>,
        /// What `set` answers with.
        set_result: Result<SecretValue, VaultError>,
        /// Every `(secret, value)` handed to `set`.
        sets: Mutex<Vec<(SecretRef, String)>>,
        /// Runs inside `set`, after the value was read from disk: lets a test
        /// break the local side at the worst moment.
        on_set: Option<Box<dyn Fn() + Send + Sync>>,
        calls: Mutex<Vec<String>>,
    }

    impl FakeProvider {
        fn new() -> Self {
            FakeProvider {
                identity: Ok(Identity {
                    user: "ana@example.com".into(),
                    subscription: "Dev".into(),
                }),
                login: Ok(Identity {
                    user: "ben@example.com".into(),
                    subscription: "Prod".into(),
                }),
                listing: Ok(Vec::new()),
                values: Mutex::new(HashMap::new()),
                set_result: Ok(SecretValue {
                    value: String::new(),
                    version: "v-new".into(),
                    updated: None,
                }),
                sets: Mutex::new(Vec::new()),
                on_set: None,
                calls: Mutex::new(Vec::new()),
            }
        }

        fn with_listing(mut self, names: &[(&str, bool)]) -> Self {
            self.listing = Ok(names
                .iter()
                .map(|(name, enabled)| SecretSummary {
                    name: name.to_string(),
                    enabled: *enabled,
                })
                .collect());
            self
        }

        fn with_value(self, name: &str, value: &str, version: &str) -> Self {
            self.set_remote(name, value, version);
            self
        }

        /// Change what the vault holds, as if somebody else pushed.
        fn set_remote(&self, name: &str, value: &str, version: &str) {
            self.values.lock().unwrap().insert(
                name.to_string(),
                Ok(SecretValue {
                    value: value.to_string(),
                    version: version.to_string(),
                    updated: None,
                }),
            );
        }

        /// Make the next reads of a secret fail, as if the vault were unreachable.
        fn fail_remote_read(&self, name: &str, error: VaultError) {
            self.values.lock().unwrap().insert(name.to_string(), Err(error));
        }

        /// Every `(secret, value)` handed to `set`, in order.
        fn sets(&self) -> Vec<(SecretRef, String)> {
            self.sets.lock().unwrap().clone()
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl SecretProvider for FakeProvider {
        fn whoami(&self) -> Result<Identity, VaultError> {
            self.calls.lock().unwrap().push("whoami".into());
            self.identity.clone()
        }

        fn list(&self, vault: &str) -> Result<Vec<SecretSummary>, VaultError> {
            self.calls.lock().unwrap().push(format!("list {vault}"));
            self.listing.clone()
        }

        fn login(&self) -> Result<Identity, VaultError> {
            self.calls.lock().unwrap().push("login".into());
            self.login.clone()
        }

        fn get(&self, secret: &SecretRef) -> Result<SecretValue, VaultError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("get {}/{}", secret.vault, secret.name));
            self.values
                .lock()
                .unwrap()
                .get(&secret.name)
                .cloned()
                .unwrap_or(Err(VaultError::NotFound))
        }

        fn set(&self, secret: &SecretRef, value: &str) -> Result<SecretValue, VaultError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("set {}/{}", secret.vault, secret.name));
            self.sets
                .lock()
                .unwrap()
                .push((secret.clone(), value.to_string()));
            if let Some(hook) = &self.on_set {
                hook();
            }
            let stored = self.set_result.clone()?;
            // The vault now holds the new version, so a later `get` agrees.
            self.set_remote(&secret.name, value, &stored.version);
            Ok(SecretValue {
                value: value.to_string(),
                ..stored
            })
        }
    }

    fn service(provider: FakeProvider) -> (tempfile::TempDir, VaultService<FakeProvider>) {
        let dir = tempdir().expect("tempdir");
        let workspace = Workspace::new(dir.path().join("vault-sync"));
        (dir, VaultService::new(provider, workspace))
    }

    fn service_with_gate(
        provider: FakeProvider,
        gate: PreviewGate,
    ) -> (tempfile::TempDir, VaultService<FakeProvider>) {
        let (dir, svc) = service(provider);
        (dir, svc.with_preview_gate(gate))
    }

    // --- status ---

    #[test]
    fn status_returns_the_identity_reported_by_the_provider() {
        let (_dir, svc) = service(FakeProvider::new());
        let identity = svc.status().expect("status");
        assert_eq!(identity.user, "ana@example.com");
        assert_eq!(identity.subscription, "Dev");
    }

    #[test]
    fn status_propagates_a_not_signed_in_error() {
        let mut provider = FakeProvider::new();
        provider.identity = Err(VaultError::NotSignedIn);
        let (_dir, svc) = service(provider);
        assert_eq!(svc.status(), Err(VaultError::NotSignedIn));
    }

    // --- login ---

    #[test]
    fn login_returns_the_identity_from_the_provider_login() {
        let (_dir, svc) = service(FakeProvider::new());
        let identity = svc.login().expect("login");
        assert_eq!(identity.user, "ben@example.com");
        assert_eq!(identity.subscription, "Prod");
        assert_eq!(svc.provider.calls(), vec!["login"]);
    }

    #[test]
    fn login_propagates_provider_errors_and_touches_no_workspace_files() {
        let mut provider = FakeProvider::new();
        provider.login = Err(VaultError::Timeout);
        let (dir, svc) = service(provider);
        assert_eq!(svc.login(), Err(VaultError::Timeout));
        assert!(!dir.path().join("vault-sync").exists());
    }

    // --- list ---

    #[test]
    fn list_merges_the_local_state_of_each_secret() {
        let provider = FakeProvider::new()
            .with_listing(&[("pulled-clean", true), ("pulled-edited", true), ("never", false)])
            .with_value("pulled-clean", "one", "v1")
            .with_value("pulled-edited", "two", "v1");
        let (_dir, svc) = service(provider);
        svc.pull("kv", "pulled-clean").unwrap();
        let edited = svc.pull("kv", "pulled-edited").unwrap();
        fs::write(&edited.path, "changed").unwrap();

        let items = svc.list("kv").expect("list");

        let summary: Vec<(&str, bool, LocalState)> = items
            .iter()
            .map(|i| (i.name.as_str(), i.enabled, i.local_state))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("never", false, LocalState::Remote),
                ("pulled-clean", true, LocalState::Clean),
                ("pulled-edited", true, LocalState::Modified),
            ]
        );
    }

    #[test]
    fn list_sorts_names_case_insensitively() {
        let provider =
            FakeProvider::new().with_listing(&[("beta", true), ("Alpha", true), ("gamma", true)]);
        let (_dir, svc) = service(provider);
        let names: Vec<String> = svc.list("kv").unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(names, vec!["Alpha", "beta", "gamma"]);
    }

    #[test]
    fn list_does_not_fail_on_a_remote_name_that_cannot_be_stored_locally() {
        let provider = FakeProvider::new().with_listing(&[("odd.name", true)]);
        let (_dir, svc) = service(provider);
        let items = svc.list("kv").expect("list");
        assert_eq!(items[0].local_state, LocalState::Remote);
    }

    #[test]
    fn list_propagates_a_local_state_error_that_is_not_an_invalid_name() {
        let provider = FakeProvider::new().with_listing(&[("broken", true)]);
        let (dir, svc) = service(provider.with_value("broken", r#"{"a":1}"#, "v1"));
        svc.pull("kv", "broken").unwrap();
        // A directory where the base copy should be a file: reading it fails
        // with something other than "not found", so the state is unknowable.
        let unreadable = dir.path().join("vault-sync").join("kv").join(".base").join("broken.json");
        fs::remove_file(&unreadable).unwrap();
        fs::create_dir_all(&unreadable).unwrap();

        assert!(matches!(svc.list("kv"), Err(VaultError::Io(_))));
    }

    #[test]
    fn list_rejects_an_invalid_vault_name_without_calling_the_provider() {
        let provider = FakeProvider::new();
        let (_dir, svc) = service(provider);
        assert_eq!(svc.list("bad vault"), Err(VaultError::InvalidName));
        assert_eq!(svc.list("--help"), Err(VaultError::InvalidName));
        assert!(svc.provider.calls().is_empty());
    }

    #[test]
    fn list_propagates_provider_errors() {
        let mut provider = FakeProvider::new();
        provider.listing = Err(VaultError::Forbidden);
        let (_dir, svc) = service(provider);
        assert_eq!(svc.list("kv"), Err(VaultError::Forbidden));
    }

    // --- pull ---

    #[test]
    fn pull_writes_the_working_copy_the_base_copy_and_the_metadata() {
        let provider = FakeProvider::new().with_value("app-config", r#"{"b":1,"a":2}"#, "ver-1");
        let (dir, svc) = service(provider);

        let result = svc.pull("kv", "app-config").expect("pull");

        let vault_dir = dir.path().join("vault-sync").join("kv");
        assert_eq!(result.format, Format::Json);
        assert_eq!(result.base_version, "ver-1");
        assert_eq!(
            std::path::PathBuf::from(&result.path),
            vault_dir.join("app-config.json")
        );
        let expected = "{\n  \"b\": 1,\n  \"a\": 2\n}\n";
        assert_eq!(fs::read_to_string(&result.path).unwrap(), expected);
        assert_eq!(
            fs::read_to_string(vault_dir.join(".base").join("app-config.json")).unwrap(),
            expected
        );
        assert!(vault_dir.join("app-config.meta.json").exists());
        assert_eq!(svc.provider.calls(), vec!["get kv/app-config"]);
    }

    #[test]
    fn pull_stores_a_plain_text_secret_as_txt() {
        let provider = FakeProvider::new().with_value("token", "abc123", "v3");
        let (_dir, svc) = service(provider);
        let result = svc.pull("kv", "token").unwrap();
        assert_eq!(result.format, Format::Text);
        assert!(result.path.ends_with("token.txt"));
    }

    #[test]
    fn pull_rejects_invalid_names_without_calling_the_provider() {
        let provider = FakeProvider::new().with_value("ok", "x", "v1");
        let (dir, svc) = service(provider);
        for (vault, name) in [("bad vault", "ok"), ("kv", "../ok"), ("kv", ""), ("-x", "ok")] {
            assert_eq!(
                svc.pull(vault, name),
                Err(VaultError::InvalidName),
                "{vault:?}/{name:?}"
            );
        }
        assert!(svc.provider.calls().is_empty());
        assert!(!dir.path().join("vault-sync").exists());
    }

    #[test]
    fn pull_propagates_provider_errors_and_writes_nothing() {
        let (dir, svc) = service(FakeProvider::new());
        assert_eq!(svc.pull("kv", "missing"), Err(VaultError::NotFound));
        assert!(!dir.path().join("vault-sync").exists());
    }

    // --- push: helpers ---

    const PULLED: &str = r#"{"a":1,"b":2}"#;
    /// An edited working copy, and what a push sends for it.
    const EDITED: &str = "{\n  \"a\": 5,\n  \"b\": 2\n}\n";
    const EDITED_MINIFIED: &str = r#"{"a":5,"b":2}"#;

    fn secret_ref(vault: &str, name: &str) -> SecretRef {
        SecretRef {
            vault: vault.to_string(),
            name: name.to_string(),
        }
    }

    fn write_working(dir: &tempfile::TempDir, vault: &str, file: &str, text: &str) {
        let path = dir.path().join("vault-sync").join(vault).join(file);
        fs::write(path, text).unwrap();
    }

    fn read_working(dir: &tempfile::TempDir, vault: &str, file: &str) -> String {
        fs::read_to_string(dir.path().join("vault-sync").join(vault).join(file)).unwrap()
    }

    /// `kv/cfg` pulled at `v1` with `PULLED`, then edited to `edited`.
    fn edited_service(edited: &str) -> (tempfile::TempDir, VaultService<FakeProvider>) {
        let (dir, svc) = service(FakeProvider::new().with_value("cfg", PULLED, "v1"));
        svc.pull("kv", "cfg").unwrap();
        write_working(&dir, "kv", "cfg.json", edited);
        (dir, svc)
    }

    /// As `edited_service`, with the preview already taken.
    fn previewed_service(
        edited: &str,
    ) -> (tempfile::TempDir, VaultService<FakeProvider>, PushPreview) {
        let (dir, svc) = edited_service(edited);
        let preview = svc.push_preview("kv", "cfg").expect("preview");
        (dir, svc, preview)
    }

    // --- environment_of ---

    #[test]
    fn the_environment_comes_from_the_vault_name_suffix() {
        for (vault, environment) in [
            ("app-dev", Environment::Dev),
            ("app-qa", Environment::Qa),
            ("app-stg", Environment::Stg),
            ("app-main", Environment::Prod),
            ("app-prod", Environment::Prod),
            ("a-b-dev", Environment::Dev),
            ("APP-DEV", Environment::Dev),
            ("App-Prod", Environment::Prod),
            ("app", Environment::Unknown),
            ("dev", Environment::Unknown),
            ("prod", Environment::Unknown),
            ("app-devx", Environment::Unknown),
            ("app-production", Environment::Unknown),
            ("app-dev-1", Environment::Unknown),
            ("app-", Environment::Unknown),
            ("", Environment::Unknown),
        ] {
            assert_eq!(environment_of(vault), environment, "{vault:?}");
        }
    }

    #[test]
    fn the_environment_serialises_in_lowercase() {
        for (environment, text) in [
            (Environment::Dev, "dev"),
            (Environment::Qa, "qa"),
            (Environment::Stg, "stg"),
            (Environment::Prod, "prod"),
            (Environment::Unknown, "unknown"),
        ] {
            assert_eq!(serde_json::to_value(environment).unwrap(), serde_json::json!(text));
        }
    }

    // --- push_preview ---

    #[test]
    fn preview_of_an_edited_json_secret_reports_the_diff_inputs_the_remote_check_and_the_hash() {
        let (_dir, svc, preview) = previewed_service(EDITED);

        assert!(preview.changed);
        assert_eq!(preview.format, Format::Json);
        assert_eq!(preview.base_version, "v1");
        assert_eq!(preview.base_text, "{\n  \"a\": 1,\n  \"b\": 2\n}\n");
        assert_eq!(preview.working_text, EDITED);
        assert_eq!(
            preview.remote,
            RemoteCheck {
                current_version: "v1".into(),
                conflict: false,
                remote_text: None
            }
        );
        assert_eq!(preview.environment, Environment::Unknown);
        assert_eq!(preview.content_hash, content_hash(EDITED_MINIFIED));
        // One `get` to pull, one to check the remote. Nothing is written.
        assert_eq!(svc.provider.calls(), vec!["get kv/cfg", "get kv/cfg"]);
        assert!(svc.provider.sets().is_empty());
        assert_eq!(svc.gate.len(), 1);
    }

    #[test]
    fn preview_takes_the_environment_from_the_vault_name() {
        let (dir, svc) = service(FakeProvider::new().with_value("cfg", PULLED, "v1"));
        svc.pull("app-prod", "cfg").unwrap();
        write_working(&dir, "app-prod", "cfg.json", EDITED);
        assert_eq!(svc.push_preview("app-prod", "cfg").unwrap().environment, Environment::Prod);
    }

    #[test]
    fn preview_serialises_with_camel_case_field_names() {
        let (_dir, _svc, preview) = previewed_service(EDITED);
        let value = serde_json::to_value(&preview).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "baseText",
                "baseVersion",
                "changed",
                "contentHash",
                "environment",
                "format",
                "remote",
                "workingText"
            ]
        );
        assert_eq!(
            value["remote"],
            serde_json::json!({ "currentVersion": "v1", "conflict": false, "remoteText": null })
        );
        assert_eq!(value["format"], serde_json::json!("json"));
        assert_eq!(value["environment"], serde_json::json!("unknown"));
        assert_eq!(
            serde_json::to_value(PushResult { new_version: "v9".into() }).unwrap(),
            serde_json::json!({ "newVersion": "v9" })
        );
        assert_eq!(
            serde_json::to_value(LocalChange { vault: "kv".into(), name: "n".into() }).unwrap(),
            serde_json::json!({ "vault": "kv", "name": "n" })
        );
    }

    #[test]
    fn preview_of_an_unedited_secret_says_nothing_changed_and_remembers_nothing() {
        let (_dir, svc) = service(FakeProvider::new().with_value("cfg", PULLED, "v1"));
        svc.pull("kv", "cfg").unwrap();

        let preview = svc.push_preview("kv", "cfg").unwrap();

        assert!(!preview.changed);
        assert_eq!(preview.base_text, preview.working_text);
        assert_eq!(svc.gate.len(), 0);
    }

    #[test]
    fn a_whitespace_only_reformat_of_a_json_secret_is_not_a_change() {
        for reformatted in [PULLED, "{ \"a\" : 1 ,\n\"b\":2 }\n\n", "\n{\n\t\"a\": 1, \"b\": 2\n}"] {
            let (_dir, svc) = edited_service(reformatted);
            let preview = svc.push_preview("kv", "cfg").unwrap();
            assert!(!preview.changed, "{reformatted:?}");
        }
    }

    #[test]
    fn a_push_sends_the_working_copy_validated_sorted_and_minified() {
        let (_dir, svc) = edited_service("{
  \"b\": {\"y\": 1, \"x\": [ {\"k\":2,\"j\":1} ]},
  \"a\": 5
}
");
        let preview = svc.push_preview("kv", "cfg").unwrap();
        assert!(preview.changed);
        svc.push("kv", "cfg", &preview.content_hash, false).unwrap();
        let sets = svc.provider.sets();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].1, r#"{"a":5,"b":{"x":[{"j":1,"k":2}],"y":1}}"#);
    }

    #[test]
    fn json_made_invalid_after_the_preview_cancels_the_confirmed_push() {
        let (dir, svc) = edited_service(EDITED);
        let preview = svc.push_preview("kv", "cfg").unwrap();
        write_working(&dir, "kv", "cfg.json", "{\"a\": 5,");
        let err = svc.push("kv", "cfg", &preview.content_hash, false).unwrap_err();
        assert!(matches!(err, VaultError::InvalidJson { .. }), "{err:?}");
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn reordering_keys_alone_is_not_a_change_since_keys_are_sorted_before_sending() {
        for reordered in [r#"{"b":2,"a":1}"#, "{
  \"b\": 2,
  \"a\": 1
}
"] {
            let (_dir, svc) = edited_service(reordered);
            assert!(!svc.push_preview("kv", "cfg").unwrap().changed, "{reordered:?}");
        }
    }

    #[test]
    fn a_json_change_that_rewrites_a_number_or_a_type_is_a_change() {
        for edited in [r#"{"a":1.0,"b":2}"#, r#"{"a":1,"b":"2"}"#] {
            let (_dir, svc) = edited_service(edited);
            assert!(svc.push_preview("kv", "cfg").unwrap().changed, "{edited:?}");
        }
    }

    #[test]
    fn preview_of_a_text_secret_compares_bytes_and_hashes_the_text_verbatim() {
        let (dir, svc) = service(FakeProvider::new().with_value("note", "hello", "v1"));
        svc.pull("kv", "note").unwrap();
        assert!(!svc.push_preview("kv", "note").unwrap().changed);

        write_working(&dir, "kv", "note.txt", "hello\n");
        let preview = svc.push_preview("kv", "note").unwrap();

        assert!(preview.changed, "a trailing newline is a change for text");
        assert_eq!(preview.format, Format::Text);
        assert_eq!(preview.content_hash, content_hash("hello\n"));
    }

    #[test]
    fn preview_refuses_a_json_working_copy_that_is_not_valid_json_without_echoing_it() {
        let (_dir, svc) = edited_service("{\n  \"password\": hunter2-super-secret\n}\n");

        let error = svc.push_preview("kv", "cfg").unwrap_err();

        assert_eq!(error, VaultError::InvalidJson { line: 2, column: 15 });
        let shown = format!("{error} {error:?}");
        assert!(!shown.contains("hunter2") && !shown.contains("password"), "{shown}");
        // The pull's `get` only: no remote check, nothing remembered.
        assert_eq!(svc.provider.calls(), vec!["get kv/cfg"]);
        assert_eq!(svc.gate.len(), 0);
    }

    #[test]
    fn preview_refuses_duplicate_keys_in_the_working_copy_and_names_the_lines() {
        let (_dir, svc) = edited_service("{\n  \"a\": 5,\n  \"b\": 2,\n  \"a\": 6\n}\n");
        assert_eq!(
            svc.push_preview("kv", "cfg"),
            Err(VaultError::DuplicateKeys(vec![4]))
        );
        assert_eq!(svc.gate.len(), 0);
    }

    #[test]
    fn duplicate_keys_that_were_already_in_the_remote_do_not_block_an_unedited_preview() {
        let (_dir, svc) = service(FakeProvider::new().with_value("cfg", r#"{"a":1,"a":2}"#, "v1"));
        svc.pull("kv", "cfg").unwrap();
        // Pulling kept both members, so nothing is lost and nothing changed.
        let preview = svc.push_preview("kv", "cfg").unwrap();
        assert!(!preview.changed);
    }

    #[test]
    fn preview_reports_a_conflict_with_the_formatted_remote_text() {
        let (_dir, svc) = edited_service(EDITED);
        svc.provider.set_remote("cfg", r#"{"a":1,"b":2,"c":3}"#, "v2");

        let preview = svc.push_preview("kv", "cfg").unwrap();

        assert!(preview.changed);
        assert_eq!(preview.base_version, "v1");
        assert_eq!(
            preview.remote,
            RemoteCheck {
                current_version: "v2".into(),
                conflict: true,
                remote_text: Some("{\n  \"a\": 1,\n  \"b\": 2,\n  \"c\": 3\n}\n".into()),
            }
        );
        // A conflicting preview is still remembered, so "Overwrite anyway"
        // can go through the same gate.
        assert_eq!(svc.gate.len(), 1);
    }

    #[test]
    fn preview_requires_a_pulled_secret_with_a_working_copy() {
        let (dir, svc) = service(FakeProvider::new().with_value("cfg", PULLED, "v1"));
        assert_eq!(svc.push_preview("kv", "cfg"), Err(VaultError::NotPulled));

        svc.pull("kv", "cfg").unwrap();
        fs::remove_file(dir.path().join("vault-sync").join("kv").join("cfg.json")).unwrap();
        assert_eq!(svc.push_preview("kv", "cfg"), Err(VaultError::NotPulled));

        assert_eq!(svc.provider.calls(), vec!["get kv/cfg"], "no remote call for either");
    }

    #[test]
    fn preview_rejects_invalid_names_without_calling_the_provider() {
        let (_dir, svc) = service(FakeProvider::new());
        for (vault, name) in [("bad vault", "cfg"), ("kv", "../cfg"), ("-x", "cfg"), ("kv", "")] {
            assert_eq!(
                svc.push_preview(vault, name),
                Err(VaultError::InvalidName),
                "{vault:?}/{name:?}"
            );
        }
        assert!(svc.provider.calls().is_empty());
    }

    #[test]
    fn preview_propagates_a_remote_failure_and_remembers_nothing() {
        let (_dir, svc) = edited_service(EDITED);
        svc.provider.values.lock().unwrap().insert("cfg".into(), Err(VaultError::Forbidden));

        assert_eq!(svc.push_preview("kv", "cfg"), Err(VaultError::Forbidden));
        assert_eq!(svc.gate.len(), 0);
    }

    // --- push ---

    #[test]
    fn push_sends_the_minified_bytes_then_records_the_new_version_and_keeps_the_working_copy() {
        let (dir, svc, preview) = previewed_service(EDITED);

        let result = svc.push("kv", "cfg", &preview.content_hash, false).expect("push");

        assert_eq!(result, PushResult { new_version: "v-new".into() });
        assert_eq!(
            svc.provider.sets(),
            vec![(secret_ref("kv", "cfg"), EDITED_MINIFIED.to_string())]
        );
        // The remote is checked again right before the write.
        assert_eq!(
            svc.provider.calls(),
            vec!["get kv/cfg", "get kv/cfg", "get kv/cfg", "set kv/cfg"]
        );
        assert_eq!(read_working(&dir, "kv", "cfg.json"), EDITED, "working copy is kept");
        let read = svc.workspace.read_pulled("kv", "cfg").unwrap();
        assert_eq!(read.base_version, "v-new");
        assert_eq!(read.base_text, EDITED, "the pushed working text is the new base");
        assert_eq!(svc.workspace.local_state("kv", "cfg").unwrap(), LocalState::Clean);
        assert_eq!(svc.gate.len(), 0, "the preview is consumed");
    }

    #[test]
    fn a_pushed_secret_cannot_be_pushed_again_without_a_new_edit() {
        let (_dir, svc, preview) = previewed_service(EDITED);
        svc.push("kv", "cfg", &preview.content_hash, false).unwrap();

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::NoChanges)
        );
        assert_eq!(svc.provider.sets().len(), 1);
    }

    #[test]
    fn pushing_a_text_secret_sends_the_working_text_verbatim() {
        let (dir, svc) = service(FakeProvider::new().with_value("note", "hello", "v1"));
        svc.pull("kv", "note").unwrap();
        write_working(&dir, "kv", "note.txt", "hello world \n");
        let preview = svc.push_preview("kv", "note").unwrap();

        svc.push("kv", "note", &preview.content_hash, false).unwrap();

        assert_eq!(
            svc.provider.sets(),
            vec![(secret_ref("kv", "note"), "hello world \n".to_string())]
        );
        assert_eq!(svc.workspace.local_state("kv", "note").unwrap(), LocalState::Clean);
    }

    #[test]
    fn push_without_a_preview_is_refused_and_writes_nothing() {
        let (_dir, svc) = edited_service(EDITED);

        let result = svc.push("kv", "cfg", &content_hash(EDITED_MINIFIED), false);

        assert_eq!(result, Err(VaultError::PreviewRequired));
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn push_with_a_hash_that_was_not_previewed_is_refused() {
        let (_dir, svc, _preview) = previewed_service(EDITED);
        for wrong in ["", "deadbeef", &content_hash("something else")] {
            assert_eq!(
                svc.push("kv", "cfg", wrong, false),
                Err(VaultError::PreviewRequired),
                "{wrong:?}"
            );
        }
        assert!(svc.provider.sets().is_empty());
        assert_eq!(svc.gate.len(), 1, "a refused push keeps the preview");
    }

    #[test]
    fn push_after_the_working_copy_changed_since_the_preview_is_refused() {
        let (dir, svc, preview) = previewed_service(EDITED);
        write_working(&dir, "kv", "cfg.json", "{\n  \"a\": 6,\n  \"b\": 2\n}\n");

        let result = svc.push("kv", "cfg", &preview.content_hash, false);

        assert_eq!(result, Err(VaultError::PreviewRequired));
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn a_whitespace_only_edit_after_the_preview_does_not_invalidate_it() {
        let (dir, svc, preview) = previewed_service(EDITED);
        write_working(&dir, "kv", "cfg.json", "{\"a\":5,   \"b\":2}\n");

        svc.push("kv", "cfg", &preview.content_hash, false).expect("same bytes are pushed");

        assert_eq!(svc.provider.sets()[0].1, EDITED_MINIFIED);
    }

    #[test]
    fn push_after_the_preview_expired_is_refused() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let source = Arc::clone(&now);
        let gate = PreviewGate::with_clock(PREVIEW_TTL, move || *source.lock().unwrap());
        let (dir, svc) = service_with_gate(FakeProvider::new().with_value("cfg", PULLED, "v1"), gate);
        svc.pull("kv", "cfg").unwrap();
        write_working(&dir, "kv", "cfg.json", EDITED);
        let preview = svc.push_preview("kv", "cfg").unwrap();

        *now.lock().unwrap() += PREVIEW_TTL;

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::PreviewRequired)
        );
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn a_preview_made_through_one_service_is_honoured_by_another_sharing_the_gate() {
        let gate = PreviewGate::default();
        let dir = tempdir().unwrap();
        let workspace = || Workspace::new(dir.path().join("vault-sync"));
        let provider = || FakeProvider::new().with_value("cfg", PULLED, "v1");

        let first = VaultService::new(provider(), workspace()).with_preview_gate(gate.clone());
        first.pull("kv", "cfg").unwrap();
        write_working(&dir, "kv", "cfg.json", EDITED);
        let preview = first.push_preview("kv", "cfg").unwrap();

        // The commands build a fresh service for every call.
        let second = VaultService::new(provider(), workspace()).with_preview_gate(gate);
        second.push("kv", "cfg", &preview.content_hash, false).expect("push");
    }

    #[test]
    fn push_of_an_unchanged_secret_is_refused_as_no_changes() {
        let (_dir, svc) = service(FakeProvider::new().with_value("cfg", PULLED, "v1"));
        svc.pull("kv", "cfg").unwrap();

        let result = svc.push("kv", "cfg", &content_hash(PULLED), false);

        assert_eq!(result, Err(VaultError::NoChanges));
        assert_eq!(svc.provider.calls(), vec!["get kv/cfg"], "refused before any remote call");
    }

    #[test]
    fn push_refuses_a_working_copy_that_became_invalid_json_after_the_preview() {
        let (dir, svc, preview) = previewed_service(EDITED);
        write_working(&dir, "kv", "cfg.json", "{ \"a\": ");

        let result = svc.push("kv", "cfg", &preview.content_hash, false);

        assert!(matches!(result, Err(VaultError::InvalidJson { .. })), "{result:?}");
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn push_refuses_duplicate_keys_added_after_the_preview() {
        let (dir, svc, preview) = previewed_service(EDITED);
        write_working(&dir, "kv", "cfg.json", "{\"a\":5,\"a\":6}");

        let result = svc.push("kv", "cfg", &preview.content_hash, false);

        assert_eq!(result, Err(VaultError::DuplicateKeys(vec![1])));
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn push_refuses_a_conflict_without_overwrite_and_keeps_the_preview() {
        let (_dir, svc, preview) = previewed_service(EDITED);
        svc.provider.set_remote("cfg", r#"{"a":1,"b":2,"c":3}"#, "v2");

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::Conflict)
        );
        assert!(svc.provider.sets().is_empty());
        assert_eq!(svc.gate.len(), 1);
    }

    #[test]
    fn overwrite_is_refused_when_the_remote_changed_after_the_preview() {
        let (_dir, svc, preview) = previewed_service(EDITED);
        // Somebody pushed v2 after the user reviewed a preview made at v1: the
        // user never saw v2, so it must not be overwritten.
        svc.provider.set_remote("cfg", r#"{"a":1,"b":2,"c":3}"#, "v2");

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, true),
            Err(VaultError::Conflict)
        );
        assert!(svc.provider.sets().is_empty());
        assert_eq!(svc.gate.len(), 1);

        // After previewing again the user has seen v2 and can overwrite it.
        let again = svc.push_preview("kv", "cfg").unwrap();
        assert!(again.remote.conflict);
        assert_eq!(again.remote.current_version, "v2");
        svc.push("kv", "cfg", &again.content_hash, true).expect("overwrite what was seen");
        assert_eq!(svc.provider.sets().len(), 1);
        assert_eq!(svc.workspace.read_pulled("kv", "cfg").unwrap().base_version, "v-new");
    }

    #[test]
    fn overwrite_is_refused_when_the_remote_changed_again_after_a_conflicting_preview() {
        let (_dir, svc) = edited_service(EDITED);
        svc.provider.set_remote("cfg", r#"{"a":9}"#, "v2");
        let preview = svc.push_preview("kv", "cfg").unwrap();
        assert_eq!(preview.remote.current_version, "v2");
        svc.provider.set_remote("cfg", r#"{"a":10}"#, "v3");

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, true),
            Err(VaultError::Conflict)
        );
        assert!(svc.provider.sets().is_empty());
    }

    #[test]
    fn overwrite_without_any_remote_change_pushes_normally() {
        let (_dir, svc, preview) = previewed_service(EDITED);

        svc.push("kv", "cfg", &preview.content_hash, true).expect("push");

        assert_eq!(svc.provider.sets().len(), 1);
    }

    #[test]
    fn overwrite_after_a_conflicting_preview_pushes_through_the_same_gate() {
        let (dir, svc) = edited_service(EDITED);
        svc.provider.set_remote("cfg", r#"{"a":9}"#, "v2");
        let preview = svc.push_preview("kv", "cfg").unwrap();
        assert!(preview.remote.conflict);

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::Conflict)
        );
        svc.push("kv", "cfg", &preview.content_hash, true).unwrap();

        assert_eq!(read_working(&dir, "kv", "cfg.json"), EDITED);
    }

    #[test]
    fn a_vault_failure_on_write_keeps_the_local_state_and_the_preview() {
        let (_dir, mut svc, preview) = previewed_service(EDITED);
        svc.provider.set_result = Err(VaultError::Forbidden);

        let result = svc.push("kv", "cfg", &preview.content_hash, false);

        assert_eq!(result, Err(VaultError::Forbidden));
        assert_eq!(svc.workspace.local_state("kv", "cfg").unwrap(), LocalState::Modified);
        assert_eq!(svc.workspace.read_pulled("kv", "cfg").unwrap().base_version, "v1");
        assert_eq!(svc.gate.len(), 1, "the user can retry the same confirmed push");
    }

    #[test]
    fn a_failed_write_can_be_retried_with_the_same_hash() {
        let (_dir, mut svc, preview) = previewed_service(EDITED);
        svc.provider.set_result = Err(VaultError::Forbidden);
        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::Forbidden)
        );

        svc.provider.set_result = Ok(SecretValue {
            value: String::new(),
            version: "v-new".into(),
            updated: None,
        });
        let result = svc.push("kv", "cfg", &preview.content_hash, false).expect("retry");

        assert_eq!(result.new_version, "v-new");
        assert_eq!(svc.provider.sets().len(), 2, "one failed attempt and one success");
    }

    #[test]
    fn a_conflict_refusal_keeps_the_preview_for_a_retry_with_the_same_hash() {
        let (_dir, svc, preview) = previewed_service(EDITED);
        svc.provider.set_remote("cfg", r#"{"a":9}"#, "v2");
        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::Conflict)
        );
        assert!(svc.provider.sets().is_empty(), "the refused attempt wrote nothing");
        assert_eq!(svc.gate.len(), 1, "the preview is still there for the retry");

        // The conflict was resolved on the vault side (it is back at v1).
        svc.provider.set_remote("cfg", PULLED, "v1");
        svc.push("kv", "cfg", &preview.content_hash, false).expect("retry");
        assert_eq!(svc.provider.sets().len(), 1, "exactly one write, from the retry");
    }

    #[test]
    fn a_failed_remote_read_keeps_the_preview_for_a_retry_with_the_same_hash() {
        let (_dir, svc, preview) = previewed_service(EDITED);
        svc.provider.fail_remote_read("cfg", VaultError::Timeout);

        assert_eq!(
            svc.push("kv", "cfg", &preview.content_hash, false),
            Err(VaultError::Timeout)
        );
        assert!(svc.provider.sets().is_empty(), "nothing was written without a remote read");
        assert_eq!(svc.gate.len(), 1, "the preview was put back");

        // The vault answers again, still at the version the user pulled.
        svc.provider.set_remote("cfg", PULLED, "v1");
        let result = svc
            .push("kv", "cfg", &preview.content_hash, false)
            .expect("retry with the same hash");

        assert_eq!(result.new_version, "v-new");
        assert_eq!(svc.provider.sets().len(), 1);
    }

    #[test]
    fn two_pushes_racing_with_the_same_hash_write_once() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::mpsc;
        use std::time::Duration;

        // Generous for a loaded CI machine, short enough that a push which never
        // reaches `set` fails the test instead of hanging it.
        const WAIT: Duration = Duration::from_secs(5);

        let (_dir, mut svc, preview) = previewed_service(EDITED);
        let (entered_tx, entered_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let entered_tx = Mutex::new(entered_tx);
        let release_rx = Mutex::new(release_rx);
        let first = AtomicBool::new(true);
        // The first `set` stays in flight until the test lets it finish.
        svc.provider.on_set = Some(Box::new(move || {
            if first.swap(false, Ordering::SeqCst) {
                entered_tx.lock().unwrap().send(()).unwrap();
                let _ = release_rx.lock().unwrap().recv_timeout(WAIT);
            }
        }));

        let (first_result, second_result) = std::thread::scope(|scope| {
            let svc = &svc;
            let hash = preview.content_hash.as_str();
            let first = scope.spawn(move || svc.push("kv", "cfg", hash, false));
            let reached = entered_rx.recv_timeout(WAIT);
            assert!(reached.is_ok(), "the first push never reached set: {reached:?}");
            // The second push arrives while the first is still writing.
            let second = svc.push("kv", "cfg", hash, false);
            release_tx.send(()).unwrap();
            (first.join().unwrap(), second)
        });

        assert!(first_result.is_ok(), "{first_result:?}");
        assert_eq!(second_result, Err(VaultError::PreviewRequired));
        assert_eq!(svc.provider.sets().len(), 1, "set ran exactly once");
    }

    #[test]
    fn a_local_bookkeeping_failure_after_the_write_names_the_new_version() {
        let (dir, mut svc) = edited_service(EDITED);
        let base = dir.path().join("vault-sync").join("kv").join(".base").join("cfg.json");
        // Once the vault accepted the value, the base copy becomes unwritable.
        svc.provider.on_set = Some(Box::new(move || {
            fs::remove_file(&base).unwrap();
            fs::create_dir(&base).unwrap();
        }));
        let preview = svc.push_preview("kv", "cfg").unwrap();

        let error = svc.push("kv", "cfg", &preview.content_hash, false).unwrap_err();

        // The vault was written, so the message must not suggest a retry.
        assert_eq!(svc.provider.sets().len(), 1);
        let VaultError::Io(detail) = &error else { panic!("{error:?}") };
        assert!(detail.contains("v-new"), "{detail}");
        assert!(!detail.contains("\"a\""), "never any value: {detail}");
    }

    #[test]
    fn push_rejects_invalid_names_without_calling_the_provider() {
        let (_dir, svc) = service(FakeProvider::new());
        assert_eq!(svc.push("bad vault", "cfg", "h", false), Err(VaultError::InvalidName));
        assert_eq!(svc.push("kv", "../cfg", "h", true), Err(VaultError::InvalidName));
        assert!(svc.provider.calls().is_empty());
    }

    // --- local_changes ---

    #[test]
    fn local_changes_names_the_modified_secrets_of_every_vault() {
        let provider = FakeProvider::new()
            .with_value("one", PULLED, "v1")
            .with_value("two", PULLED, "v1")
            .with_value("three", "plain", "v1");
        let (dir, svc) = service(provider);
        svc.pull("kv-a", "one").unwrap();
        svc.pull("kv-a", "two").unwrap();
        svc.pull("kv-b", "three").unwrap();
        write_working(&dir, "kv-a", "two.json", EDITED);
        write_working(&dir, "kv-b", "three.txt", "changed");

        assert_eq!(
            svc.local_changes().unwrap(),
            vec![
                LocalChange { vault: "kv-a".into(), name: "two".into() },
                LocalChange { vault: "kv-b".into(), name: "three".into() },
            ]
        );
        assert_eq!(svc.provider.calls().len(), 3, "reads only the disk");
    }

    #[test]
    fn local_changes_is_empty_after_a_push_and_when_nothing_was_pulled() {
        let (_dir, svc) = service(FakeProvider::new());
        assert_eq!(svc.local_changes().unwrap(), vec![]);

        let (_dir, svc, preview) = previewed_service(EDITED);
        assert_eq!(svc.local_changes().unwrap().len(), 1);
        svc.push("kv", "cfg", &preview.content_hash, false).unwrap();
        assert_eq!(svc.local_changes().unwrap(), vec![]);
    }

    // --- clean ---

    #[test]
    fn clean_one_vault_resets_its_secrets_to_remote() {
        let provider = FakeProvider::new()
            .with_listing(&[("a", true)])
            .with_value("a", "1", "v1");
        let (_dir, svc) = service(provider);
        svc.pull("kv", "a").unwrap();
        assert_eq!(svc.list("kv").unwrap()[0].local_state, LocalState::Clean);

        svc.clean(Some("kv")).unwrap();

        assert_eq!(svc.list("kv").unwrap()[0].local_state, LocalState::Remote);
    }

    #[test]
    fn clean_everything_removes_the_workspace_and_validates_a_given_vault() {
        let provider = FakeProvider::new().with_value("a", "1", "v1");
        let (dir, svc) = service(provider);
        svc.pull("kv", "a").unwrap();

        assert_eq!(svc.clean(Some("../x")), Err(VaultError::InvalidName));
        svc.clean(None).unwrap();

        assert!(!dir.path().join("vault-sync").exists());
    }
}
