//! The plant time zone's row (migration 0009).

use super::{Store, StoreError};

impl Store {
    /// The saved IANA name; none until first saved.
    pub async fn plant_time_zone(&self) -> Result<Option<String>, StoreError> {
        let row =
            sqlx::query!("SELECT name FROM plant_time_zone WHERE id = 1").fetch_optional(&self.pool).await?;
        Ok(row.map(|row| row.name))
    }

    pub async fn save_plant_time_zone(&self, name: &str) -> Result<(), StoreError> {
        save_time_zone(&self.pool, name).await
    }
}

pub(crate) async fn save_time_zone<'e, E: sqlx::Executor<'e, Database = sqlx::Sqlite>>(
    executor: E,
    name: &str,
) -> Result<(), StoreError> {
    sqlx::query!("INSERT OR REPLACE INTO plant_time_zone (id, name) VALUES (1, ?)", name)
        .execute(executor)
        .await?;
    Ok(())
}
