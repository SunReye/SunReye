//! The pure parts of sign-in.

#[test]
fn passwords_are_hashed_with_bcrypt_at_cost_12() {
    let hash = super::hash("correct horse").unwrap();

    assert!(hash.starts_with("$2b$12$"), "{hash}");
}
