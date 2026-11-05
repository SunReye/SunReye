//! The learned forecast correction per inverter: its cells and learn state (migration 0010).

use std::collections::BTreeSet;

use super::{Store, StoreError};
use crate::forecast::{CorrectionCell, CorrectionModel, Skill};
use crate::learn::LearnState;

impl Store {
    /// The device's learned grid, empty before its first fold, and its state, none before its first run.
    pub async fn correction(
        &self,
        device_id: i64,
    ) -> Result<(CorrectionModel, Option<LearnState>), StoreError> {
        let mut tx = self.pool.begin().await?;
        let rows = sqlx::query!(
            "SELECT month, hour, ratio, weight FROM forecast_correction_cell WHERE device_id = ?",
            device_id
        )
        .fetch_all(&mut *tx)
        .await?;
        let mut model = CorrectionModel::default();
        for row in rows {
            let slot = |v: i64| i8::try_from(v).map_err(|_| StoreError::Corrupt("correction cell"));
            model.set(
                slot(row.month)?,
                slot(row.hour)?,
                CorrectionCell { ratio: row.ratio, weight: row.weight },
            );
        }
        let state = sqlx::query!(
            "SELECT learned_through, mae_raw, mae_corrected, samples FROM forecast_correction_state
             WHERE device_id = ?",
            device_id
        )
        .fetch_optional(&mut *tx)
        .await?;
        let state = state
            .map(|row| {
                let learned_through = row
                    .learned_through
                    .parse()
                    .map_err(|_| StoreError::Corrupt("correction learned_through"))?;
                let skill =
                    Skill { mae_raw: row.mae_raw, mae_corrected: row.mae_corrected, samples: row.samples };
                Ok::<_, StoreError>(LearnState { learned_through, skill })
            })
            .transpose()?;
        Ok((model, state))
    }

    /// Writes the `touched` cells of `model` and the state together, or nothing.
    pub async fn save_correction(
        &self,
        device_id: i64,
        model: &CorrectionModel,
        touched: &BTreeSet<(i8, i8)>,
        state: &LearnState,
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        for &(month, hour) in touched {
            let Some(cell) = model.cell(month, hour) else { continue };
            sqlx::query!(
                "INSERT OR REPLACE INTO forecast_correction_cell (device_id, month, hour, ratio, weight)
                 VALUES (?, ?, ?, ?, ?)",
                device_id,
                month,
                hour,
                cell.ratio,
                cell.weight
            )
            .execute(&mut *tx)
            .await?;
        }
        let learned_through = state.learned_through.to_string();
        sqlx::query!(
            "INSERT OR REPLACE INTO forecast_correction_state (device_id, learned_through, mae_raw, mae_corrected, samples)
             VALUES (?, ?, ?, ?, ?)",
            device_id,
            learned_through,
            state.skill.mae_raw,
            state.skill.mae_corrected,
            state.skill.samples
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

    use super::*;
    use crate::modbus::Transport;
    use crate::store::{NewConnection, NewDevice};

    async fn with_device() -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let connection =
            NewConnection { transport: Transport::Tcp, host: "h".into(), port: 502, logger_serial: None };
        let connection_id = store.add_connection(&connection).await.expect("connection");
        let id = store
            .add_device(&NewDevice { connection_id, profile_id: "p".into(), unit_id: 1 })
            .await
            .expect("device");
        (store, id)
    }

    fn state(day: i8, samples: f64) -> LearnState {
        LearnState {
            learned_through: date(2026, 7, day),
            skill: Skill { mae_raw: 400.0, mae_corrected: 300.0, samples },
        }
    }

    #[tokio::test]
    async fn a_device_has_no_cells_or_state_until_its_first_save() {
        let (store, id) = with_device().await;
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
    }

    #[tokio::test]
    async fn only_touched_cells_are_written_and_a_later_save_replaces_them_and_the_state() {
        let (store, id) = with_device().await;
        let mut model = CorrectionModel::default();
        model.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        model.set(7, 13, CorrectionCell { ratio: 1.1, weight: 1.0 });
        model.set(12, 0, CorrectionCell { ratio: 1.3, weight: 4.0 });
        store
            .save_correction(id, &model, &BTreeSet::from([(7, 12), (12, 0)]), &state(20, 3.0))
            .await
            .expect("save");
        let mut saved = CorrectionModel::default();
        saved.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        saved.set(12, 0, CorrectionCell { ratio: 1.3, weight: 4.0 });
        assert_eq!(store.correction(id).await.expect("read"), (saved.clone(), Some(state(20, 3.0))));

        let mut next = saved;
        next.set(7, 12, CorrectionCell { ratio: 0.8, weight: 2.9 });
        store.save_correction(id, &next, &BTreeSet::from([(7, 12)]), &state(21, 3.9)).await.expect("save");
        assert_eq!(store.correction(id).await.expect("read"), (next, Some(state(21, 3.9))));
    }

    #[tokio::test]
    async fn a_refused_cell_writes_neither_the_cells_nor_the_state() {
        let (store, id) = with_device().await;
        let mut model = CorrectionModel::default();
        model.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        model.set(7, 13, CorrectionCell { ratio: 1.1, weight: -1.0 });
        let touched = BTreeSet::from([(7, 12), (7, 13)]);
        assert!(store.save_correction(id, &model, &touched, &state(20, 3.0)).await.is_err());
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
    }

    #[tokio::test]
    async fn a_removed_device_takes_its_correction_with_it() {
        let (store, id) = with_device().await;
        let mut model = CorrectionModel::default();
        model.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        store.save_correction(id, &model, &BTreeSet::from([(7, 12)]), &state(20, 3.0)).await.expect("save");
        sqlx::query("DELETE FROM device WHERE id = ?").bind(id).execute(&store.pool).await.expect("delete");
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
    }
}
