//! The device roster: connections and devices listed, added, edited, retired and removed by id. A device
//! with history is retired, never deleted: its readings and rollups refuse the delete (migration 0007).

use super::{ConnectionRow, NewConnection, NewDevice, Store, StoreError};

/// What a connection edit changes; `None` leaves the field as stored.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConnectionEdit {
    pub name: Option<String>,
    pub endpoint: Option<NewConnection>,
}

/// What a device edit changes; `None` leaves the field as stored.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceEdit {
    pub name: Option<String>,
    pub role: Option<String>,
    pub connection_id: Option<i64>,
    pub profile_id: Option<String>,
    pub unit_id: Option<u8>,
    /// `Some(None)` restores the device to service.
    pub retired_at: Option<Option<String>>,
}

/// What a removal did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Removal {
    Removed,
    Missing,
    /// A device with stored readings or rollups, or a connection with devices: nothing was deleted.
    Kept,
}

impl Store {
    pub async fn connections(&self) -> Result<Vec<ConnectionRow>, StoreError> {
        let rows = sqlx::query!(
            r#"SELECT id AS "id!", name, transport, host, port, logger_serial FROM connection ORDER BY id"#
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(ConnectionRow {
                    id: row.id,
                    name: row.name,
                    transport: row.transport.parse()?,
                    host: row.host,
                    port: super::port(row.port)?,
                    logger_serial: super::serial(row.logger_serial)?,
                })
            })
            .collect()
    }

    pub async fn create_connection(&self, name: &str, connection: &NewConnection) -> Result<i64, StoreError> {
        let transport = connection.transport.as_str();
        let row = sqlx::query!(
            r#"INSERT INTO connection (name, transport, host, port, logger_serial) VALUES (?, ?, ?, ?, ?)
               RETURNING id AS "id!""#,
            name,
            transport,
            connection.host,
            connection.port,
            connection.logger_serial
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
    }

    /// False when no connection has `id`.
    pub async fn edit_connection(&self, id: i64, edit: &ConnectionEdit) -> Result<bool, StoreError> {
        let endpoint = edit.endpoint.as_ref();
        let replace = endpoint.is_some();
        let transport = endpoint.map(|e| e.transport.as_str());
        let host = endpoint.map(|e| e.host.as_str());
        let port = endpoint.map(|e| e.port);
        let serial = endpoint.and_then(|e| e.logger_serial);
        let done = sqlx::query!(
            "UPDATE connection SET name = COALESCE(?, name), transport = COALESCE(?, transport),
               host = COALESCE(?, host), port = COALESCE(?, port),
               logger_serial = CASE WHEN ? THEN ? ELSE logger_serial END
             WHERE id = ?",
            edit.name,
            transport,
            host,
            port,
            replace,
            serial,
            id
        )
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Refused while any device, retired included, is on the connection.
    pub async fn remove_connection(&self, id: i64) -> Result<Removal, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query!(
            r#"SELECT EXISTS (SELECT 1 FROM device WHERE connection_id = ?) AS "bound!: bool",
                      EXISTS (SELECT 1 FROM connection WHERE id = ?) AS "found!: bool""#,
            id,
            id
        )
        .fetch_one(&mut *tx)
        .await?;
        let removal = match (row.found, row.bound) {
            (false, _) => Removal::Missing,
            (true, true) => Removal::Kept,
            (true, false) => {
                sqlx::query!("DELETE FROM connection WHERE id = ?", id).execute(&mut *tx).await?;
                Removal::Removed
            }
        };
        tx.commit().await?;
        Ok(removal)
    }

    pub async fn create_device(&self, device: &NewDevice, name: &str, role: &str) -> Result<i64, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO device (connection_id, profile_id, unit_id, name, role) VALUES (?, ?, ?, ?, ?)
               RETURNING id AS "id!""#,
            device.connection_id,
            device.profile_id,
            device.unit_id,
            name,
            role
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
    }

    /// False when no device has `id`.
    pub async fn edit_device(&self, id: i64, edit: &DeviceEdit) -> Result<bool, StoreError> {
        let retire = edit.retired_at.is_some();
        let retired_at = edit.retired_at.clone().flatten();
        let done = sqlx::query!(
            "UPDATE device SET name = COALESCE(?, name), role = COALESCE(?, role),
               connection_id = COALESCE(?, connection_id), profile_id = COALESCE(?, profile_id),
               unit_id = COALESCE(?, unit_id), retired_at = CASE WHEN ? THEN ? ELSE retired_at END
             WHERE id = ?",
            edit.name,
            edit.role,
            edit.connection_id,
            edit.profile_id,
            edit.unit_id,
            retire,
            retired_at,
            id
        )
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Deletes a device that never stored a reading; one with history is kept whole.
    pub async fn remove_device(&self, id: i64) -> Result<Removal, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query!(
            r#"SELECT EXISTS (SELECT 1 FROM reading_minute WHERE device_id = ?)
                      OR EXISTS (SELECT 1 FROM rollup WHERE device_id = ?) AS "history!: bool",
                      EXISTS (SELECT 1 FROM device WHERE id = ?) AS "found!: bool""#,
            id,
            id,
            id
        )
        .fetch_one(&mut *tx)
        .await?;
        let removal = match (row.found, row.history) {
            (false, _) => Removal::Missing,
            (true, true) => Removal::Kept,
            (true, false) => {
                sqlx::query!("DELETE FROM device WHERE id = ?", id).execute(&mut *tx).await?;
                Removal::Removed
            }
        };
        tx.commit().await?;
        Ok(removal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modbus::Transport;
    use crate::samples::{ClosedMinute, Sample};

    fn endpoint(host: &str, port: u16) -> NewConnection {
        NewConnection { transport: Transport::Tcp, host: host.into(), port, logger_serial: None }
    }

    async fn two_connections() -> (Store, i64, i64) {
        let store = Store::in_memory().await.expect("store");
        let first = store.create_connection("Garage", &endpoint("10.0.0.5", 502)).await.expect("first");
        let second = store.create_connection("Roof", &endpoint("gateway", 1502)).await.expect("second");
        (store, first, second)
    }

    fn device(connection_id: i64, unit_id: u8) -> NewDevice {
        NewDevice { connection_id, profile_id: "deye-sg05lp3".into(), unit_id }
    }

    async fn store_a_reading(store: &Store, device: i64) {
        let sample = Sample { at_ms: 6_000_000, values: vec![("pv".into(), 1.0)] };
        store
            .append_minute(device, &ClosedMinute { minute: 100, samples: vec![sample] })
            .await
            .expect("append");
    }

    #[tokio::test]
    async fn connections_list_in_id_order_with_their_names_and_an_unnamed_one_is_the_inverter() {
        let (store, first, second) = two_connections().await;
        let third = store.add_connection(&endpoint("stick", 8899)).await.expect("third");
        let listed = store.connections().await.expect("connections");
        let seen: Vec<_> = listed.iter().map(|c| (c.id, c.name.as_str(), c.host.as_str(), c.port)).collect();
        assert_eq!(
            seen,
            [
                (first, "Garage", "10.0.0.5", 502),
                (second, "Roof", "gateway", 1502),
                (third, "Inverter", "stick", 8899)
            ]
        );
    }

    #[tokio::test]
    async fn a_connection_edit_changes_only_what_it_names() {
        let (store, first, second) = two_connections().await;
        let renamed = ConnectionEdit { name: Some("Shed".into()), endpoint: None };
        assert!(store.edit_connection(first, &renamed).await.expect("edit"));
        let solarman = NewConnection {
            transport: Transport::SolarmanV5,
            host: "stick".into(),
            port: 8899,
            logger_serial: Some(3_168_930_341),
        };
        let moved = ConnectionEdit { name: None, endpoint: Some(solarman) };
        assert!(store.edit_connection(second, &moved).await.expect("edit"));
        let listed = store.connections().await.expect("connections");
        assert_eq!((listed[0].name.as_str(), listed[0].host.as_str()), ("Shed", "10.0.0.5"));
        assert_eq!(
            (listed[1].name.as_str(), listed[1].transport, listed[1].port, listed[1].logger_serial),
            ("Roof", Transport::SolarmanV5, 8899, Some(3_168_930_341))
        );

        let back = ConnectionEdit { name: None, endpoint: Some(endpoint("gateway", 1502)) };
        assert!(store.edit_connection(second, &back).await.expect("edit"));
        assert_eq!(
            store.connections().await.expect("connections")[1].logger_serial,
            None,
            "the serial goes too"
        );
        assert!(!store.edit_connection(99, &renamed).await.expect("edit"), "no such connection");
    }

    #[tokio::test]
    async fn a_device_is_created_with_its_name_and_role_and_an_added_one_has_neither() {
        let (store, first, second) = two_connections().await;
        let named = store.create_device(&device(first, 1), "Meter", "meter").await.expect("named");
        let added = store.add_device(&device(second, 0)).await.expect("added");
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> = devices
            .iter()
            .map(|d| (d.id, d.name.as_deref(), d.role.as_str(), d.retired_at.as_deref()))
            .collect();
        assert_eq!(seen, [(named, Some("Meter"), "meter", None), (added, None, "inverter", None)]);
        assert!(store.create_device(&device(first, 2), "Kettle", "kettle").await.is_err(), "an unknown role");
    }

    #[tokio::test]
    async fn a_device_edit_changes_only_what_it_names_and_retires_and_restores() {
        let (store, first, second) = two_connections().await;
        let id = store.create_device(&device(first, 1), "Meter", "meter").await.expect("device");
        let moved = DeviceEdit {
            connection_id: Some(second),
            unit_id: Some(7),
            retired_at: Some(Some("2026-11-03T10:00:00.000Z".into())),
            ..DeviceEdit::default()
        };
        assert!(store.edit_device(id, &moved).await.expect("edit"));
        let row = store.devices().await.expect("devices").remove(0);
        assert_eq!(
            (row.name.as_deref(), row.role.as_str(), row.connection_id, row.unit_id, row.host.as_str()),
            (Some("Meter"), "meter", second, 7, "gateway")
        );
        assert_eq!(row.retired_at.as_deref(), Some("2026-11-03T10:00:00.000Z"));

        let renamed = DeviceEdit { name: Some("Grid".into()), ..DeviceEdit::default() };
        assert!(store.edit_device(id, &renamed).await.expect("edit"));
        assert!(store.devices().await.expect("devices")[0].retired_at.is_some(), "a rename keeps it retired");
        let restored = DeviceEdit { retired_at: Some(None), ..DeviceEdit::default() };
        assert!(store.edit_device(id, &restored).await.expect("edit"));
        let row = store.devices().await.expect("devices").remove(0);
        assert_eq!((row.name.as_deref(), row.retired_at), (Some("Grid"), None));
        assert!(!store.edit_device(id + 1, &renamed).await.expect("edit"), "no such device");
    }

    #[tokio::test]
    async fn a_device_with_a_stored_reading_is_kept_whole_and_one_without_is_removed() {
        let (store, first, _) = two_connections().await;
        let recorded = store.create_device(&device(first, 1), "Inverter", "inverter").await.expect("device");
        let fresh = store.create_device(&device(first, 2), "Meter", "meter").await.expect("device");
        store_a_reading(&store, recorded).await;

        assert_eq!(store.remove_device(recorded).await.expect("remove"), Removal::Kept);
        assert_eq!(store.readings(recorded, 0, i64::MAX).await.expect("readings").len(), 1);
        assert_eq!(store.remove_device(fresh).await.expect("remove"), Removal::Removed);
        assert_eq!(store.remove_device(fresh).await.expect("remove"), Removal::Missing);
        let ids: Vec<i64> = store.devices().await.expect("devices").iter().map(|d| d.id).collect();
        assert_eq!(ids, [recorded]);
    }

    #[tokio::test]
    async fn a_connection_with_a_device_retired_or_not_is_kept_and_an_empty_one_is_removed() {
        let (store, first, second) = two_connections().await;
        let id = store.create_device(&device(first, 1), "Inverter", "inverter").await.expect("device");
        let retired =
            DeviceEdit { retired_at: Some(Some("2026-11-03T10:00:00.000Z".into())), ..DeviceEdit::default() };
        store.edit_device(id, &retired).await.expect("retire");

        assert_eq!(store.remove_connection(first).await.expect("remove"), Removal::Kept);
        assert_eq!(store.remove_connection(second).await.expect("remove"), Removal::Removed);
        assert_eq!(store.remove_connection(second).await.expect("remove"), Removal::Missing);
        let ids: Vec<i64> = store.connections().await.expect("connections").iter().map(|c| c.id).collect();
        assert_eq!(ids, [first]);
    }
}
