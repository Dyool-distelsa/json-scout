//! The push confirmation gate.
//!
//! `vault_push_preview` remembers, per `{vault, name}`, the hash of the exact
//! bytes it showed the user, the base version they were diffed against and
//! when the preview stops being valid. `vault_push` refuses unless the same
//! hash is presented before the preview expires. The UI therefore cannot skip
//! the confirmation step, and cannot push bytes other than the ones that were
//! previewed.
//!
//! The gate lives in Tauri managed state and is shared by every command call,
//! so it is a cheap, cloneable handle. The clock is injected so expiry can be
//! tested without sleeping.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// How long a preview stays valid.
pub const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);

/// SHA-256 of `text`'s bytes as lowercase hex.
pub fn content_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

type Key = (String, String);

struct Entry {
    content_hash: String,
    base_version: String,
    expires_at: Instant,
}

/// What a still-valid preview recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Previewed {
    pub base_version: String,
}

struct Inner {
    entries: Mutex<HashMap<Key, Entry>>,
    ttl: Duration,
    clock: Box<dyn Fn() -> Instant + Send + Sync>,
}

/// Shared record of which previews exist. Cloning shares the same state.
#[derive(Clone)]
pub struct PreviewGate {
    inner: Arc<Inner>,
}

impl Default for PreviewGate {
    fn default() -> Self {
        PreviewGate::with_clock(PREVIEW_TTL, Instant::now)
    }
}

impl PreviewGate {
    /// A gate with its own time source, for tests.
    pub fn with_clock(
        ttl: Duration,
        clock: impl Fn() -> Instant + Send + Sync + 'static,
    ) -> Self {
        PreviewGate {
            inner: Arc::new(Inner {
                entries: Mutex::new(HashMap::new()),
                ttl,
                clock: Box::new(clock),
            }),
        }
    }

    fn entries(&self) -> MutexGuard<'_, HashMap<Key, Entry>> {
        // A panic while the lock was held cannot leave the map half-updated
        // (every update is one insert or remove), so a poisoned lock is
        // still usable.
        self.inner
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Record a preview, replacing any earlier one for the same secret and
    /// dropping every preview that has already expired.
    pub fn remember(&self, vault: &str, name: &str, content_hash: &str, base_version: &str) {
        let now = (self.inner.clock)();
        let mut entries = self.entries();
        entries.retain(|_, entry| entry.expires_at > now);
        entries.insert(
            (vault.to_string(), name.to_string()),
            Entry {
                content_hash: content_hash.to_string(),
                base_version: base_version.to_string(),
                expires_at: now + self.inner.ttl,
            },
        );
    }

    /// The preview recorded for this secret, if it is unexpired and was made
    /// for exactly `content_hash`.
    pub fn check(&self, vault: &str, name: &str, content_hash: &str) -> Option<Previewed> {
        let now = (self.inner.clock)();
        let entries = self.entries();
        let entry = entries.get(&(vault.to_string(), name.to_string()))?;
        (entry.expires_at > now && entry.content_hash == content_hash).then(|| Previewed {
            base_version: entry.base_version.clone(),
        })
    }

    /// Forget the preview of this secret (after a successful push).
    pub fn consume(&self, vault: &str, name: &str) {
        self.entries()
            .remove(&(vault.to_string(), name.to_string()));
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A gate on a clock the test moves by hand.
    fn gate() -> (PreviewGate, Arc<Mutex<Instant>>) {
        let now = Arc::new(Mutex::new(Instant::now()));
        let source = Arc::clone(&now);
        let gate = PreviewGate::with_clock(PREVIEW_TTL, move || *source.lock().unwrap());
        (gate, now)
    }

    fn advance(now: &Arc<Mutex<Instant>>, by: Duration) {
        let mut instant = now.lock().unwrap();
        *instant += by;
    }

    #[test]
    fn content_hash_is_lowercase_hex_sha256() {
        assert_eq!(
            content_hash(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            content_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(content_hash("{\"a\":1}"), content_hash("{\"a\":2}"));
        assert_eq!(content_hash("ñandú").len(), 64);
    }

    #[test]
    fn the_preview_ttl_is_five_minutes() {
        assert_eq!(PREVIEW_TTL, Duration::from_secs(300));
    }

    #[test]
    fn a_remembered_preview_matches_the_same_secret_and_hash_and_returns_its_base_version() {
        let (gate, _now) = gate();
        gate.remember("kv", "cfg", "hash-1", "v7");

        assert_eq!(
            gate.check("kv", "cfg", "hash-1"),
            Some(Previewed {
                base_version: "v7".into()
            })
        );
    }

    #[test]
    fn a_different_hash_vault_or_name_does_not_match() {
        let (gate, _now) = gate();
        gate.remember("kv", "cfg", "hash-1", "v7");

        assert_eq!(gate.check("kv", "cfg", "hash-2"), None);
        assert_eq!(gate.check("kv", "cfg", ""), None);
        assert_eq!(gate.check("other", "cfg", "hash-1"), None);
        assert_eq!(gate.check("kv", "other", "hash-1"), None);
    }

    #[test]
    fn a_secret_that_was_never_previewed_does_not_match() {
        let (gate, _now) = gate();
        assert_eq!(gate.check("kv", "cfg", "hash-1"), None);
    }

    #[test]
    fn a_preview_expires_exactly_at_the_ttl() {
        let (gate, now) = gate();
        gate.remember("kv", "cfg", "hash-1", "v1");

        advance(&now, PREVIEW_TTL - Duration::from_secs(1));
        assert!(gate.check("kv", "cfg", "hash-1").is_some());

        advance(&now, Duration::from_secs(1));
        assert_eq!(gate.check("kv", "cfg", "hash-1"), None);
    }

    #[test]
    fn a_newer_preview_of_the_same_secret_replaces_the_older_one_and_restarts_the_clock() {
        let (gate, now) = gate();
        gate.remember("kv", "cfg", "old", "v1");
        advance(&now, Duration::from_secs(200));
        gate.remember("kv", "cfg", "new", "v2");

        assert_eq!(gate.check("kv", "cfg", "old"), None);
        advance(&now, Duration::from_secs(200));
        assert_eq!(
            gate.check("kv", "cfg", "new"),
            Some(Previewed {
                base_version: "v2".into()
            })
        );
    }

    #[test]
    fn previews_of_different_secrets_are_independent() {
        let (gate, _now) = gate();
        gate.remember("kv", "a", "ha", "v1");
        gate.remember("kv", "b", "hb", "v2");
        gate.consume("kv", "a");

        assert_eq!(gate.check("kv", "a", "ha"), None);
        assert!(gate.check("kv", "b", "hb").is_some());
    }

    #[test]
    fn consume_forgets_the_preview() {
        let (gate, _now) = gate();
        gate.remember("kv", "cfg", "hash-1", "v1");
        gate.consume("kv", "cfg");
        assert_eq!(gate.check("kv", "cfg", "hash-1"), None);
        assert_eq!(gate.len(), 0);
        gate.consume("kv", "cfg"); // forgetting twice is harmless
    }

    #[test]
    fn remembering_drops_the_previews_that_have_already_expired() {
        let (gate, now) = gate();
        gate.remember("kv", "a", "ha", "v1");
        gate.remember("kv", "b", "hb", "v1");
        advance(&now, PREVIEW_TTL);
        gate.remember("kv", "c", "hc", "v1");

        assert_eq!(gate.len(), 1, "only the fresh preview is kept");
        assert!(gate.check("kv", "c", "hc").is_some());
    }

    #[test]
    fn clones_share_the_same_previews() {
        let (gate, _now) = gate();
        let other = gate.clone();
        gate.remember("kv", "cfg", "hash-1", "v1");
        assert!(other.check("kv", "cfg", "hash-1").is_some());
        other.consume("kv", "cfg");
        assert_eq!(gate.check("kv", "cfg", "hash-1"), None);
    }

    #[test]
    fn the_default_gate_uses_the_real_clock_and_the_five_minute_ttl() {
        let gate = PreviewGate::default();
        gate.remember("kv", "cfg", "hash-1", "v1");
        assert!(gate.check("kv", "cfg", "hash-1").is_some());
    }

    #[test]
    fn a_poisoned_lock_does_not_disable_the_gate() {
        let (gate, _now) = gate();
        let poisoner = gate.clone();
        let _ = std::thread::spawn(move || {
            let _held = poisoner.entries();
            panic!("poison the lock");
        })
        .join();

        gate.remember("kv", "cfg", "hash-1", "v1");
        assert!(gate.check("kv", "cfg", "hash-1").is_some());
    }
}
