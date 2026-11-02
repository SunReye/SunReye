//! Argon2id password hashing within the target's memory budget (ADR 0003, ADR 0006).

use std::sync::{Arc, LazyLock};

use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version};
use password_hash::SaltString;
use password_hash::rand_core::OsRng;
use tokio::sync::Semaphore;

/// OWASP's 19 MiB, t=2 profile.
#[cfg(not(target_os = "android"))]
const COST: (u32, u32) = (19 * 1024, 2);
/// OWASP's equivalent 12 MiB, t=3 profile: less memory under Android's tighter process budget.
#[cfg(target_os = "android")]
const COST: (u32, u32) = (12 * 1024, 3);

/// One check's memory at a time, so parallel logins stay inside the 32 MB resident budget.
const CHECKS_AT_ONCE: usize = 1;

#[allow(clippy::panic, reason = "evaluated at compile time")]
const PARAMS: Params = match Params::new(COST.0, COST.1, 1, None) {
    Ok(params) => params,
    Err(_) => panic!("invalid Argon2 parameters"),
};

fn argon2() -> Argon2<'static> {
    Argon2::new(Algorithm::Argon2id, Version::V0x13, PARAMS)
}

fn hash_now(password: &str) -> Option<String> {
    let salt = SaltString::generate(&mut OsRng);
    argon2().hash_password(password.as_bytes(), &salt).ok().map(|hash| hash.to_string())
}

/// Checked for an unknown account; built on first use, inside a blocking task.
static UNKNOWN_ACCOUNT: LazyLock<Option<String>> = LazyLock::new(|| hash_now("no such account"));

/// Reads the parameters from `hash`, so a hash stored under other parameters still verifies.
fn verify_now(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|hash| argon2().verify_password(password.as_bytes(), &hash).is_ok())
}

/// Hashes and checks passwords; clones share one cap on concurrent checks.
#[derive(Debug, Clone)]
pub struct Passwords {
    gate: Arc<Semaphore>,
}

impl Passwords {
    pub fn new() -> Self {
        Self { gate: Arc::new(Semaphore::new(CHECKS_AT_ONCE)) }
    }

    /// Runs `work` on a blocking thread once the cap admits it; `None` if the task died.
    async fn capped<T: Send + 'static>(&self, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let _permit = self.gate.acquire().await.ok()?;
        let done = tokio::task::spawn_blocking(work).await;
        done.inspect_err(|error| tracing::error!(%error, "password task failed")).ok()
    }

    /// `None` when hashing failed.
    pub async fn hash(&self, password: String) -> Option<String> {
        self.capped(move || hash_now(&password)).await.flatten()
    }

    /// Checks `password` against `hash`; without a hash, against a dummy of the same cost, so an unknown
    /// account takes as long as a wrong password.
    pub async fn verify(&self, password: String, hash: Option<String>) -> bool {
        let checked = self.capped(move || {
            if let Some(hash) = hash {
                return verify_now(&password, &hash);
            }
            if let Some(dummy) = UNKNOWN_ACCOUNT.as_deref() {
                std::hint::black_box(verify_now(&password, dummy));
            }
            false
        });
        checked.await.unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
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

    #[cfg(not(target_os = "android"))]
    const TARGET_PARAMS: &str = "$argon2id$v=19$m=19456,t=2,p=1$";
    #[cfg(target_os = "android")]
    const TARGET_PARAMS: &str = "$argon2id$v=19$m=12288,t=3,p=1$";

    #[tokio::test]
    async fn a_hash_is_argon2id_with_the_target_parameters_and_checks_only_its_password() {
        let passwords = Passwords::new();
        let hash = passwords.hash("correct horse battery".into()).await.expect("hash");
        assert!(hash.starts_with(TARGET_PARAMS), "{hash}");
        assert!(passwords.verify("correct horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify("wrong horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify(String::new(), Some(hash)).await);
        assert!(!passwords.verify("no such account".into(), None).await, "the dummy matches nothing");
    }

    #[tokio::test]
    async fn two_hashes_of_one_password_differ_by_salt() {
        let passwords = Passwords::new();
        let a = passwords.hash("correct horse battery".into()).await.expect("hash");
        let b = passwords.hash("correct horse battery".into()).await.expect("hash");
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn a_stored_hash_that_is_not_phc_never_verifies() {
        let passwords = Passwords::new();
        for hash in ["", "correct horse battery", "$argon2id$"] {
            assert!(!passwords.verify("correct horse battery".into(), Some(hash.into())).await, "{hash:?}");
        }
    }

    #[test]
    fn one_check_runs_at_a_time() {
        assert_eq!(Passwords::new().gate.available_permits(), 1);
    }

    /// While the cap is taken, a hash, a check and an unknown-account check all wait for it.
    #[tokio::test]
    async fn every_check_waits_for_the_cap_including_an_unknown_account() {
        let passwords = Passwords::new();
        let stored = passwords.hash("correct horse battery".into()).await.expect("hash");
        let taken = Arc::clone(&passwords.gate).acquire_many_owned(1).await.expect("cap");

        let hash = spawn_hash(&passwords, "another long password");
        let known = spawn_verify(&passwords, "correct horse battery", Some(stored));
        let unknown = spawn_verify(&passwords, "correct horse battery", None);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!hash.is_finished() && !known.is_finished() && !unknown.is_finished(), "ran past the cap");

        drop(taken);
        assert!(hash.await.expect("join").is_some());
        assert!(known.await.expect("join"));
        assert!(!unknown.await.expect("join"));
        assert_eq!(passwords.gate.available_permits(), 1, "every permit returned");
    }
}
