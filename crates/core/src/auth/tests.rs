//! The pure parts of sign-in.

#[test]
fn passwords_are_hashed_with_bcrypt_at_cost_12() {
    let hash = super::hash("correct horse").unwrap();

    assert!(hash.starts_with("$2b$12$"), "{hash}");
}

#[tokio::test]
async fn an_unknown_viewer_is_hashed_as_long_as_a_known_one() {
    use std::sync::Mutex;

    use super::{CREDENTIALS, Grant, verified};

    let hashed = Mutex::new(Vec::new());
    let verify = |password: String, hash: String| {
        hashed.lock().unwrap().push(hash.clone());
        std::future::ready(Ok(password == "correct horse" && hash == "$2b$12$known"))
    };

    let unknown = verified(None, "correct horse".to_owned(), verify).await;
    let known = Some((Grant::Admin, "$2b$12$known".to_owned()));
    let known = verified(known, "correct horse".to_owned(), verify).await;

    assert_eq!(unknown, Err(CREDENTIALS));
    assert_eq!(known, Ok(Grant::Admin));
    let hashed = hashed.into_inner().unwrap();
    assert_eq!(hashed.len(), 2);
    assert!(
        hashed[0].starts_with("$2b$12$"),
        "the dummy hash costs as much as a real one"
    );
}

#[test]
fn the_dummy_hash_is_a_bcrypt_hash_at_cost_12() {
    assert!(!bcrypt::verify("anything", super::DUMMY).unwrap());
    assert!(super::DUMMY.starts_with("$2b$12$"));
}
