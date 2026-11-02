//! Argon2id password hashing within the target's memory budget (ADR 0003, ADR 0006).

use std::sync::{Arc, OnceLock};

use argon2::{Algorithm, Argon2, Block, Params, Version};
use password_hash::rand_core::OsRng;
use password_hash::{Output, ParamsString, PasswordHash, SaltString};
use tokio::sync::Mutex;

/// OWASP's 19 MiB, t=2 profile.
const LINUX_COST: (u32, u32) = (19 * 1024, 2);
/// OWASP's equivalent 12 MiB, t=3 profile.
const ANDROID_COST: (u32, u32) = (12 * 1024, 3);

const COST: (u32, u32) = if cfg!(target_os = "android") { ANDROID_COST } else { LINUX_COST };

#[allow(clippy::panic, reason = "evaluated at compile time")]
const fn params((m_cost, t_cost): (u32, u32)) -> Params {
    match Params::new(m_cost, t_cost, 1, None) {
        Ok(params) => params,
        Err(_) => panic!("invalid Argon2 parameters"),
    }
}

const PARAMS: Params = params(COST);

/// Argon2's working memory, filled in place by every check: allocated once, never freed, so the
/// allocator holds one check's blocks however many logins run.
type Blocks = Vec<Block>;

/// Fills `out` with `argon2` of `password`, sizing `blocks` to its parameters.
fn fill(
    blocks: &mut Blocks,
    argon2: &Argon2<'_>,
    password: &str,
    salt: &[u8],
    out: &mut [u8],
) -> password_hash::Result<()> {
    blocks.resize(argon2.params().block_count(), Block::default());
    Ok(argon2.hash_password_into_with_memory(password.as_bytes(), salt, out, blocks.as_mut_slice())?)
}

fn hash_with(blocks: &mut Blocks, params: &Params, password: &str) -> Option<String> {
    let salt = SaltString::generate(&mut OsRng);
    let mut raw = [0; 64];
    let salt_bytes = salt.decode_b64(&mut raw).ok()?;
    let (algorithm, version) = (Algorithm::Argon2id, Version::V0x13);
    let argon2 = Argon2::new(algorithm, version, params.clone());
    let output =
        Output::init_with(Params::DEFAULT_OUTPUT_LEN, |out| fill(blocks, &argon2, password, salt_bytes, out))
            .ok()?;
    let hash = PasswordHash {
        algorithm: algorithm.ident(),
        version: Some(version.into()),
        params: ParamsString::try_from(params).ok()?,
        salt: Some(salt.as_salt()),
        hash: Some(output),
    };
    Some(hash.to_string())
}

/// Reads the parameters from `hash`, so a hash stored under other parameters still verifies.
fn verify_with(blocks: &mut Blocks, password: &str, hash: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else { return false };
    let (Some(expected), Some(salt)) = (hash.hash, hash.salt) else { return false };
    let (Ok(algorithm), Ok(params)) = (Algorithm::try_from(hash.algorithm), Params::try_from(&hash)) else {
        return false;
    };
    let Ok(version) = hash.version.map_or(Ok(Version::default()), Version::try_from) else { return false };
    let mut raw = [0; 64];
    let Ok(salt) = salt.decode_b64(&mut raw) else { return false };
    let argon2 = Argon2::new(algorithm, version, params);
    let output = Output::init_with(expected.len(), |out| fill(blocks, &argon2, password, salt, out));
    // `Output` compares in constant time.
    output.is_ok_and(|output| output == expected)
}

/// Checked for an unknown account; built on first use, inside a check.
static UNKNOWN_ACCOUNT: OnceLock<Option<String>> = OnceLock::new();

/// Hashes and checks passwords; clones share one cap on concurrent checks and its memory.
#[derive(Debug, Clone)]
pub struct Passwords {
    /// One check at a time, so parallel logins stay inside the 32 MB resident budget (ADR 0006).
    gate: Arc<Mutex<Blocks>>,
}

impl Passwords {
    pub fn new() -> Self {
        Self { gate: Arc::new(Mutex::new(Vec::new())) }
    }

    /// Runs `work` on a blocking thread once the cap admits it; `None` if the task died. The cap stays
    /// taken until `work` returns, even when the caller is dropped first.
    async fn capped<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Blocks) -> T + Send + 'static,
    ) -> Option<T> {
        let mut blocks = Arc::clone(&self.gate).lock_owned().await;
        let done = tokio::task::spawn_blocking(move || work(&mut blocks)).await;
        done.inspect_err(|error| tracing::error!(%error, "password task failed")).ok()
    }

    /// `None` when hashing failed.
    pub async fn hash(&self, password: String) -> Option<String> {
        self.capped(move |blocks| hash_with(blocks, &PARAMS, &password)).await.flatten()
    }

    /// Checks `password` against `hash`; without a hash, against a dummy of the same cost, so an unknown
    /// account takes as long as a wrong password.
    pub async fn verify(&self, password: String, hash: Option<String>) -> bool {
        let checked = self.capped(move |blocks| {
            if let Some(hash) = hash {
                return verify_with(blocks, &password, &hash);
            }
            let dummy = UNKNOWN_ACCOUNT.get_or_init(|| hash_with(blocks, &PARAMS, "no such account"));
            if let Some(dummy) = dummy.as_deref() {
                std::hint::black_box(verify_with(blocks, &password, dummy));
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

    #[tokio::test]
    async fn a_hash_checks_only_its_password_and_the_dummy_matches_nothing() {
        let passwords = Passwords::new();
        let hash = passwords.hash("correct horse battery".into()).await.expect("hash");
        assert!(hash.starts_with(&format!("$argon2id$v=19$m={},t={},p=1$", COST.0, COST.1)), "{hash}");
        assert!(passwords.verify("correct horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify("wrong horse battery".into(), Some(hash.clone())).await);
        assert!(!passwords.verify(String::new(), Some(hash)).await);
        assert!(!passwords.verify("no such account".into(), None).await, "the dummy matches nothing");
    }

    /// Both targets' parameters, checked on the host against the `argon2` crate's own PHC hasher and verifier.
    #[test]
    fn each_targets_parameters_hash_and_verify_like_the_reference_implementation() {
        use argon2::{PasswordHasher, PasswordVerifier};
        let cases = [
            (LINUX_COST, "$argon2id$v=19$m=19456,t=2,p=1$"),
            (ANDROID_COST, "$argon2id$v=19$m=12288,t=3,p=1$"),
        ];
        let mut blocks = Blocks::new();
        for (cost, prefix) in cases {
            let ours = hash_with(&mut blocks, &params(cost), "correct horse battery").expect("hash");
            assert!(ours.starts_with(prefix), "{ours}");
            let reference = Argon2::new(Algorithm::Argon2id, Version::V0x13, params(cost));
            let parsed = PasswordHash::new(&ours).expect("phc");
            assert!(reference.verify_password(b"correct horse battery", &parsed).is_ok(), "{prefix}");
            assert!(reference.verify_password(b"wrong horse battery", &parsed).is_err(), "{prefix}");

            let salt = SaltString::generate(&mut OsRng);
            let theirs = reference.hash_password(b"correct horse battery", &salt).expect("hash").to_string();
            assert!(verify_with(&mut blocks, "correct horse battery", &theirs), "{prefix}");
            assert!(!verify_with(&mut blocks, "wrong horse battery", &theirs), "{prefix}");
        }
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

    /// A client that disconnects drops its check's future; the hash already running keeps the cap.
    #[tokio::test]
    async fn a_dropped_check_keeps_the_cap_until_its_hash_ends() {
        let passwords = Passwords::new();
        let (started, running) = std::sync::mpsc::channel::<()>();
        let (finish, finished) = std::sync::mpsc::channel::<()>();
        let hash_until_released = move |_: &mut Blocks| {
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

    /// While the cap is taken, a hash, a check and an unknown-account check all wait for it.
    #[tokio::test]
    async fn every_check_waits_for_the_cap_including_an_unknown_account() {
        let passwords = Passwords::new();
        let stored = passwords.hash("correct horse battery".into()).await.expect("hash");
        let taken = Arc::clone(&passwords.gate).lock_owned().await;

        let hash = spawn_hash(&passwords, "another long password");
        let known = spawn_verify(&passwords, "correct horse battery", Some(stored));
        let unknown = spawn_verify(&passwords, "correct horse battery", None);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!hash.is_finished() && !known.is_finished() && !unknown.is_finished(), "ran past the cap");

        drop(taken);
        assert!(hash.await.expect("join").is_some());
        assert!(known.await.expect("join"));
        assert!(!unknown.await.expect("join"));
        assert!(passwords.gate.try_lock().is_ok(), "the cap is returned");
    }
}
