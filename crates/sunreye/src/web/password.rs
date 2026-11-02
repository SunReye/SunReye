//! bcrypt password hashing (ADR 0003): CPU-bound, so checks run capped on the blocking pool.

use std::sync::{Arc, OnceLock};

use tokio::sync::Semaphore;

/// One cost on every target (ADR 0003).
const COST: u32 = 12;

/// bcrypt reads no further; a longer password is refused, never truncated.
const MAX_PASSWORD_BYTES: usize = 72;

/// Checks running at once; each holds a blocking thread for about 0.3 s.
const CHECKS: usize = 1;

/// Why bcrypt cannot take `password` whole: it reads 72 bytes and stops at a NUL, so either would
/// let a shorter password match.
pub fn unhashable(password: &str) -> Option<&'static str> {
    if password.len() > MAX_PASSWORD_BYTES {
        return Some("Password must be at most 72 bytes");
    }
    password.contains('\0').then_some("Password must not contain a NUL character")
}

fn hash_with(password: &str) -> Option<String> {
    if unhashable(password).is_some() {
        return None;
    }
    bcrypt::hash(password, COST).inspect_err(|error| tracing::error!(%error, "hashing failed")).ok()
}

/// Reads the cost from `hash`, so a hash stored under another cost still verifies.
fn verify_with(password: &str, hash: &str) -> bool {
    unhashable(password).is_none() && bcrypt::verify(password, hash).unwrap_or(false)
}

/// Checked for an unknown account; built on first use, inside a check.
static UNKNOWN_ACCOUNT: OnceLock<Option<String>> = OnceLock::new();

/// Hashes and checks passwords; clones share one cap on concurrent checks.
#[derive(Clone)]
pub struct Passwords {
    gate: Arc<Semaphore>,
}

/// Field-less, so no printed state ever carries password-derived data.
impl std::fmt::Debug for Passwords {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Passwords").finish_non_exhaustive()
    }
}

impl Passwords {
    pub fn new() -> Self {
        Self { gate: Arc::new(Semaphore::new(CHECKS)) }
    }

    /// The permit stays taken until `work` returns, even when the caller is dropped first.
    async fn capped<T: Send + 'static>(&self, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let permit = Arc::clone(&self.gate).acquire_owned().await.ok()?;
        let done = tokio::task::spawn_blocking(move || {
            let out = work();
            drop(permit);
            out
        });
        done.await.inspect_err(|error| tracing::error!(%error, "password task failed")).ok()
    }

    /// `None` when hashing failed or the password is `unhashable`.
    pub async fn hash(&self, password: String) -> Option<String> {
        self.capped(move || hash_with(&password)).await.flatten()
    }

    /// Checks `password` against `hash`; without a hash, against a dummy of the same cost, so an unknown
    /// account takes as long as a wrong password.
    pub async fn verify(&self, password: String, hash: Option<String>) -> bool {
        let checked = self.capped(move || {
            if let Some(hash) = hash {
                return verify_with(&password, &hash);
            }
            let dummy = UNKNOWN_ACCOUNT.get_or_init(|| hash_with("no such account"));
            if let Some(dummy) = dummy.as_deref() {
                std::hint::black_box(verify_with(&password, dummy));
            }
            false
        });
        checked.await.unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use tokio::task::JoinHandle;

    use super::*;

    fn spawn_hash(passwords: &Passwords, password: &str) -> JoinHandle<Option<String>> {
        let (passwords, password) = (passwords.clone(), password.to_owned());
        tokio::spawn(async move { passwords.hash(password).await })
    }

    fn spawn_verify(passwords: &Passwords, password: &str, hash: Option<String>) -> JoinHandle<bool> {
        let (passwords, password) = (passwords.clone(), password.to_owned());
        tokio::spawn(async move { passwords.verify(password, hash).await })
    }

    #[tokio::test]
    async fn a_hash_checks_only_its_password_and_the_dummy_matches_nothing() {
        let passwords = Passwords::new();
        let hash = passwords.hash("correct horse battery".into()).await.expect("hash");
        assert!(hash.starts_with("$2b$12$") && hash.len() == 60, "{hash}");
        assert!(passwords.verify("correct horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify("wrong horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify(String::new(), Some(hash)).await);
        assert!(!passwords.verify("no such account".into(), None).await, "the dummy matches nothing");
    }

    /// Openwall `crypt_blowfish`'s published vectors, so the hash is bcrypt and not only self-consistent.
    #[tokio::test]
    async fn a_reference_bcrypt_hash_verifies() {
        let passwords = Passwords::new();
        let vectors = [
            ("U*U", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"),
            ("", "$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s."),
        ];
        for (password, hash) in vectors {
            assert!(passwords.verify(password.into(), Some(hash.into())).await, "{password:?}");
            assert!(!passwords.verify("U*V".into(), Some(hash.into())).await, "{password:?}");
        }
    }

    /// bcrypt reads 72 bytes; a longer password is refused, never cut to a prefix that would match.
    #[tokio::test]
    async fn a_password_hashes_up_to_72_bytes_and_a_longer_one_never_matches() {
        let passwords = Passwords::new();
        let longest = "é".repeat(36);
        assert_eq!(longest.len(), 72);
        let hash = passwords.hash(longest.clone()).await.expect("72 bytes hash");
        assert!(passwords.verify(longest.clone(), Some(hash.clone())).await);
        assert!(!passwords.verify(format!("{longest}x"), Some(hash)).await, "73 bytes, same first 72");
        assert_eq!(passwords.hash("x".repeat(73)).await, None);
    }

    /// bcrypt stops at a NUL, so a password holding one would match its prefix.
    #[tokio::test]
    async fn a_password_holding_a_nul_never_hashes_or_matches_its_prefix() {
        let passwords = Passwords::new();
        assert_eq!(passwords.hash("abcdefgh\0abcdefgh".into()).await, None);
        let hash = passwords.hash("abcdefgh".into()).await.expect("hash");
        assert!(!passwords.verify("abcdefgh\0abcdefgh".into(), Some(hash)).await, "NUL inside");
        let prefix = "x".repeat(71);
        let hash = passwords.hash(prefix.clone()).await.expect("hash");
        assert!(!passwords.verify(format!("{prefix}\0"), Some(hash)).await, "72 bytes ending in NUL");
    }

    #[tokio::test]
    async fn passwords_print_without_any_hash() {
        let passwords = Passwords::new();
        passwords.hash("correct horse battery".into()).await.expect("hash");
        assert!(!passwords.verify("correct horse battery".into(), None).await);
        assert_eq!(format!("{passwords:?}"), "Passwords { .. }");
    }

    #[tokio::test]
    async fn two_hashes_of_one_password_differ_by_salt() {
        let passwords = Passwords::new();
        let a = passwords.hash("correct horse battery".into()).await.expect("hash");
        let b = passwords.hash("correct horse battery".into()).await.expect("hash");
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn a_stored_hash_that_is_not_bcrypt_never_verifies() {
        let passwords = Passwords::new();
        let argon2 = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA";
        for hash in ["", "correct horse battery", "$2b$12$", argon2] {
            assert!(!passwords.verify("correct horse battery".into(), Some(hash.into())).await, "{hash:?}");
        }
    }

    /// A capped check that counts the checks running beside it, recording the most seen.
    fn spawn_counted(
        passwords: &Passwords,
        running: &Arc<AtomicUsize>,
        most: &Arc<AtomicUsize>,
    ) -> JoinHandle<Option<()>> {
        let (passwords, running, most) = (passwords.clone(), Arc::clone(running), Arc::clone(most));
        let check = move || {
            most.fetch_max(running.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            running.fetch_sub(1, Ordering::SeqCst);
        };
        tokio::spawn(async move { passwords.capped(check).await })
    }

    #[tokio::test]
    async fn parallel_checks_never_run_past_the_cap() {
        let passwords = Passwords::new();
        let (running, most) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let checks: Vec<_> = (0..6).map(|_| spawn_counted(&passwords, &running, &most)).collect();
        for check in checks {
            check.await.expect("join").expect("ran");
        }
        assert_eq!(most.load(Ordering::SeqCst), CHECKS);
    }

    /// A client that disconnects drops its check's future; the hash already running keeps the cap.
    #[tokio::test]
    async fn a_dropped_check_keeps_the_cap_until_its_hash_ends() {
        let passwords = Passwords::new();
        let (started, running) = std::sync::mpsc::channel::<()>();
        let (finish, finished) = std::sync::mpsc::channel::<()>();
        let hash_until_released = move || {
            started.send(()).expect("test waits");
            finished.recv().expect("test releases");
        };
        let caller = passwords.clone();
        let dropped = tokio::spawn(async move { caller.capped(hash_until_released).await });
        tokio::task::spawn_blocking(move || running.recv()).await.expect("join").expect("hash started");
        dropped.abort();
        assert!(dropped.await.expect_err("aborted").is_cancelled());

        let next = spawn_verify(&passwords, "correct horse battery", None);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!next.is_finished(), "ran beside the dropped check's hash");

        finish.send(()).expect("hash waits");
        assert!(!next.await.expect("join"));
    }

    #[tokio::test]
    async fn every_check_waits_for_the_cap_including_an_unknown_account() {
        let passwords = Passwords::new();
        let stored = passwords.hash("correct horse battery".into()).await.expect("hash");
        let taken = Arc::clone(&passwords.gate).acquire_many_owned(cap()).await.expect("open");

        let hash = spawn_hash(&passwords, "another long password");
        let known = spawn_verify(&passwords, "correct horse battery", Some(stored));
        let unknown = spawn_verify(&passwords, "correct horse battery", None);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!hash.is_finished() && !known.is_finished() && !unknown.is_finished(), "ran past the cap");

        drop(taken);
        assert!(hash.await.expect("join").is_some());
        assert!(known.await.expect("join"));
        assert!(!unknown.await.expect("join"));
        assert_eq!(passwords.gate.available_permits(), CHECKS, "the cap is returned");
    }

    fn cap() -> u32 {
        u32::try_from(CHECKS).expect("small")
    }
}
