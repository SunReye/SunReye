//! The learned forecast correction per inverter: its cells and learn state (migration 0010), and each MPPT
//! string's cells (migration 0011).

use std::collections::{BTreeMap, BTreeSet};

use super::{Store, StoreError};
use crate::forecast::{CorrectionCell, CorrectionModel, Skill};

/// How far one inverter's correction has learned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LearnState {
    /// The last plant-local day folded in.
    pub learned_through: jiff::civil::Date,
    pub skill: Skill,
}

/// One string's grid and the cells a fold wrote.
#[derive(Debug, Clone, Copy)]
pub struct StringGrid<'a> {
    pub mppt: u32,
    pub model: &'a CorrectionModel,
    pub touched: &'a BTreeSet<(i8, i8)>,
}

impl Store {
    /// The device's string grids by `mppt`; a string with no cells is absent.
    pub async fn string_corrections(
        &self,
        device_id: i64,
    ) -> Result<BTreeMap<u32, CorrectionModel>, StoreError> {
        let rows = sqlx::query!(
            "SELECT mppt, month, hour, ratio, weight FROM forecast_correction_string_cell WHERE device_id = ?",
            device_id
        )
        .fetch_all(&self.pool)
        .await?;
        let mut out: BTreeMap<u32, CorrectionModel> = BTreeMap::new();
        for row in rows {
            let corrupt = || StoreError::Corrupt("string correction cell");
            let slot = |v: i64| i8::try_from(v).map_err(|_| corrupt());
            let mppt = u32::try_from(row.mppt).map_err(|_| corrupt())?;
            out.entry(mppt).or_default().set(
                slot(row.month)?,
                slot(row.hour)?,
                CorrectionCell { ratio: row.ratio, weight: row.weight },
            );
        }
        Ok(out)
    }

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

    /// Writes the `touched` cells of `model`, of each string's grid and the state together, or nothing.
    pub async fn save_correction(
        &self,
        device_id: i64,
        (model, touched): (&CorrectionModel, &BTreeSet<(i8, i8)>),
        strings: &[StringGrid<'_>],
        state: &LearnState,
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        for string in strings {
            save_string(&mut tx, device_id, string).await?;
        }
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

async fn save_string(
    conn: &mut sqlx::SqliteConnection,
    device_id: i64,
    string: &StringGrid<'_>,
) -> Result<(), StoreError> {
    for &(month, hour) in string.touched {
        let Some(cell) = string.model.cell(month, hour) else { continue };
        sqlx::query!(
            "INSERT OR REPLACE INTO forecast_correction_string_cell (device_id, mppt, month, hour, ratio, weight)
             VALUES (?, ?, ?, ?, ?, ?)",
            device_id,
            string.mppt,
            month,
            hour,
            cell.ratio,
            cell.weight
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

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
            .save_correction(id, (&model, &BTreeSet::from([(7, 12), (12, 0)])), &[], &state(20, 3.0))
            .await
            .expect("save");
        let mut saved = CorrectionModel::default();
        saved.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        saved.set(12, 0, CorrectionCell { ratio: 1.3, weight: 4.0 });
        assert_eq!(store.correction(id).await.expect("read"), (saved.clone(), Some(state(20, 3.0))));

        let mut next = saved;
        next.set(7, 12, CorrectionCell { ratio: 0.8, weight: 2.9 });
        store
            .save_correction(id, (&next, &BTreeSet::from([(7, 12)])), &[], &state(21, 3.9))
            .await
            .expect("save");
        assert_eq!(store.correction(id).await.expect("read"), (next, Some(state(21, 3.9))));
    }

    #[tokio::test]
    async fn a_refused_cell_writes_neither_the_cells_nor_the_state() {
        let (store, id) = with_device().await;
        let mut model = CorrectionModel::default();
        model.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        model.set(7, 13, CorrectionCell { ratio: 1.1, weight: -1.0 });
        let touched = BTreeSet::from([(7, 12), (7, 13)]);
        assert!(store.save_correction(id, (&model, &touched), &[], &state(20, 3.0)).await.is_err());
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
    }

    #[tokio::test]
    async fn a_removed_device_takes_its_correction_with_it() {
        let (store, id) = with_device().await;
        let mut model = CorrectionModel::default();
        model.set(7, 12, CorrectionCell { ratio: 0.9, weight: 2.0 });
        let strings = [StringGrid { mppt: 1, model: &model, touched: &BTreeSet::from([(7, 12)]) }];
        store
            .save_correction(id, (&model, &BTreeSet::from([(7, 12)])), &strings, &state(20, 3.0))
            .await
            .expect("save");
        sqlx::query("DELETE FROM device WHERE id = ?").bind(id).execute(&store.pool).await.expect("delete");
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
        assert_eq!(store.string_corrections(id).await.expect("read"), BTreeMap::new());
    }

    fn grid(cells: &[(i8, i8, f64)]) -> CorrectionModel {
        let mut model = CorrectionModel::default();
        for &(month, hour, ratio) in cells {
            model.set(month, hour, CorrectionCell { ratio, weight: 2.0 });
        }
        model
    }

    #[tokio::test]
    async fn each_string_keeps_its_own_grid_and_only_touched_cells_are_written() {
        let (store, id) = with_device().await;
        assert_eq!(store.string_corrections(id).await.expect("read"), BTreeMap::new());
        let (one, three) = (grid(&[(7, 12, 0.7), (7, 13, 0.8)]), grid(&[(7, 12, 1.2)]));
        let strings = [
            StringGrid { mppt: 1, model: &one, touched: &BTreeSet::from([(7, 12)]) },
            StringGrid { mppt: 3, model: &three, touched: &BTreeSet::from([(7, 12)]) },
        ];
        let empty = CorrectionModel::default();
        store.save_correction(id, (&empty, &BTreeSet::new()), &strings, &state(20, 3.0)).await.expect("save");
        assert_eq!(
            store.string_corrections(id).await.expect("read"),
            BTreeMap::from([(1, grid(&[(7, 12, 0.7)])), (3, grid(&[(7, 12, 1.2)]))])
        );
        assert_eq!(store.correction(id).await.expect("read"), (empty, Some(state(20, 3.0))));
    }

    #[tokio::test]
    async fn a_refused_string_cell_writes_nothing() {
        let (store, id) = with_device().await;
        let inverter = grid(&[(7, 12, 0.9)]);
        let mut bad = CorrectionModel::default();
        bad.set(7, 12, CorrectionCell { ratio: 0.7, weight: -1.0 });
        let touched = BTreeSet::from([(7, 12)]);
        let strings = [StringGrid { mppt: 2, model: &bad, touched: &touched }];
        assert!(store.save_correction(id, (&inverter, &touched), &strings, &state(20, 3.0)).await.is_err());
        assert_eq!(store.correction(id).await.expect("read"), (CorrectionModel::default(), None));
        assert_eq!(store.string_corrections(id).await.expect("read"), BTreeMap::new());
    }
}
