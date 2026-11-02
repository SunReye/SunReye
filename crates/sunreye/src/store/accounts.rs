//! Account administration and the API keys issued to accounts.

use super::{AccountRow, NewAccount, Store, StoreError};

/// Why a role change or a removal did not happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Unknown,
    /// The account is the only admin: demoting or removing it would lock every admin route.
    LastAdmin,
}

/// A key to store: its SHA-256 and the head shown in listings, never the key.
#[derive(Clone, PartialEq, Eq)]
pub struct NewApiKey {
    pub account_id: i64,
    pub name: String,
    pub start: String,
    pub key_hash: Vec<u8>,
}

/// Leaves the hash out of logs.
impl std::fmt::Debug for NewApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NewApiKey")
            .field("account_id", &self.account_id)
            .field("name", &self.name)
            .field("start", &self.start)
            .finish_non_exhaustive()
    }
}

/// A stored key with its owner. Times are UTC ISO 8601.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeyRow {
    pub id: i64,
    pub name: String,
    pub start: String,
    pub created_at: String,
    pub account_id: i64,
    pub account_email: String,
    pub account_name: String,
}

impl Store {
    pub async fn accounts(&self) -> Result<Vec<AccountRow>, StoreError> {
        let rows = sqlx::query_as!(
            AccountRow,
            r#"SELECT id AS "id!", email, name, password_hash, admin AS "admin: bool" FROM account ORDER BY id"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// `None` when the email, in any case, is taken.
    pub async fn add_account(&self, account: &NewAccount, admin: bool) -> Result<Option<i64>, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO account (email, name, password_hash, admin) VALUES (?, ?, ?, ?)
               ON CONFLICT (email) DO NOTHING RETURNING id AS "id!""#,
            account.email,
            account.name,
            account.password_hash,
            admin
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| row.id))
    }

    /// One statement, so two admins demoting each other at once cannot leave none.
    pub async fn set_admin(&self, id: i64, admin: bool) -> Result<Result<AccountRow, Refusal>, StoreError> {
        let row = sqlx::query_as!(
            AccountRow,
            r#"UPDATE account SET admin = ?2
               WHERE id = ?1 AND (?2 OR NOT admin OR EXISTS (SELECT 1 FROM account WHERE admin AND id != ?1))
               RETURNING id AS "id!", email, name, password_hash, admin AS "admin: bool""#,
            id,
            admin
        )
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => Ok(Ok(row)),
            None => Ok(Err(self.refusal(id).await?)),
        }
    }

    /// Removes the account with its API keys; its sessions find no account and end.
    pub async fn remove_account(&self, id: i64) -> Result<Result<(), Refusal>, StoreError> {
        let removed = sqlx::query!(
            "DELETE FROM account
             WHERE id = ?1 AND (NOT admin OR EXISTS (SELECT 1 FROM account WHERE admin AND id != ?1))",
            id
        )
        .execute(&self.pool)
        .await?;
        if removed.rows_affected() == 1 { Ok(Ok(())) } else { Ok(Err(self.refusal(id).await?)) }
    }

    async fn refusal(&self, id: i64) -> Result<Refusal, StoreError> {
        Ok(if self.account(id).await?.is_some() { Refusal::LastAdmin } else { Refusal::Unknown })
    }

    /// `None` when the account does not exist.
    pub async fn add_api_key(&self, key: &NewApiKey) -> Result<Option<i64>, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO api_key (account_id, name, start, key_hash, created_at)
               SELECT id, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM account WHERE id = ?
               RETURNING id AS "id!""#,
            key.name,
            key.start,
            key.key_hash,
            key.account_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| row.id))
    }

    /// Newest first.
    pub async fn api_keys(&self) -> Result<Vec<ApiKeyRow>, StoreError> {
        let rows = sqlx::query_as!(
            ApiKeyRow,
            r#"SELECT k.id AS "id!", k.name, k.start, k.created_at,
                      a.id AS "account_id!", a.email AS account_email, a.name AS account_name
               FROM api_key k JOIN account a ON a.id = k.account_id
               ORDER BY k.id DESC"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn api_key(&self, id: i64) -> Result<Option<ApiKeyRow>, StoreError> {
        let row = sqlx::query_as!(
            ApiKeyRow,
            r#"SELECT k.id AS "id!", k.name, k.start, k.created_at,
                      a.id AS "account_id!", a.email AS account_email, a.name AS account_name
               FROM api_key k JOIN account a ON a.id = k.account_id
               WHERE k.id = ?"#,
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Deletes the key; false when there was none.
    pub async fn revoke_api_key(&self, id: i64) -> Result<bool, StoreError> {
        let revoked = sqlx::query!("DELETE FROM api_key WHERE id = ?", id).execute(&self.pool).await?;
        Ok(revoked.rows_affected() == 1)
    }

    /// The account a key with this hash belongs to.
    pub async fn api_key_account(&self, key_hash: &[u8]) -> Result<Option<i64>, StoreError> {
        let row = sqlx::query!("SELECT account_id FROM api_key WHERE key_hash = ?", key_hash)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|row| row.account_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(email: &str) -> NewAccount {
        NewAccount { email: email.into(), name: "Name".into(), password_hash: "$2b$12$hash".into() }
    }

    fn key(account_id: i64, hash: u8) -> NewApiKey {
        NewApiKey {
            account_id,
            name: format!("key {hash}"),
            start: "sunreye_abcd".into(),
            key_hash: vec![hash; 32],
        }
    }

    #[test]
    fn a_new_key_prints_without_its_hash() {
        let new = NewApiKey {
            account_id: 1,
            name: "Home Assistant".into(),
            start: "sunreye_abcd".into(),
            key_hash: vec![0xEE; 32],
        };
        for printed in [format!("{new:?}"), format!("{new:#?}")] {
            assert!(printed.contains("Home Assistant"), "{printed}");
            assert!(!printed.contains("238") && !printed.contains("key_hash"), "{printed}");
        }
    }

    async fn with_admin() -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let admin = store.create_first_account(&account("ada@example.org")).await.expect("c").expect("id");
        (store, admin)
    }

    #[tokio::test]
    async fn accounts_are_listed_in_creation_order_and_a_taken_email_in_any_case_is_none() {
        let (store, admin) = with_admin().await;
        let user = store.add_account(&account("bob@example.org"), false).await.expect("add").expect("id");
        let second = store.add_account(&account("cy@example.org"), true).await.expect("add").expect("id");
        assert_eq!(store.add_account(&account("BOB@example.org"), true).await.expect("add"), None);
        let listed: Vec<_> = store.accounts().await.expect("list").iter().map(|a| (a.id, a.admin)).collect();
        assert_eq!(listed, [(admin, true), (user, false), (second, true)]);
    }

    #[tokio::test]
    async fn the_only_admin_is_neither_demoted_nor_removed_and_an_unknown_id_is_named() {
        let (store, admin) = with_admin().await;
        let user = store.add_account(&account("bob@example.org"), false).await.expect("add").expect("id");
        assert_eq!(store.set_admin(admin, false).await.expect("set"), Err(Refusal::LastAdmin));
        assert_eq!(store.remove_account(admin).await.expect("remove"), Err(Refusal::LastAdmin));
        assert!(store.set_admin(admin, true).await.expect("set").is_ok_and(|a| a.admin));
        assert!(store.set_admin(user, false).await.expect("set").is_ok_and(|a| !a.admin));
        assert_eq!(store.set_admin(999, true).await.expect("set"), Err(Refusal::Unknown));
        assert_eq!(store.remove_account(999).await.expect("remove"), Err(Refusal::Unknown));
        assert!(store.account(admin).await.expect("get").is_some_and(|a| a.admin));
    }

    #[tokio::test]
    async fn with_two_admins_one_steps_down_and_then_the_other_is_the_last() {
        let (store, admin) = with_admin().await;
        let second = store.add_account(&account("cy@example.org"), true).await.expect("add").expect("id");
        assert!(store.set_admin(admin, false).await.expect("set").is_ok());
        assert_eq!(store.set_admin(second, false).await.expect("set"), Err(Refusal::LastAdmin));
        assert_eq!(store.remove_account(admin).await.expect("remove"), Ok(()));
        assert_eq!(store.remove_account(second).await.expect("remove"), Err(Refusal::LastAdmin));
    }

    #[tokio::test]
    async fn two_admins_demoting_or_removing_each_other_at_once_leave_one() {
        let (store, admin) = with_admin().await;
        let second = store.add_account(&account("cy@example.org"), true).await.expect("add").expect("id");
        let (a, b) = tokio::join!(store.set_admin(admin, false), store.set_admin(second, false));
        let mut outcomes = [a.expect("a").map(|_| ()), b.expect("b").map(|_| ())];
        outcomes.sort_by_key(Result::is_ok);
        assert_eq!(outcomes, [Err(Refusal::LastAdmin), Ok(())]);
        assert_eq!(store.accounts().await.expect("list").iter().filter(|a| a.admin).count(), 1);

        let promoted = store.accounts().await.expect("list").into_iter().find(|a| !a.admin).expect("demoted");
        assert!(store.set_admin(promoted.id, true).await.expect("set").is_ok());
        let (a, b) = tokio::join!(store.remove_account(admin), store.remove_account(second));
        let mut outcomes = [a.expect("a"), b.expect("b")];
        outcomes.sort_by_key(Result::is_ok);
        assert_eq!(outcomes, [Err(Refusal::LastAdmin), Ok(())]);
        assert_eq!(store.accounts().await.expect("list").iter().filter(|a| a.admin).count(), 1);
    }

    #[tokio::test]
    async fn a_key_names_its_account_until_it_is_revoked() {
        let (store, admin) = with_admin().await;
        let id = store.add_api_key(&key(admin, 1)).await.expect("add").expect("id");
        assert_eq!(store.api_key_account(&[1; 32]).await.expect("find"), Some(admin));
        assert_eq!(store.api_key_account(&[2; 32]).await.expect("find"), None);
        let row = store.api_key(id).await.expect("get").expect("row");
        assert_eq!(row.account_email, "ada@example.org");
        assert!(row.created_at.ends_with('Z') && row.created_at.len() == 24, "{}", row.created_at);
        assert!(store.revoke_api_key(id).await.expect("revoke"));
        assert!(!store.revoke_api_key(id).await.expect("revoke twice"));
        assert_eq!(store.api_key_account(&[1; 32]).await.expect("find"), None);
    }

    #[tokio::test]
    async fn a_key_for_an_unknown_account_is_none_and_keys_leave_with_their_account() {
        let (store, admin) = with_admin().await;
        assert_eq!(store.add_api_key(&key(999, 1)).await.expect("add"), None);
        let user = store.add_account(&account("bob@example.org"), false).await.expect("add").expect("id");
        store.add_api_key(&key(user, 2)).await.expect("add").expect("id");
        let kept = store.add_api_key(&key(admin, 3)).await.expect("add").expect("id");
        assert_eq!(store.remove_account(user).await.expect("remove"), Ok(()));
        assert_eq!(store.api_key_account(&[2; 32]).await.expect("find"), None);
        let left: Vec<_> = store.api_keys().await.expect("list").iter().map(|k| k.id).collect();
        assert_eq!(left, [kept]);
    }

    #[tokio::test]
    async fn keys_list_newest_first() {
        let (store, admin) = with_admin().await;
        let user = store.add_account(&account("bob@example.org"), false).await.expect("add").expect("id");
        let first = store.add_api_key(&key(admin, 1)).await.expect("add").expect("id");
        let second = store.add_api_key(&key(user, 2)).await.expect("add").expect("id");
        let ids = |rows: Vec<ApiKeyRow>| rows.iter().map(|k| k.id).collect::<Vec<_>>();
        assert_eq!(ids(store.api_keys().await.expect("all")), [second, first]);
    }
}
