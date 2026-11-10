//! The core: one process that reads devices, stores history and serves the single-page app.

pub mod api;
pub mod auth;
pub mod backup;
pub mod bus;
pub mod capture;
pub mod cars;
pub mod changes;
pub mod correction;
pub mod devices;
pub mod endpoint;
pub mod estimates;
pub mod http;
pub mod identity;
pub mod import;
pub mod layout;
pub mod live;
pub mod location;
pub mod logs;
pub mod mqtt;
pub mod plant;
pub mod profiles;
pub mod publisher;
pub mod retention;
pub mod scan;
pub mod settings;
pub mod solar;
mod spa;
pub mod spot;
pub mod startup;
pub mod storage;
pub mod subscriber;
pub mod sunspec;
pub mod tariff;
pub mod topology;
pub mod transport;
pub mod weather;
pub mod zone;

/// Locks `mutex`. A panic while it was held is already logged, and what it guards stays usable,
/// so poison is ignored.
pub(crate) fn lock<T: ?Sized>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Reads `lock`, poison ignored as [`lock`] ignores it.
pub(crate) fn read<T: ?Sized>(lock: &std::sync::RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Writes `lock`, poison ignored as [`lock`] ignores it.
pub(crate) fn write<T: ?Sized>(lock: &std::sync::RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
