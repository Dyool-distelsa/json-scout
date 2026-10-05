//! Vault domain: value types, the error taxonomy and the provider port.
//!
//! Nothing here touches the network, the filesystem or a process. The port
//! can read a secret and create a new version of one (`set`). It cannot delete
//! or purge anything, and there is no version history yet.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use std::fmt;

/// Upper bound (inclusive) on the length of a vault or secret name.
pub const MAX_NAME_LEN: usize = 127;

/// Identifies one secret inside one vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRef {
    pub vault: String,
    pub name: String,
}

/// A secret as fetched from a vault.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue {
    pub value: String,
    pub version: String,
    pub updated: Option<String>,
}

// `Debug` is written by hand so a stray `{:?}` can never print the secret.
impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SecretValue")
            .field("value", &"<redacted>")
            .field("version", &self.version)
            .field("updated", &self.updated)
            .finish()
    }
}

/// One entry of a vault listing. Carries no value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SecretSummary {
    pub name: String,
    pub enabled: bool,
}

/// Who is signed in, as reported by the provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Identity {
    pub user: String,
    pub subscription: String,
}

/// The Azure operation that produced a diagnostic. Resource identifiers are
/// intentionally not part of this value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultOperation {
    AccountShow,
    SecretList,
    SecretGet,
    SecretSet,
    Login,
}

/// Stable, allowlisted diagnostic reason. Diagnostic text must never be
/// derived from CLI output, arguments, values or resource identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultFailureReason {
    NotSignedIn,
    Forbidden,
    NotFound,
    AzMissing,
    CommandFailed,
    Timeout,
    IoFailure,
    InvalidUtf8,
    InvalidJson,
    InvalidShape,
    MissingField,
    InvalidVersion,
    InvalidName,
}

/// Optional metadata that is safe to show in a copied diagnostic report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct VaultDiagnosticMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_status: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    /// An allowlisted response field name, never its value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
}

/// Secret-safe details for a vault failure. This is deliberately a small
/// schema: it can be copied into an issue without carrying command output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultDiagnostic {
    pub operation: VaultOperation,
    pub reason: VaultFailureReason,
    pub metadata: VaultDiagnosticMetadata,
}

impl VaultDiagnostic {
    pub(crate) fn new(operation: VaultOperation, reason: VaultFailureReason) -> Self {
        VaultDiagnostic {
            operation,
            reason,
            metadata: VaultDiagnosticMetadata::default(),
        }
    }

    pub(crate) fn with_exit_status(mut self, status: Option<i32>) -> Self {
        self.metadata.exit_status = status;
        self
    }

    pub(crate) fn with_timeout(mut self) -> Self {
        self.metadata.timed_out = Some(true);
        self
    }

    pub(crate) fn with_position(mut self, line: usize, column: usize) -> Self {
        self.metadata.line = Some(line);
        self.metadata.column = Some(column);
        self
    }

    pub(crate) fn with_field(mut self, field: &'static str) -> Self {
        self.metadata.field = Some(field);
        self
    }
}

/// Every way a vault operation can fail. Serialised to the frontend as
/// `{ "kind": "<snake_case>", "message": "<user-facing text>" }`, with
/// an optional secret-safe `diagnostic` object for Azure CLI failures.
#[derive(Debug, Clone)]
pub enum VaultError {
    NotSignedIn,
    Forbidden,
    NotFound,
    AzMissing,
    InvalidName,
    Parse,
    Timeout,
    /// The secret has no local working copy to push (never pulled, or the
    /// pull did not finish, or the file was deleted).
    NotPulled,
    /// The working copy of a JSON secret is not valid JSON. Only the position
    /// is kept, never any of the text.
    InvalidJson { line: usize, column: usize },
    /// The working copy has a key twice in one object. Holds the 1-based
    /// lines of the repeated keys.
    DuplicateKeys(Vec<usize>),
    /// The working copy is the same as the pulled base: nothing to push.
    NoChanges,
    /// A push without a matching, unexpired preview of exactly these bytes.
    PreviewRequired,
    /// The vault's current version is not the one the working copy was
    /// pulled from.
    Conflict,
    Io(String),
    Cli(String),
    Internal(String),
    /// An existing error plus safe Azure operation details. The wrapper keeps
    /// the established `kind` and `message` fields unchanged for callers.
    Diagnostic {
        source: Box<VaultError>,
        diagnostic: VaultDiagnostic,
    },
}

impl VaultError {
    pub(crate) fn with_diagnostic(self, diagnostic: VaultDiagnostic) -> Self {
        match self {
            VaultError::Diagnostic { source, .. } => VaultError::Diagnostic { source, diagnostic },
            source => VaultError::Diagnostic {
                source: Box::new(source),
                diagnostic,
            },
        }
    }

    pub fn diagnostic(&self) -> Option<&VaultDiagnostic> {
        match self {
            VaultError::Diagnostic { diagnostic, .. } => Some(diagnostic),
            _ => None,
        }
    }

    fn without_diagnostic(&self) -> &VaultError {
        let mut error = self;
        while let VaultError::Diagnostic { source, .. } = error {
            error = source;
        }
        error
    }

    /// Stable machine-readable discriminator for the frontend.
    pub fn kind(&self) -> &'static str {
        match self.without_diagnostic() {
            VaultError::NotSignedIn => "not_signed_in",
            VaultError::Forbidden => "forbidden",
            VaultError::NotFound => "not_found",
            VaultError::AzMissing => "az_missing",
            VaultError::InvalidName => "invalid_name",
            VaultError::Parse => "parse",
            VaultError::Timeout => "timeout",
            VaultError::NotPulled => "not_pulled",
            VaultError::InvalidJson { .. } => "invalid_json",
            VaultError::DuplicateKeys(_) => "duplicate_keys",
            VaultError::NoChanges => "no_changes",
            VaultError::PreviewRequired => "preview_required",
            VaultError::Conflict => "conflict",
            VaultError::Io(_) => "io",
            VaultError::Cli(_) => "cli",
            VaultError::Internal(_) => "internal",
            VaultError::Diagnostic { source, .. } => source.kind(),
        }
    }
}

impl PartialEq for VaultError {
    fn eq(&self, other: &Self) -> bool {
        match (self.without_diagnostic(), other.without_diagnostic()) {
            (VaultError::NotSignedIn, VaultError::NotSignedIn)
            | (VaultError::Forbidden, VaultError::Forbidden)
            | (VaultError::NotFound, VaultError::NotFound)
            | (VaultError::AzMissing, VaultError::AzMissing)
            | (VaultError::InvalidName, VaultError::InvalidName)
            | (VaultError::Parse, VaultError::Parse)
            | (VaultError::Timeout, VaultError::Timeout)
            | (VaultError::NotPulled, VaultError::NotPulled)
            | (VaultError::NoChanges, VaultError::NoChanges)
            | (VaultError::PreviewRequired, VaultError::PreviewRequired)
            | (VaultError::Conflict, VaultError::Conflict) => true,
            (
                VaultError::InvalidJson {
                    line: a_line,
                    column: a_column,
                },
                VaultError::InvalidJson {
                    line: b_line,
                    column: b_column,
                },
            ) => a_line == b_line && a_column == b_column,
            (VaultError::DuplicateKeys(a), VaultError::DuplicateKeys(b)) => a == b,
            (VaultError::Io(a), VaultError::Io(b))
            | (VaultError::Cli(a), VaultError::Cli(b))
            | (VaultError::Internal(a), VaultError::Internal(b)) => a == b,
            _ => false,
        }
    }
}

impl Eq for VaultError {}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.without_diagnostic() {
            VaultError::NotSignedIn => {
                f.write_str("Not signed in to Azure. Run `az login` and retry.")
            }
            VaultError::Forbidden => f.write_str(
                "Access denied. Your account does not have permission to read or write secrets in this vault.",
            ),
            VaultError::NotFound => f.write_str("The vault or secret was not found."),
            VaultError::AzMissing => f.write_str(
                "The Azure CLI (`az`) was not found. Install it and make sure it is on your PATH.",
            ),
            VaultError::InvalidName => f.write_str(
                "Names may only contain letters, digits and hyphens (not starting with a hyphen), up to 127 characters.",
            ),
            VaultError::Parse => {
                f.write_str("Could not understand the response from the Azure CLI.")
            }
            VaultError::Timeout => f.write_str(
                "The Azure CLI did not respond in time. Check your network connection and `az`, then retry.",
            ),
            VaultError::NotPulled => f.write_str(
                "This secret has no local working copy. Pull it before pushing.",
            ),
            VaultError::InvalidJson { line, column } => write!(
                f,
                "The working copy is not valid JSON (line {line}, column {column}). Fix it and try again."
            ),
            VaultError::DuplicateKeys(lines) => {
                const SHOWN: usize = 5;
                let listed: Vec<String> = lines.iter().take(SHOWN).map(usize::to_string).collect();
                let more = lines.len().saturating_sub(SHOWN);
                write!(f, "The JSON repeats a key in the same object (at line {}", listed.join(", "))?;
                if more > 0 {
                    write!(f, " and {more} more")?;
                }
                f.write_str("). Remove or rename the duplicates, then preview again.")
            }
            VaultError::NoChanges => f.write_str("There are no changes to push."),
            VaultError::PreviewRequired => f.write_str(
                "The preview is missing, expired or out of date. Review the changes again before pushing.",
            ),
            VaultError::Conflict => f.write_str(
                "The secret changed in the vault after you pulled it. Re-pull it, or overwrite the vault's version.",
            ),
            VaultError::Io(detail) => write!(f, "File system error: {detail}"),
            VaultError::Cli(detail) => write!(f, "Azure CLI error: {detail}"),
            VaultError::Internal(detail) => write!(f, "Internal error: {detail}"),
            VaultError::Diagnostic { source, .. } => source.fmt(f),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<std::io::Error> for VaultError {
    fn from(err: std::io::Error) -> Self {
        VaultError::Io(err.to_string())
    }
}

impl Serialize for VaultError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let field_count = if self.diagnostic().is_some() { 3 } else { 2 };
        let mut state = serializer.serialize_struct("VaultError", field_count)?;
        let source = self.without_diagnostic();
        state.serialize_field("kind", source.kind())?;
        state.serialize_field("message", &source.to_string())?;
        if let Some(diagnostic) = self.diagnostic() {
            state.serialize_field("diagnostic", diagnostic)?;
        }
        state.end()
    }
}

/// Read-only access to a secret store.
pub trait SecretProvider: Send + Sync {
    fn whoami(&self) -> Result<Identity, VaultError>;
    fn list(&self, vault: &str) -> Result<Vec<SecretSummary>, VaultError>;
    fn get(&self, secret: &SecretRef) -> Result<SecretValue, VaultError>;
    /// Establish a session interactively (for the Azure CLI this opens the
    /// system browser and blocks until the user finishes), then report who is
    /// signed in. It never returns a credential.
    fn login(&self) -> Result<Identity, VaultError>;
    /// Create a new version of `secret` holding exactly `value`, and return
    /// it with the version the vault assigned. The old versions stay in the
    /// vault. A secret value never travels in a process argument.
    fn set(&self, secret: &SecretRef, value: &str) -> Result<SecretValue, VaultError>;
}

/// Accept only `^[A-Za-z0-9-]{1,127}$`, and additionally refuse a leading
/// hyphen so a name can never be read as a command-line option.
pub fn validate_name(name: &str) -> Result<(), VaultError> {
    let well_formed = (1..=MAX_NAME_LEN).contains(&name.len())
        && !name.starts_with('-')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if well_formed {
        Ok(())
    } else {
        Err(VaultError::InvalidName)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validate_name_accepts_letters_digits_and_inner_hyphens() {
        for name in ["a", "Z", "0", "my-vault", "App-Settings-01", "a-"] {
            assert_eq!(validate_name(name), Ok(()), "{name} should be valid");
        }
    }

    #[test]
    fn validate_name_enforces_the_length_boundaries() {
        assert_eq!(validate_name(""), Err(VaultError::InvalidName));
        assert_eq!(validate_name(&"a".repeat(MAX_NAME_LEN)), Ok(()));
        assert_eq!(
            validate_name(&"a".repeat(MAX_NAME_LEN + 1)),
            Err(VaultError::InvalidName)
        );
    }

    #[test]
    fn validate_name_rejects_characters_that_could_escape_an_argument_or_a_path() {
        let hostile = [
            "a b", "a.b", "a/b", "a\\b", "..", "../x", "a_b", "a;b", "a&b", "a|b", "a\"b", "a'b",
            "a\nb", "a\tb", "a%b", "a^b", "a$b", "a`b", "a*b", "a:b", "ñandú", "名前", " ", "a\0b",
        ];
        for name in hostile {
            assert_eq!(
                validate_name(name),
                Err(VaultError::InvalidName),
                "{name:?} should be rejected"
            );
        }
    }

    #[test]
    fn validate_name_rejects_a_leading_hyphen_so_it_cannot_become_a_cli_flag() {
        for name in ["-", "-o", "--query", "--vault-name"] {
            assert_eq!(
                validate_name(name),
                Err(VaultError::InvalidName),
                "{name:?} should be rejected"
            );
        }
    }

    #[test]
    fn vault_error_kinds_are_the_expected_snake_case_identifiers() {
        let cases = [
            (VaultError::NotSignedIn, "not_signed_in"),
            (VaultError::Forbidden, "forbidden"),
            (VaultError::NotFound, "not_found"),
            (VaultError::AzMissing, "az_missing"),
            (VaultError::InvalidName, "invalid_name"),
            (VaultError::Parse, "parse"),
            (VaultError::Timeout, "timeout"),
            (VaultError::NotPulled, "not_pulled"),
            (VaultError::InvalidJson { line: 1, column: 2 }, "invalid_json"),
            (VaultError::DuplicateKeys(vec![3]), "duplicate_keys"),
            (VaultError::NoChanges, "no_changes"),
            (VaultError::PreviewRequired, "preview_required"),
            (VaultError::Conflict, "conflict"),
            (VaultError::Io("x".into()), "io"),
            (VaultError::Cli("x".into()), "cli"),
            (VaultError::Internal("x".into()), "internal"),
        ];
        for (error, kind) in cases {
            assert_eq!(error.kind(), kind);
        }
    }

    #[test]
    fn vault_error_serialises_as_kind_and_message() {
        let value = serde_json::to_value(VaultError::NotSignedIn).unwrap();
        assert_eq!(value["kind"], json!("not_signed_in"));
        assert_eq!(value["message"], json!(VaultError::NotSignedIn.to_string()));
        assert_eq!(value.as_object().unwrap().len(), 2);
    }

    #[test]
    fn vault_error_serialises_a_secret_safe_diagnostic_without_changing_kind_or_message() {
        let error = VaultError::Parse.with_diagnostic(
            VaultDiagnostic::new(VaultOperation::SecretGet, VaultFailureReason::InvalidJson)
                .with_position(3, 7),
        );
        let value = serde_json::to_value(error).unwrap();

        assert_eq!(value["kind"], json!("parse"));
        assert_eq!(
            value["message"],
            json!("Could not understand the response from the Azure CLI.")
        );
        assert_eq!(
            value["diagnostic"],
            json!({
                "operation": "secret_get",
                "reason": "invalid_json",
                "metadata": { "line": 3, "column": 7 }
            })
        );
        assert!(!value.to_string().contains("hunter2-super-secret"));
    }

    #[test]
    fn vault_error_without_diagnostic_keeps_the_legacy_two_field_shape() {
        let value = serde_json::to_value(VaultError::NotSignedIn).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert!(!value.as_object().unwrap().contains_key("diagnostic"));
    }

    #[test]
    fn vault_error_messages_are_user_facing_and_non_empty() {
        assert!(VaultError::NotSignedIn.to_string().contains("az login"));
        for error in [
            VaultError::NotSignedIn,
            VaultError::Forbidden,
            VaultError::NotFound,
            VaultError::AzMissing,
            VaultError::InvalidName,
            VaultError::Parse,
            VaultError::Timeout,
        ] {
            assert!(!error.to_string().is_empty(), "{:?}", error);
        }
    }

    #[test]
    fn push_error_messages_are_user_facing_and_never_carry_any_text() {
        let invalid = VaultError::InvalidJson { line: 12, column: 7 }.to_string();
        assert!(invalid.contains("line 12") && invalid.contains("column 7"), "{invalid}");

        let few = VaultError::DuplicateKeys(vec![3, 9]).to_string();
        assert!(few.contains("line 3, 9"), "{few}");
        assert!(!few.contains("more"), "{few}");

        let many = VaultError::DuplicateKeys(vec![1, 2, 3, 4, 5, 6, 7]).to_string();
        assert!(many.contains("1, 2, 3, 4, 5") && many.contains("and 2 more"), "{many}");
        assert!(!many.contains('6'), "{many}");

        for error in [
            VaultError::NotPulled,
            VaultError::NoChanges,
            VaultError::PreviewRequired,
            VaultError::Conflict,
        ] {
            assert!(!error.to_string().is_empty(), "{error:?}");
        }
        assert!(VaultError::NotPulled.to_string().contains("Pull"));
        assert!(VaultError::Conflict.to_string().contains("Re-pull"));
        assert!(VaultError::PreviewRequired.to_string().contains("preview") || VaultError::PreviewRequired.to_string().contains("Review"));
    }

    #[test]
    fn the_forbidden_message_covers_writing_as_well_as_reading() {
        assert!(VaultError::Forbidden.to_string().contains("write"));
    }

    #[test]
    fn the_timeout_message_tells_the_user_to_check_the_network_and_az_and_retry() {
        let message = VaultError::Timeout.to_string();
        assert!(message.contains("network"), "{message}");
        assert!(message.contains("`az`"), "{message}");
        assert!(message.contains("retry"), "{message}");
    }

    #[test]
    fn cli_and_io_errors_carry_their_detail_in_the_message() {
        assert!(VaultError::Cli("boom".into()).to_string().contains("boom"));
        assert!(VaultError::Io("disk full".into())
            .to_string()
            .contains("disk full"));
    }

    #[test]
    fn io_errors_convert_into_vault_errors() {
        let err = std::io::Error::new(std::io::ErrorKind::Other, "nope");
        assert_eq!(VaultError::from(err), VaultError::Io("nope".into()));
    }

    #[test]
    fn secret_value_debug_output_never_contains_the_value() {
        let secret = SecretValue {
            value: "hunter2-super-secret".into(),
            version: "v1".into(),
            updated: None,
        };
        let rendered = format!("{:?}", secret);
        assert!(!rendered.contains("hunter2"));
        assert!(rendered.contains("v1"));
    }

    #[test]
    fn identity_and_summary_serialise_with_plain_field_names() {
        let identity = Identity {
            user: "a@b.c".into(),
            subscription: "sub".into(),
        };
        assert_eq!(
            serde_json::to_value(identity).unwrap(),
            json!({ "user": "a@b.c", "subscription": "sub" })
        );
        let summary = SecretSummary {
            name: "n".into(),
            enabled: true,
        };
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            json!({ "name": "n", "enabled": true })
        );
    }
}
