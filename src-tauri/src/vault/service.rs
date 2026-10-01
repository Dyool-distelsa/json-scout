//! Vault use cases: who am I, what is in this vault, pull one secret.
//!
//! The service owns no I/O of its own. It combines a [`SecretProvider`] (the
//! remote side) with a [`Workspace`] (the local side) and validates names
//! before either is touched.

use super::domain::{validate_name, Identity, SecretProvider, SecretRef, VaultError};
use super::workspace::{Format, LocalState, Workspace};
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

pub struct VaultService<P: SecretProvider> {
    provider: P,
    workspace: Workspace,
}

impl<P: SecretProvider> VaultService<P> {
    pub fn new(provider: P, workspace: Workspace) -> Self {
        VaultService {
            provider,
            workspace,
        }
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
    use std::collections::HashMap;
    use std::fs;
    use std::sync::Mutex;
    use tempfile::tempdir;

    struct FakeProvider {
        identity: Result<Identity, VaultError>,
        login: Result<Identity, VaultError>,
        listing: Result<Vec<SecretSummary>, VaultError>,
        values: HashMap<String, Result<SecretValue, VaultError>>,
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
                values: HashMap::new(),
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

        fn with_value(mut self, name: &str, value: &str, version: &str) -> Self {
            self.values.insert(
                name.to_string(),
                Ok(SecretValue {
                    value: value.to_string(),
                    version: version.to_string(),
                    updated: None,
                }),
            );
            self
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
                .get(&secret.name)
                .cloned()
                .unwrap_or(Err(VaultError::NotFound))
        }
    }

    fn service(provider: FakeProvider) -> (tempfile::TempDir, VaultService<FakeProvider>) {
        let dir = tempdir().expect("tempdir");
        let workspace = Workspace::new(dir.path().join("vault-sync"));
        (dir, VaultService::new(provider, workspace))
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
