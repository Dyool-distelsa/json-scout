//! Azure CLI adapter for the read-only [`SecretProvider`] port.
//!
//! The adapter never builds a shell string: it hands a program name and an
//! argument array to an injected [`CommandRunner`]. Secret operations are
//! read-only (secret list, secret show); the only other calls are the account
//! lookup and the interactive `az login`. Every vault and secret name is
//! validated before it can reach an argument.
//!
//! Error values are built from fixed text or a short first line of stderr;
//! stdout (which carries secret values) is never copied into an error.

use super::domain::{
    validate_name, Identity, SecretProvider, SecretRef, SecretSummary, SecretValue, VaultError,
};
use serde_json::Value;
use std::io::{self, Read};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Longest stderr excerpt kept in a [`VaultError::Cli`] message.
const MAX_SUMMARY_CHARS: usize = 300;

/// Upper bound on one `az` invocation.
pub const AZ_TIMEOUT: Duration = Duration::from_secs(60);

/// Upper bound on `az login`, which waits for the user in a browser window.
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// How often a running child is checked against its deadline.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

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
    /// Raw bytes: decoded strictly by the caller, because stdout carries
    /// secret values and must never be lossily rewritten.
    pub stdout: Vec<u8>,
    /// Lossily decoded: stderr never carries secret values and is only
    /// summarised.
    pub stderr: String,
}

/// Runs a program with an argument array. `Err` means the process could not
/// be spawned at all; a non-zero exit is reported through `status_ok`.
pub trait CommandRunner: Send + Sync {
    /// Run with the runner's own default timeout.
    fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput>;

    /// Run with an explicit timeout, for the one call (an interactive
    /// sign-in) that legitimately outlasts the default.
    fn run_with_timeout(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> io::Result<CmdOutput>;
}

/// Spawns real processes with `std::process::Command` (argument array, no
/// shell, no console window on Windows, stdin closed).
pub struct SystemRunner {
    timeout: Duration,
}

impl SystemRunner {
    pub fn new(timeout: Duration) -> Self {
        SystemRunner { timeout }
    }
}

impl Default for SystemRunner {
    fn default() -> Self {
        SystemRunner::new(AZ_TIMEOUT)
    }
}

impl CommandRunner for SystemRunner {
    fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput> {
        self.run_with_timeout(program, args, self.timeout)
    }

    /// Runs `program`, draining both pipes on reader threads so a large
    /// output cannot fill a pipe buffer and stall the child. If the child is
    /// still running when the timeout expires it is killed and reaped, and
    /// the call fails with [`io::ErrorKind::TimedOut`].
    fn run_with_timeout(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> io::Result<CmdOutput> {
        let mut command = std::process::Command::new(program);
        command
            .args(args)
            // The Azure CLI is a Python program: without this it encodes
            // output with the console code page on Windows.
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let deadline = Instant::now() + timeout;
        let mut child = command.spawn()?;
        let (Some(stdout_pipe), Some(stderr_pipe)) = (child.stdout.take(), child.stderr.take())
        else {
            kill_and_reap(&mut child);
            return Err(io::Error::other("the child output pipes were not captured"));
        };
        let stdout = drain(stdout_pipe);
        let stderr = drain(stderr_pipe);

        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() >= deadline => {
                    kill_and_reap(&mut child);
                    return Err(timed_out());
                }
                Ok(None) => std::thread::sleep(POLL_INTERVAL),
                Err(err) => {
                    kill_and_reap(&mut child);
                    return Err(err);
                }
            }
        };

        // The child has exited, so its pipes close once any descendant that
        // inherited them is gone. Wait for that only until the deadline.
        let stdout = collect(&stdout, deadline)?;
        let stderr = collect(&stderr, deadline)?;
        Ok(CmdOutput {
            status_ok: status.success(),
            stdout,
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    }
}

type Drained = mpsc::Receiver<io::Result<Vec<u8>>>;

/// Read `pipe` to the end on a background thread.
fn drain<R: Read + Send + 'static>(mut pipe: R) -> Drained {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.read_to_end(&mut bytes).map(|_| bytes);
        // The receiver is gone after a timeout; there is nobody to tell.
        let _ = sender.send(result);
    });
    receiver
}

/// Wait for a drained pipe, giving up at `deadline`.
fn collect(drained: &Drained, deadline: Instant) -> io::Result<Vec<u8>> {
    match drained.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(timed_out()),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(io::Error::other("the output reader stopped unexpectedly"))
        }
    }
}

fn timed_out() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "the command did not finish in time")
}

/// Kill `child` and everything it started, then reap it. Best effort: the
/// reader threads are deliberately not joined, because a descendant that
/// survives could keep a pipe open and block the join.
fn kill_and_reap(child: &mut std::process::Child) {
    // `az.cmd` runs the real CLI as a grandchild, and killing only the shim
    // would leave it running, so on Windows the whole tree goes.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub struct AzCliProvider<R: CommandRunner> {
    runner: R,
}

impl<R: CommandRunner> AzCliProvider<R> {
    pub fn new(runner: R) -> Self {
        AzCliProvider { runner }
    }

    /// Run `az` and return its output of a successful exit; a spawn failure
    /// or a non-zero exit is mapped to a [`VaultError`]. `timeout` overrides
    /// the runner's default when given.
    fn execute(&self, args: &[String], timeout: Option<Duration>) -> Result<CmdOutput, VaultError> {
        let result = match timeout {
            Some(timeout) => self.runner.run_with_timeout(az_program(), args, timeout),
            None => self.runner.run(az_program(), args),
        };
        let output = match result {
            Ok(output) => output,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Err(VaultError::AzMissing),
            Err(err) if err.kind() == io::ErrorKind::TimedOut => return Err(VaultError::Timeout),
            Err(err) => return Err(VaultError::Io(err.to_string())),
        };
        if !output.status_ok {
            return Err(map_failure(&output.stderr));
        }
        Ok(output)
    }

    /// Run `az` with `args` and parse its stdout as JSON.
    fn run_json(&self, args: Vec<String>) -> Result<Value, VaultError> {
        let output = self.execute(&args, None)?;
        // The serde_json error text can quote the offending input, which may
        // hold a secret value, so it is deliberately dropped.
        // Strict decoding: a lossy one would silently rewrite secret bytes.
        let stdout = std::str::from_utf8(&output.stdout).map_err(|_| VaultError::Parse)?;
        serde_json::from_str(stdout).map_err(|_| VaultError::Parse)
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

    fn login(&self) -> Result<Identity, VaultError> {
        // `-o none` keeps stdout empty; whatever it prints (an account
        // listing) is dropped unread. The CLI stores the session itself, and
        // this app never sees a token.
        self.execute(&to_args(&["login", "-o", "none"]), Some(LOGIN_TIMEOUT))?;
        self.whoami()
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
        let version = version_from_id(id)?;
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

/// Version segment of a Key Vault secret id shaped like
/// `https://<vault>.vault.azure.net/secrets/<name>/<version>`. An id that
/// stops at the name has no version, and the name must not be mistaken for it.
fn version_from_id(id: &str) -> Result<&str, VaultError> {
    let mut segments = id.trim_end_matches('/').rsplit('/');
    match (segments.next(), segments.next(), segments.next()) {
        (Some(version), Some(name), Some("secrets"))
            if !version.is_empty() && !name.is_empty() =>
        {
            Ok(version)
        }
        _ => Err(VaultError::Parse),
    }
}

fn to_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

/// Trimmed stderr lines that start with `ERROR:`, exactly as `az` emits them.
fn error_lines(stderr: &str) -> Vec<&str> {
    stderr
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("ERROR:"))
        .collect()
}

/// Classify a failed invocation from its stderr text. Only the `ERROR:` lines
/// are considered when there are any, so a leading `WARNING:` line (for
/// example an upgrade hint saying "please run ...") cannot misclassify it.
fn map_failure(stderr: &str) -> VaultError {
    let errors = error_lines(stderr);
    let relevant = if errors.is_empty() {
        stderr.to_lowercase()
    } else {
        errors.join("
").to_lowercase()
    };
    let mentions = |needles: &[&str]| needles.iter().any(|needle| relevant.contains(needle));

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

/// The first `ERROR:` line without its prefix, or the first non-empty line
/// when there is none, bounded in length.
fn summarise(stderr: &str) -> String {
    let first_line = error_lines(stderr).into_iter().next().or_else(|| {
        stderr
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
    });
    let first_line = first_line.unwrap_or("");
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
        /// Timeout passed with each call: `None` for a plain `run`.
        timeouts: Mutex<Vec<Option<Duration>>>,
        replies: Mutex<VecDeque<io::Result<CmdOutput>>>,
    }

    impl FakeRunner {
        fn new(replies: Vec<io::Result<CmdOutput>>) -> Self {
            FakeRunner {
                calls: Mutex::new(Vec::new()),
                timeouts: Mutex::new(Vec::new()),
                replies: Mutex::new(replies.into()),
            }
        }

        fn record(
            &self,
            program: &str,
            args: &[String],
            timeout: Option<Duration>,
        ) -> io::Result<CmdOutput> {
            self.calls
                .lock()
                .unwrap()
                .push((program.to_string(), args.to_vec()));
            self.timeouts.lock().unwrap().push(timeout);
            self.replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err(io::Error::other("no reply scripted")))
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }

        fn timeouts(&self) -> Vec<Option<Duration>> {
            self.timeouts.lock().unwrap().clone()
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[String]) -> io::Result<CmdOutput> {
            self.record(program, args, None)
        }

        fn run_with_timeout(
            &self,
            program: &str,
            args: &[String],
            timeout: Duration,
        ) -> io::Result<CmdOutput> {
            self.record(program, args, Some(timeout))
        }
    }

    fn ok(stdout: &str) -> io::Result<CmdOutput> {
        Ok(CmdOutput {
            status_ok: true,
            stdout: stdout.as_bytes().to_vec(),
            stderr: String::new(),
        })
    }

    fn fail(stderr: &str) -> io::Result<CmdOutput> {
        Ok(CmdOutput {
            status_ok: false,
            stdout: Vec::new(),
            stderr: stderr.to_string(),
        })
    }

    fn provider(replies: Vec<io::Result<CmdOutput>>) -> AzCliProvider<FakeRunner> {
        AzCliProvider::new(FakeRunner::new(replies))
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// A built-in command that prints one environment variable.
    #[cfg(windows)]
    fn echo_env_command(variable: &str) -> (&'static str, Vec<String>) {
        ("cmd", strings(&["/C", "echo", &format!("%{variable}%")]))
    }

    #[cfg(unix)]
    fn echo_env_command(variable: &str) -> (&'static str, Vec<String>) {
        ("sh", strings(&["-c", &format!("printf '%s' \"${variable}\"")]))
    }

    /// A built-in command that outlives any short timeout.
    #[cfg(windows)]
    fn sleep_command() -> (&'static str, Vec<String>) {
        ("ping", strings(&["-n", "8", "127.0.0.1"]))
    }

    #[cfg(unix)]
    fn sleep_command() -> (&'static str, Vec<String>) {
        ("sleep", strings(&["8"]))
    }

    #[cfg(windows)]
    fn echo_command(text: &str) -> (&'static str, Vec<String>) {
        ("cmd", strings(&["/C", "echo", text]))
    }

    #[cfg(unix)]
    fn echo_command(text: &str) -> (&'static str, Vec<String>) {
        ("echo", strings(&[text]))
    }

    #[cfg(windows)]
    fn print_file_command(path: &std::path::Path) -> (&'static str, Vec<String>) {
        ("cmd", strings(&["/C", "type", &path.to_string_lossy()]))
    }

    #[cfg(unix)]
    fn print_file_command(path: &std::path::Path) -> (&'static str, Vec<String>) {
        ("cat", strings(&[&path.to_string_lossy()]))
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

    // --- login ---

    const ACCOUNT_JSON: &str =
        r#"{"id":"sub-id","name":"Dev Subscription","user":{"name":"ana@example.com"}}"#;

    #[test]
    fn login_runs_az_login_quietly_with_the_long_timeout_then_reads_the_account() {
        let p = provider(vec![ok(""), ok(ACCOUNT_JSON)]);

        let identity = p.login().expect("login");

        assert_eq!(identity.user, "ana@example.com");
        assert_eq!(identity.subscription, "Dev Subscription");
        assert_eq!(
            p.runner.calls(),
            vec![
                (az_program().to_string(), strings(&["login", "-o", "none"])),
                (
                    az_program().to_string(),
                    strings(&["account", "show", "-o", "json"])
                ),
            ]
        );
        // Only the interactive sign-in gets the long timeout.
        assert_eq!(p.runner.timeouts(), vec![Some(LOGIN_TIMEOUT), None]);
    }

    #[test]
    fn the_login_timeout_is_five_minutes_and_longer_than_the_default() {
        assert_eq!(LOGIN_TIMEOUT, Duration::from_secs(300));
        assert!(LOGIN_TIMEOUT > AZ_TIMEOUT);
    }

    #[test]
    fn whoami_list_and_get_never_use_the_long_timeout() {
        let p = provider(vec![ok(ACCOUNT_JSON), ok("[]"), ok(SHOW_OUTPUT)]);
        p.whoami().unwrap();
        p.list("kv").unwrap();
        p.get(&secret_ref("kv", "app-config")).unwrap();
        assert_eq!(p.runner.timeouts(), vec![None, None, None]);
    }

    #[test]
    fn login_discards_what_az_login_prints_on_stdout() {
        let noisy = r#"[{"user":{"name":"leaky-account-listing"}}]"#;
        let p = provider(vec![ok(noisy), ok(ACCOUNT_JSON)]);
        let identity = p.login().expect("login");
        assert!(!format!("{identity:?}").contains("leaky"));

        // A failed login must not copy stdout into the error either.
        let failed = Ok(CmdOutput {
            status_ok: false,
            stdout: b"leaky-account-listing".to_vec(),
            stderr: "ERROR: user cancelled".into(),
        });
        let err = provider(vec![failed]).login().unwrap_err();
        assert_eq!(err, VaultError::Cli("user cancelled".into()));
        assert!(!err.to_string().contains("leaky"));
    }

    #[test]
    fn login_failures_map_like_every_other_call_and_skip_the_account_lookup() {
        let timed_out = Err(io::Error::new(io::ErrorKind::TimedOut, "deadline exceeded"));
        let p = provider(vec![timed_out]);
        assert_eq!(p.login(), Err(VaultError::Timeout));
        assert_eq!(p.runner.calls().len(), 1);

        let missing = Err(io::Error::new(io::ErrorKind::NotFound, "program not found"));
        assert_eq!(provider(vec![missing]).login(), Err(VaultError::AzMissing));

        let denied = Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
        assert!(matches!(provider(vec![denied]).login(), Err(VaultError::Io(_))));

        let p = provider(vec![fail("ERROR: AADSTS50126: Invalid username or password.")]);
        assert_eq!(p.login(), Err(VaultError::NotSignedIn));
    }

    #[test]
    fn login_reports_the_error_of_the_account_lookup_that_follows() {
        let p = provider(vec![ok(""), fail("ERROR: Please run 'az login' to setup account.")]);
        assert_eq!(p.login(), Err(VaultError::NotSignedIn));
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
    fn get_accepts_a_versioned_key_vault_id() {
        let p = provider(vec![ok(
            r#"{"id":"https://kv-demo.vault.azure.net/secrets/app-config/0123abcd","value":"x"}"#,
        )]);
        assert_eq!(p.get(&secret_ref("kv-demo", "app-config")).unwrap().version, "0123abcd");
    }

    #[test]
    fn get_rejects_an_id_without_a_version_segment() {
        // Without the check the secret name would be mistaken for the version.
        for id in [
            "https://kv-demo.vault.azure.net/secrets/app-config",
            "https://kv-demo.vault.azure.net/secrets/app-config/",
            "https://kv-demo.vault.azure.net/secrets/secrets",
            "https://kv-demo.vault.azure.net/keys/app-config/0123abcd",
            "app-config",
        ] {
            let body = format!(r#"{{"id":"{id}","value":"x"}}"#);
            assert_eq!(
                provider(vec![ok(&body)]).get(&secret_ref("kv-demo", "app-config")),
                Err(VaultError::Parse),
                "{id}"
            );
        }
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

    // --- output encoding ---

    #[test]
    fn stdout_that_is_not_valid_utf8_maps_to_parse_instead_of_being_lossily_replaced() {
        // A lossy decode would turn the invalid byte into U+FFFD and return a
        // silently corrupted secret value.
        let mut stdout = br#"{"id":"https://kv.vault.azure.net/secrets/n/v1","value":"pa"#.to_vec();
        stdout.push(0xFF);
        stdout.extend_from_slice(br#"ss"}"#);
        let p = provider(vec![Ok(CmdOutput {
            status_ok: true,
            stdout,
            stderr: String::new(),
        })]);

        assert_eq!(p.get(&secret_ref("kv", "n")), Err(VaultError::Parse));
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn the_system_runner_forces_utf8_output_for_the_child_process() {
        let (program, args) = echo_env_command("PYTHONIOENCODING");

        let output = SystemRunner::default().run(program, &args).expect("run");

        assert!(output.status_ok);
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "utf-8");
    }

    // --- timeout ---

    #[test]
    fn a_command_that_timed_out_maps_to_the_timeout_error() {
        let timed_out = || Err(io::Error::new(io::ErrorKind::TimedOut, "deadline exceeded"));
        assert_eq!(provider(vec![timed_out()]).whoami(), Err(VaultError::Timeout));
        assert_eq!(provider(vec![timed_out()]).list("kv"), Err(VaultError::Timeout));
        assert_eq!(
            provider(vec![timed_out()]).get(&secret_ref("kv", "n")),
            Err(VaultError::Timeout)
        );
    }

    #[test]
    fn the_default_system_runner_bounds_every_invocation_to_sixty_seconds() {
        assert_eq!(AZ_TIMEOUT, Duration::from_secs(60));
        assert_eq!(SystemRunner::default().timeout, AZ_TIMEOUT);
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn the_system_runner_kills_a_command_that_outlives_its_timeout() {
        let runner = SystemRunner::new(Duration::from_millis(300));
        let (program, args) = sleep_command();
        let started = std::time::Instant::now();

        let result = runner.run(program, &args);

        let err = result.expect_err("the command should have been cut off");
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "returned after {:?}",
            started.elapsed()
        );
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn the_system_runner_returns_the_output_of_a_command_that_finishes_in_time() {
        let runner = SystemRunner::new(Duration::from_secs(30));
        let (program, args) = echo_command("hello");

        let output = runner.run(program, &args).expect("run");

        assert!(output.status_ok);
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn the_system_runner_drains_output_larger_than_a_pipe_buffer() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("big.txt");
        let payload = "0123456789abcdef".repeat(32 * 1024);
        std::fs::write(&path, &payload).expect("write fixture");
        let runner = SystemRunner::new(Duration::from_secs(30));
        let (program, args) = print_file_command(&path);

        let output = runner.run(program, &args).expect("run");

        assert!(output.status_ok);
        assert_eq!(output.stdout.len(), payload.len());
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
    fn a_leading_warning_line_does_not_replace_the_error_line_in_the_cli_summary() {
        let p = provider(vec![fail(
            "WARNING: a minor notice
ERROR: the real failure
ERROR: a later failure
",
        )]);
        match p.list("kv") {
            Err(VaultError::Cli(summary)) => assert_eq!(summary, "the real failure"),
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn without_any_error_line_the_summary_falls_back_to_the_first_non_empty_line() {
        let p = provider(vec![fail("
  WARNING: only a warning here
second line
")]);
        match p.list("kv") {
            Err(VaultError::Cli(summary)) => assert_eq!(summary, "WARNING: only a warning here"),
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn a_warning_that_mentions_a_sign_in_hint_does_not_misclassify_a_failure() {
        let p = provider(vec![fail(
            "WARNING: Please run 'az upgrade' to update the CLI.
ERROR: something unexpected happened
",
        )]);
        match p.list("kv") {
            Err(VaultError::Cli(summary)) => assert_eq!(summary, "something unexpected happened"),
            other => panic!("expected a Cli error, got {other:?}"),
        }
    }

    #[test]
    fn an_error_line_after_a_warning_is_still_classified_by_its_own_text() {
        let p = provider(vec![fail(
            "WARNING: noise
ERROR: (Forbidden) The user does not have secrets get permission.
",
        )]);
        assert_eq!(p.list("kv"), Err(VaultError::Forbidden));
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
