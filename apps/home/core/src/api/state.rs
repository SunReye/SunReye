//! Extracts each feature module's handler state from the shared [`Api`] (ADR 9).
//!
//! Because every route takes `State<T>` via `FromRef<App>`, the OpenAPI router and its
//! serialised document are assembled once per process and cloned per instance.

use axum::extract::FromRef;
use tokio::sync::watch;

use crate::api::{App, Clock};
use crate::auth::Auth;
use crate::backup::Backups;
use crate::cars::CarBodies;
use crate::changes::Changes;
use crate::correction::Corrections;
use crate::devices::Devices;
use crate::import::Imports;
use crate::layout::Layouts;
use crate::live::Live;
use crate::location::{Location, PlantLocation};
use crate::logs::Logs;
use crate::profiles::Profiles;
use crate::spot::SpotZone;
use crate::storage::{self, Reader, Retention, Zones};
use crate::tariff::Tariffs;
use crate::topology::Topologies;
use crate::views::Views;

macro_rules! from_api {
    ($target:ty, |$api:ident| $body:expr) => {
        impl FromRef<App> for $target {
            fn from_ref(App($api): &App) -> Self {
                $body
            }
        }
    };
}

from_api!(Auth, |api| api.auth.clone());
from_api!((Auth, Clock), |api| (
    api.auth.clone(),
    Clock::clone(&api.clock)
));
from_api!(Live, |api| api.live.clone());
from_api!(watch::Receiver<Vec<storage::Problem>>, |api| {
    api.problems.clone()
});
from_api!((Layouts, Devices, Clock), |api| (
    api.layouts.clone(),
    api.devices.clone(),
    Clock::clone(&api.clock),
));
from_api!((Reader, Clock), |api| (
    api.history.clone(),
    Clock::clone(&api.clock)
));
from_api!((Reader, watch::Receiver<jiff::tz::TimeZone>), |api| (
    api.history.clone(),
    api.storage.zones.watch(),
));
from_api!(Reader, |api| api.history.clone());
from_api!(
    (Reader, watch::Receiver<jiff::tz::TimeZone>, Clock),
    |api| (
        api.history.clone(),
        api.storage.zones.watch(),
        Clock::clone(&api.clock),
    )
);
from_api!((Reader, Devices, Layouts), |api| (
    api.history.clone(),
    api.devices.clone(),
    api.layouts.clone(),
));
from_api!((Corrections, watch::Receiver<Option<Location>>), |api| (
    api.corrections.clone(),
    api.location.watch()
));
from_api!((Topologies, Reader), |api| (
    api.topologies.clone(),
    api.history.clone()
));
from_api!((Topologies, Devices, Clock), |api| (
    api.topologies.clone(),
    api.devices.clone(),
    Clock::clone(&api.clock),
));
from_api!((Devices, Clock), |api| (
    api.devices.clone(),
    Clock::clone(&api.clock)
));
from_api!((Tariffs, Clock), |api| (
    api.tariffs.clone(),
    Clock::clone(&api.clock)
));
from_api!(Changes, |api| api.changes.clone());
from_api!(CarBodies, |api| api.cars.clone());
from_api!((Views, Clock), |api| (
    api.views.clone(),
    Clock::clone(&api.clock)
));
from_api!((PlantLocation, Clock), |api| (
    api.location.clone(),
    Clock::clone(&api.clock)
));
from_api!((SpotZone, Clock), |api| (
    api.spot.clone(),
    Clock::clone(&api.clock)
));
from_api!((Zones, Clock), |api| (
    api.storage.zones.clone(),
    Clock::clone(&api.clock)
));
from_api!((Retention, Clock), |api| (
    api.storage.retention.clone(),
    Clock::clone(&api.clock)
));
from_api!((Profiles, Clock), |api| (
    api.profiles.clone(),
    Clock::clone(&api.clock)
));
from_api!(Imports, |api| api.imports.clone());
from_api!(Backups, |api| api.backups.clone());
from_api!(Logs, |api| api.logs.clone());
from_api!((Layouts, Clock), |api| (
    api.layouts.clone(),
    Clock::clone(&api.clock)
));
