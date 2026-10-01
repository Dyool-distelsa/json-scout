//! Vault domain: value types, the error taxonomy and the provider port.
//!
//! Nothing here touches the network, the filesystem or a process. The port
//! is deliberately read-only in this phase: there is no `set` and no version
//! history, so no adapter can write to a vault through it.

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

/// Every way a vault operation can fail. Serialised to the frontend as
/// `{ "kind": "<snake_case>", "message": "<user-facing text>" }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultError {
    NotSignedIn,
    Forbidden,
    NotFound,
    AzMissing,
    InvalidName,
    Parse,
    Timeout,
    Io(String),
    Cli(String),
    Internal(String),
}

impl VaultError {
    /// Stable machine-readable discriminator for the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            VaultError::NotSignedIn => "not_signed_in",
            VaultError::Forbidden => "forbidden",
            VaultError::NotFound => "not_found",
            VaultError::AzMissing => "az_missing",
            VaultError::InvalidName => "invalid_name",
            VaultError::Parse => "parse",
            VaultError::Timeout => "timeout",
            VaultError::Io(_) => "io",
            VaultError::Cli(_) => "cli",
            VaultError::Internal(_) => "internal",
        }
    }
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::NotSignedIn => {
                f.write_str("Not signed in to Azure. Run `az login` and retry.")
            }
            VaultError::Forbidden => f.write_str(
                "Access denied. Your account does not have permission to read secrets in this vault.",
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
            VaultError::Io(detail) => write!(f, "File system error: {detail}"),
            VaultError::Cli(detail) => write!(f, "Azure CLI error: {detail}"),
            VaultError::Internal(detail) => write!(f, "Internal error: {detail}"),
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
        let mut state = serializer.serialize_struct("VaultError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
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
