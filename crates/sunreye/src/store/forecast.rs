//! The forecast settings: the plant row and each inverter's PV description (migration 0008).

use std::collections::BTreeMap;

use super::{Store, StoreError};
use crate::events::Changed;
use crate::weather::{Battery, Correction, DevicePv, PlantSettings, PvArray};

impl Store {
    /// None until first saved.
    pub async fn plant_settings(&self) -> Result<Option<PlantSettings>, StoreError> {
        let row = sqlx::query!(
            r#"SELECT enabled AS "enabled: bool", latitude, longitude, label, forecast_enabled AS "forecast_enabled: bool",
                      provider, max_output_w, house_load_w, smart_meter_since,
                      correction_enabled AS "correction_enabled: bool"
               FROM plant_forecast WHERE id = 1"#
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| PlantSettings {
            enabled: row.enabled,
            latitude: row.latitude,
            longitude: row.longitude,
            label: row.label,
            forecast_enabled: row.forecast_enabled,
            provider: row.provider,
            max_output_w: row.max_output_w,
            house_load_w: row.house_load_w,
            smart_meter_since: row.smart_meter_since,
            correction: Correction { enabled: row.correction_enabled },
        }))
    }

    pub async fn save_plant_settings(&self, s: &PlantSettings) -> Result<(), StoreError> {
        save_plant(&self.pool, s).await?;
        self.changed.publish(Changed::Settings);
        Ok(())
    }

    /// Every device's PV description that was ever saved, by device id.
    pub async fn device_pv(&self) -> Result<BTreeMap<i64, DevicePv>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let rows = sqlx::query!(
            r#"SELECT device_id AS "device_id!", temp_coefficient, system_loss, battery_usable_kwh,
                      battery_max_charge_w, battery_min_soc
               FROM device_pv"#
        )
        .fetch_all(&mut *tx)
        .await?;
        let mut out: BTreeMap<i64, DevicePv> = rows
            .into_iter()
            .map(|row| {
                let battery = row.battery_usable_kwh.zip(row.battery_min_soc).map(|(usable_kwh, min_soc)| {
                    Battery { usable_kwh, max_charge_w: row.battery_max_charge_w, min_soc }
                });
                let pv = DevicePv {
                    arrays: Vec::new(),
                    temp_coefficient: row.temp_coefficient,
                    system_loss: row.system_loss,
                    battery,
                };
                (row.device_id, pv)
            })
            .collect();
        let arrays = sqlx::query!(
            "SELECT device_id, kwp, tilt, azimuth, temp_coefficient, system_loss, mppt FROM pv_array
             ORDER BY device_id, position"
        )
        .fetch_all(&mut *tx)
        .await?;
        for row in arrays {
            let mppt = row.mppt.map(|m| u32::try_from(m).map_err(|_| StoreError::Corrupt("pv array mppt")));
            out.entry(row.device_id).or_default().arrays.push(PvArray {
                kwp: row.kwp,
                tilt: row.tilt,
                azimuth: row.azimuth,
                device_slug: None,
                temp_coefficient: row.temp_coefficient,
                system_loss: row.system_loss,
                mppt: mppt.transpose()?,
            });
        }
        Ok(out)
    }

    /// Replaces the device's PV description whole.
    pub async fn save_device_pv(&self, device_id: i64, pv: &DevicePv) -> Result<(), StoreError> {
        let mut conn = self.pool.acquire().await?;
        replace_device_pv(&mut conn, device_id, pv).await?;
        self.changed.publish(Changed::Devices);
        Ok(())
    }
}

pub(crate) async fn save_plant<'e, E: sqlx::Executor<'e, Database = sqlx::Sqlite>>(
    executor: E,
    s: &PlantSettings,
) -> Result<(), StoreError> {
    sqlx::query!(
            "INSERT OR REPLACE INTO plant_forecast (id, enabled, latitude, longitude, label, forecast_enabled, provider,
                                                   max_output_w, house_load_w, smart_meter_since, correction_enabled)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            s.enabled,
            s.latitude,
            s.longitude,
            s.label,
            s.forecast_enabled,
            s.provider,
            s.max_output_w,
            s.house_load_w,
            s.smart_meter_since,
            s.correction.enabled
        )
        .execute(executor)
        .await?;
    Ok(())
}

/// Replaces the device's PV description whole, in a transaction of its own or nested in the caller's.
pub(crate) async fn replace_device_pv(
    conn: &mut sqlx::SqliteConnection,
    device_id: i64,
    pv: &DevicePv,
) -> Result<(), StoreError> {
    let mut tx = sqlx::Connection::begin(conn).await?;
    let battery = pv.battery.as_ref();
    let (usable, charge, floor) =
        (battery.map(|b| b.usable_kwh), battery.and_then(|b| b.max_charge_w), battery.map(|b| b.min_soc));
    sqlx::query!(
        "INSERT OR REPLACE INTO device_pv (device_id, temp_coefficient, system_loss, battery_usable_kwh,
                                              battery_max_charge_w, battery_min_soc)
             VALUES (?, ?, ?, ?, ?, ?)",
        device_id,
        pv.temp_coefficient,
        pv.system_loss,
        usable,
        charge,
        floor
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("DELETE FROM pv_array WHERE device_id = ?", device_id).execute(&mut *tx).await?;
    for (position, a) in (0_i64..).zip(&pv.arrays) {
        sqlx::query!(
                "INSERT INTO pv_array (device_id, position, kwp, tilt, azimuth, temp_coefficient, system_loss, mppt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                device_id,
                position,
                a.kwp,
                a.tilt,
                a.azimuth,
                a.temp_coefficient,
                a.system_loss,
                a.mppt
            )
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
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

    #[tokio::test]
    async fn the_plant_settings_are_absent_until_saved_and_read_back() {
        let (store, _) = with_device().await;
        assert_eq!(store.plant_settings().await.expect("read"), None);
        let saved = PlantSettings {
            enabled: true,
            latitude: Some(-33.9),
            longitude: Some(18.4),
            label: "Kapstadt".into(),
            forecast_enabled: true,
            provider: "open-meteo".into(),
            max_output_w: Some(4600.0),
            house_load_w: Some(0.0),
            smart_meter_since: Some("2026-01-02".into()),
            correction: Correction { enabled: true },
        };
        store.save_plant_settings(&saved).await.expect("save");
        assert_eq!(store.plant_settings().await.expect("read"), Some(saved.clone()));
        store.save_plant_settings(&PlantSettings::default()).await.expect("save");
        assert_eq!(store.plant_settings().await.expect("read"), Some(PlantSettings::default()));
    }

    #[tokio::test]
    async fn a_device_pv_description_reads_back_in_order_and_a_save_replaces_it() {
        let (store, id) = with_device().await;
        let array = |kwp, mppt| PvArray {
            kwp,
            tilt: 35.0,
            azimuth: -90.0,
            device_slug: None,
            temp_coefficient: Some(-0.35),
            system_loss: None,
            mppt,
        };
        let pv = DevicePv {
            arrays: vec![array(4.0, Some(2)), array(2.5, None), array(1.0, Some(1))],
            temp_coefficient: None,
            system_loss: Some(12.0),
            battery: Some(Battery { usable_kwh: 9.6, max_charge_w: None, min_soc: 15.0 }),
        };
        store.save_device_pv(id, &pv).await.expect("save");
        assert_eq!(store.device_pv().await.expect("read"), BTreeMap::from([(id, pv)]));
        let cleared = DevicePv { arrays: vec![array(3.0, None)], ..DevicePv::default() };
        store.save_device_pv(id, &cleared).await.expect("save");
        assert_eq!(store.device_pv().await.expect("read"), BTreeMap::from([(id, cleared)]));
    }

    #[tokio::test]
    async fn the_schema_refuses_two_arrays_on_one_string_and_out_of_bound_values() {
        let (store, id) = with_device().await;
        let array = PvArray {
            kwp: 1.0,
            tilt: 0.0,
            azimuth: 0.0,
            device_slug: None,
            temp_coefficient: None,
            system_loss: None,
            mppt: Some(1),
        };
        let shared = DevicePv { arrays: vec![array.clone(), array.clone()], ..DevicePv::default() };
        assert!(store.save_device_pv(id, &shared).await.is_err());
        let steep = DevicePv { arrays: vec![PvArray { tilt: 91.0, ..array }], ..DevicePv::default() };
        assert!(store.save_device_pv(id, &steep).await.is_err());
        assert_eq!(store.device_pv().await.expect("read"), BTreeMap::new(), "nothing half-written");
        let far = PlantSettings { latitude: Some(91.0), ..PlantSettings::default() };
        assert!(store.save_plant_settings(&far).await.is_err());
    }
}
