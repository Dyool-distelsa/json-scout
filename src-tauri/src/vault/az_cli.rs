//! Azure CLI adapter for the read-only [`SecretProvider`] port.
//!
//! The adapter never builds a shell string: it hands a program name and an
//! argument array to an injected [`CommandRunner`]. Only read operations
//! exist here (account show, secret list, secret show), and every vault and
//! secret name is validated before it can reach an argument.
//!
//! Error values are built from fixed text or a short first line of stderr;
//! stdout (which carries secret values) is never copied into an error.

use super::domain::{
    validate_name, Identity, SecretProvider, SecretRef, SecretSummary, SecretValue, VaultError,
};
use serde_json::Value;
use std::io;

/// Longest stderr excerpt kept in a [`VaultError::Cli`] message.
const MAX_SUMMARY_CHARS: usize = 300;

/// Program to spawn: Windows ships the Azure CLI as a `.cmd` shim.
pub fn az_program() -> &'static str {
    if cfg!(windows) {
        "az.cmd"
    } else {
        "az"
    }
}

/// Result of one finished command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CmdOutput {
    pub status_ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a program with an argument array. `Err` means the process could not
/// be spawned at all; a non-zero exit is reported through `status_ok`.
pub trait CommandRunner: Send + Sync {
    fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput>;
}

/// Spawns real processes with `std::process::Command` (argument array, no
/// shell, no console window on Windows, stdin closed).
pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput> {
        let mut command = std::process::Command::new(program);
        command
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let output = command.output()?;
        Ok(CmdOutput {
            status_ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

pub struct AzCliProvider<R: CommandRunner> {
    runner: R,
}

impl<R: CommandRunner> AzCliProvider<R> {
    pub fn new(runner: R) -> Self {
        AzCliProvider { runner }
    }

    /// Run `az` with `args` and parse its stdout as JSON.
    fn run_json(&self, args: Vec<String>) -> Result<Value, VaultError> {
        let output = match self.runner.run(az_program(), &args) {
            Ok(output) => output,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Err(VaultError::AzMissing),
            Err(err) => return Err(VaultError::Io(err.to_string())),
        };
        if !output.status_ok {
            return Err(map_failure(&output.stderr));
        }
        // The serde_json error text can quote the offending input, which may
        // hold a secret value, so it is deliberately dropped.
        serde_json::from_str(&output.stdout).map_err(|_| VaultError::Parse)
    }
}

impl<R: CommandRunner> SecretProvider for AzCliProvider<R> {
    fn whoami(&self) -> Result<Identity, VaultError> {
        let account = self.run_json(to_args(&["account", "show", "-o", "json"]))?;
        let user = account["user"]["name"].as_str().ok_or(VaultError::Parse)?;
        let subscription = account["name"]
            .as_str()
            .or_else(|| account["id"].as_str())
            .ok_or(VaultError::Parse)?;
        Ok(Identity {
            user: user.to_string(),
            subscription: subscription.to_string(),
        })
    }

    fn list(&self, vault: &str) -> Result<Vec<SecretSummary>, VaultError> {
        validate_name(vault)?;
        let listing = self.run_json(to_args(&[
            "keyvault",
            "secret",
            "list",
            "--vault-name",
            vault,
            "--query",
            "[].{name:name,enabled:attributes.enabled}",
            "-o",
            "json",
        ]))?;
        listing
            .as_array()
            .ok_or(VaultError::Parse)?
            .iter()
            .map(|item| {
                Ok(SecretSummary {
                    name: item["name"].as_str().ok_or(VaultError::Parse)?.to_string(),
                    enabled: item["enabled"].as_bool().unwrap_or(true),
                })
            })
            .collect()
    }

    fn get(&self, secret: &SecretRef) -> Result<SecretValue, VaultError> {
        validate_name(&secret.vault)?;
        validate_name(&secret.name)?;
        let shown = self.run_json(to_args(&[
            "keyvault",
            "secret",
            "show",
            "--vault-name",
            &secret.vault,
            "--name",
            &secret.name,
            "-o",
            "json",
        ]))?;
        let value = shown["value"].as_str().ok_or(VaultError::Parse)?;
        let id = shown["id"].as_str().ok_or(VaultError::Parse)?;
        let version = id
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|segment| !segment.is_empty())
            .ok_or(VaultError::Parse)?;
        let updated = match &shown["attributes"]["updated"] {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        };
        Ok(SecretValue {
            value: value.to_string(),
            version: version.to_string(),
            updated,
        })
    }
}

fn to_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

/// Classify a failed invocation from its stderr text.
fn map_failure(stderr: &str) -> VaultError {
    let lower = stderr.to_lowercase();
    let mentions = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));

    if mentions(&["az login", "please run", "aadsts", "no subscription"]) {
        VaultError::NotSignedIn
    } else if mentions(&["forbidden", "does not have secrets", "not authorized"]) {
        VaultError::Forbidden
    } else if mentions(&["secretnotfound", "vaultnotfound", "was not found"]) {
        VaultError::NotFound
    } else {
        VaultError::Cli(summarise(stderr))
    }
}

/// First non-empty stderr line without the `ERROR:` prefix, bounded in length.
fn summarise(stderr: &str) -> String {
    let first_line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let message = first_line
        .strip_prefix("ERROR:")
        .map(str::trim)
        .unwrap_or(first_line);
    if message.is_empty() {
        return "the command failed without any error output".to_string();
    }
    message.chars().take(MAX_SUMMARY_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    type Call = (String, Vec<String>);

    struct FakeRunner {
        calls: Mutex<Vec<Call>>,
        replies: Mutex<VecDeque<io::Result<CmdOutput>>>,
    }

    impl FakeRunner {
        fn new(replies: Vec<io::Result<CmdOutput>>) -> Self {
            FakeRunner {
                calls: Mutex::new(Vec::new()),
                replies: Mutex::new(replies.into()),
            }
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput> {
            self.calls
                .lock()
                .unwrap()
                .push((program.to_string(), args.to_vec()));
            self.replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err(io::Error::other("no reply scripted")))
        }
    }

    fn ok(stdout: &str) -> io::Result<CmdOutput> {
        Ok(CmdOutput {
            status_ok: true,
            stdout: stdout.to_string(),
            stderr: String::new(),
        })
    }

    fn fail(stderr: &str) -> io::Result<CmdOutput> {
        Ok(CmdOutput {
            status_ok: false,
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    fn provider(replies: Vec<io::Result<CmdOutput>>) -> AzCliProvider<FakeRunner> {
        AzCliProvider::new(FakeRunner::new(replies))
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn secret_ref(vault: &str, name: &str) -> SecretRef {
        SecretRef {
            vault: vault.to_string(),
            name: name.to_string(),
        }
    }

    const SHOW_OUTPUT: &str = r#"{
        "attributes": { "enabled": true, "updated": "2025-03-01T10:00:00+00:00" },
        "id": "https://kv-demo.vault.azure.net/secrets/app-config/0123456789abcdef",
        "name": "app-config",
        "value": "{\"b\":1}"
    }"#;

    // --- program name ---

    #[test]
    fn az_program_is_the_cmd_shim_on_windows_and_plain_az_elsewhere() {
        if cfg!(windows) {
            assert_eq!(az_program(), "az.cmd");
        } else {
            assert_eq!(az_program(), "az");
        }
    }

    // --- whoami ---

    #[test]
    fn whoami_runs_account_show_and_reads_the_user_and_subscription_name() {
        let p = provider(vec![ok(
            r#"{"id":"sub-id","name":"Dev Subscription","user":{"name":"ana@example.com","type":"user"}}"#,
        )]);

        let identity = p.whoami().expect("identity");

        assert_eq!(identity.user, "ana@example.com");
        assert_eq!(identity.subscription, "Dev Subscription");
        assert_eq!(
            p.runner.calls(),
            vec![(
                az_program().to_string(),
                strings(&["account", "show", "-o", "json"])
            )]
        );
    }

    #[test]
    fn whoami_falls_back_to_the_subscription_id_when_there_is_no_name() {
        let p = provider(vec![ok(r#"{"id":"sub-id","user":{"name":"ana@example.com"}}"#)]);
        assert_eq!(p.whoami().unwrap().subscription, "sub-id");
    }

    #[test]
    fn whoami_reports_a_parse_error_when_the_user_is_missing() {
        let p = provider(vec![ok(r#"{"id":"sub-id","name":"Dev"}"#)]);
        assert_eq!(p.whoami(), Err(VaultError::Parse));
    }

    // --- list ---

    #[test]
    fn list_passes_the_query_as_one_argument_and_parses_the_summaries() {
        let p = provider(vec![ok(
            r#"[{"name":"alpha","enabled":true},{"name":"beta","enabled":false}]"#,
        )]);

        let secrets = p.list("kv-demo").expect("list");

        assert_eq!(
            secrets,
            vec![
                SecretSummary {
                    name: "alpha".into(),
                    enabled: true
                },
                SecretSummary {
                    name: "beta".into(),
                    enabled: false
                },
            ]
        );
        assert_eq!(
            p.runner.calls(),
            vec![(
                az_program().to_string(),
                strings(&[
                    "keyvault",
                    "secret",
                    "list",
                    "--vault-name",
                    "kv-demo",
                    "--query",
                    "[].{name:name,enabled:attributes.enabled}",
                    "-o",
                    "json",
                ])
            )]
        );
    }

    #[test]
    fn list_treats_a_missing_or_null_enabled_flag_as_enabled() {
        let p = provider(vec![ok(r#"[{"name":"a"},{"name":"b","enabled":null}]"#)]);
        let secrets = p.list("kv").unwrap();
        assert!(secrets.iter().all(|s| s.enabled));
    }

    #[test]
    fn list_returns_an_empty_vec_for_an_empty_vault() {
        let p = provider(vec![ok("[]")]);
        assert_eq!(p.list("kv"), Ok(Vec::new()));
    }

    #[test]
    fn list_reports_a_parse_error_for_non_array_or_invalid_output() {
        assert_eq!(provider(vec![ok(r#"{"name":"a"}"#)]).list("kv"), Err(VaultError::Parse));
        assert_eq!(provider(vec![ok("not json")]).list("kv"), Err(VaultError::Parse));
        assert_eq!(provider(vec![ok(r#"[{"enabled":true}]"#)]).list("kv"), Err(VaultError::Parse));
    }

    // --- get ---

    #[test]
    fn get_runs_secret_show_and_parses_value_version_and_updated() {
        let p = provider(vec![ok(SHOW_OUTPUT)]);

        let value = p.get(&secret_ref("kv-demo", "app-config")).expect("get");

        assert_eq!(value.value, "{\"b\":1}");
        assert_eq!(value.version, "0123456789abcdef");
        assert_eq!(value.updated.as_deref(), Some("2025-03-01T10:00:00+00:00"));
        assert_eq!(
            p.runner.calls(),
            vec![(
                az_program().to_string(),
                strings(&[
                    "keyvault",
                    "secret",
                    "show",
                    "--vault-name",
                    "kv-demo",
                    "--name",
                    "app-config",
                    "-o",
                    "json",
                ])
            )]
        );
    }

    #[test]
    fn get_leaves_updated_empty_when_the_attribute_is_absent() {
        let p = provider(vec![ok(r#"{"id":"https://kv.vault.azure.net/secrets/n/v1","value":"x"}"#)]);
        let value = p.get(&secret_ref("kv", "n")).unwrap();
        assert_eq!(value.version, "v1");
        assert_eq!(value.updated, None);
    }

    #[test]
    fn get_ignores_a_trailing_slash_when_extracting_the_version() {
        let p = provider(vec![ok(r#"{"id":"https://kv.vault.azure.net/secrets/n/v7/","value":"x"}"#)]);
        assert_eq!(p.get(&secret_ref("kv", "n")).unwrap().version, "v7");
    }

    #[test]
    fn get_reports_a_parse_error_when_value_or_id_is_missing() {
        let no_value = provider(vec![ok(r#"{"id":"https://kv/secrets/n/v1"}"#)]);
        assert_eq!(no_value.get(&secret_ref("kv", "n")), Err(VaultError::Parse));
        let no_id = provider(vec![ok(r#"{"value":"x"}"#)]);
        assert_eq!(no_id.get(&secret_ref("kv", "n")), Err(VaultError::Parse));
        let garbage = provider(vec![ok("<html>")]);
        assert_eq!(garbage.get(&secret_ref("kv", "n")), Err(VaultError::Parse));
    }

    #[test]
    fn parse_errors_never_echo_the_output_they_failed_on() {
        let leaky = r#"{"value": "hunter2-super-secret", "id": 42}"#;
        let err = provider(vec![ok(leaky)])
            .get(&secret_ref("kv", "n"))
            .unwrap_err();
        assert!(!err.to_string().contains("hunter2"));
    }

    // --- error mapping ---

    #[test]
    fn non_zero_exits_map_stderr_to_the_expected_error_kind() {
        let cases: Vec<(&str, VaultError)> = vec![
            ("ERROR: Please run 'az login' to setup account.", VaultError::NotSignedIn),
            ("AADSTS70043: The refresh token has expired.", VaultError::NotSignedIn),
            ("ERROR: No subscription found. Run 'az account set'.", VaultError::NotSignedIn),
            ("Interactive authentication is needed. Run az login.", VaultError::NotSignedIn),
            (
                "ERROR: (Forbidden) The user, group or application does not have secrets get permission on key vault 'kv'.",
                VaultError::Forbidden,
            ),
            ("ERROR: Caller is not authorized to perform action.", VaultError::Forbidden),
            (
                "ERROR: (SecretNotFound) A secret with (name/id) x was not found in this key vault.",
                VaultError::NotFound,
            ),
            ("ERROR: (VaultNotFound) The Vault 'kv' was not found.", VaultError::NotFound),
        ];
        for (stderr, expected) in cases {
            let p = provider(vec![fail(stderr)]);
            assert_eq!(
                p.get(&secret_ref("kv", "n")),
                Err(expected.clone()),
                "{stderr}"
            );
            let p = provider(vec![fail(stderr)]);
            assert_eq!(p.list("kv"), Err(expected.clone()), "{stderr}");
            let p = provider(vec![fail(stderr)]);
            assert_eq!(p.whoami(), Err(expected), "{stderr}");
        }
    }

    #[test]
    fn other_non_zero_exits_become_a_cli_error_with_the_first_stderr_line() {
        let p = provider(vec![fail(
            "\nERROR: something unexpected happened\nTraceback (most recent call last):\n  ...\n",
        )]);
        match p.list("kv") {
            Err(VaultError::Cli(summary)) => {
                assert_eq!(summary, "something unexpected happened");
            }
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn cli_error_summaries_are_truncated_on_a_character_boundary() {
        let long = format!("ERROR: {}", "é".repeat(MAX_SUMMARY_CHARS * 2));
        match provider(vec![fail(&long)]).list("kv") {
            Err(VaultError::Cli(summary)) => {
                assert_eq!(summary.chars().count(), MAX_SUMMARY_CHARS);
            }
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn a_failure_with_empty_stderr_still_yields_a_readable_cli_error() {
        match provider(vec![fail("  \n")]).list("kv") {
            Err(VaultError::Cli(summary)) => assert!(!summary.is_empty()),
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn a_missing_az_executable_maps_to_az_missing() {
        let p = provider(vec![Err(io::Error::new(io::ErrorKind::NotFound, "program not found"))]);
        assert_eq!(p.whoami(), Err(VaultError::AzMissing));
    }

    #[test]
    fn other_spawn_failures_map_to_an_io_error() {
        let p = provider(vec![Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))]);
        assert!(matches!(p.whoami(), Err(VaultError::Io(_))));
    }

    // --- validation and read-only guarantees ---

    #[test]
    fn invalid_names_never_reach_the_runner() {
        let p = provider(vec![]);
        for bad in ["", "a b", "a;b", "--query", "-o", "a/b", "a.b", "$(whoami)", "a\"b"] {
            assert_eq!(p.list(bad), Err(VaultError::InvalidName), "vault {bad:?}");
            assert_eq!(
                p.get(&secret_ref(bad, "ok-name")),
                Err(VaultError::InvalidName),
                "vault {bad:?}"
            );
            assert_eq!(
                p.get(&secret_ref("ok-vault", bad)),
                Err(VaultError::InvalidName),
                "secret {bad:?}"
            );
        }
        assert!(p.runner.calls().is_empty());
    }

    #[test]
    fn no_provider_method_ever_issues_a_write_invocation() {
        let p = provider(vec![
            ok(r#"{"id":"s","user":{"name":"u"}}"#),
            ok(r#"[{"name":"a","enabled":true}]"#),
            ok(SHOW_OUTPUT),
        ]);
        p.whoami().unwrap();
        p.list("kv").unwrap();
        p.get(&secret_ref("kv", "app-config")).unwrap();

        for (_, args) in p.runner.calls() {
            assert!(!args.iter().any(|a| a == "set"), "{args:?}");
            assert!(!args.iter().any(|a| a == "delete"), "{args:?}");
            assert!(!args.iter().any(|a| a == "--value"), "{args:?}");
        }
    }

    #[test]
    fn the_adapter_source_contains_no_write_subcommand() {
        let source = include_str!("az_cli.rs");
        let production = source
            .split_once("#[cfg(test)]")
            .map(|(head, _)| head)
            .expect("test module marker");
        assert!(!production.contains("\"set\""));
        assert!(!production.contains("\"delete\""));
        assert!(!production.contains("\"--value\""));
    }
}
