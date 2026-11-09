//! The core: one process that reads devices, stores history and serves the single-page app.

pub mod api;
pub mod auth;
pub mod bus;
pub mod changes;
pub mod devices;
pub mod endpoint;
pub mod estimates;
pub mod layout;
pub mod live;
pub mod profiles;
pub mod settings;
pub mod solar;
mod spa;
pub mod startup;
pub mod storage;
pub mod transport;
pub mod weather;
