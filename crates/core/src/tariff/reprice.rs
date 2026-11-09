//! Reprice from date (ADR 12): a tariff version applying from the past, and the prices and
//! `cost.*` rates rebuilt from then on from stored change points, while they are retained.

use std::time::{Duration, SystemTime};

use axum::http::StatusCode;

use super::cost::replay;
use super::device::{self, DEVICE};
use super::{BAND, INTERNAL, Tariffs, Version, in_force, store, wake};
use crate::api::{Code, Problem};
use crate::bus::Series;
use crate::changes::Action;
use crate::plant;
use crate::storage::{ChangePoint, Error, RETENTION};

const RETAINED: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::TariffRetention,
};
/// Rebuilt a day at a time, so neither memory nor the storage thread is held for long.
const CHUNK: Duration = Duration::from_hours(24);
/// The plant's flows the rates price.
const FLOWS: [&str; 2] = ["grid.power", "load.power"];

impl Tariffs {
    /// Applies `version` from its date, even a past one, logged as changed at `now`, and rebuilds
    /// the prices and rates from then to `now`.
    ///
    /// # Errors
    /// It applies from before change-point retention, a band is not one span of a day or overlaps
    /// another of its flow, or the file cannot be written.
    pub async fn reprice(&self, version: Version, now: SystemTime) -> Result<Version, Problem> {
        if version.applies_from + RETENTION < now {
            return Err(RETAINED);
        }
        if !(version.import.valid() && version.export.valid()) {
            return Err(BAND);
        }
        let stored = self
            .database
            .run(move |db| store::insert(db, version, now, Action::Reprice))
            .await
            .map_err(|_| INTERNAL)?;
        self.changed.send_replace(());
        self.rebuild(stored.applies_from, now)
            .await
            .map_err(|_| INTERNAL)?;
        Ok(stored)
    }

    async fn rebuild(&self, from: SystemTime, to: SystemTime) -> Result<(), Error> {
        device::declare(self).await?;
        let versions = self.versions().await?;
        let mut start = from;
        while start < to {
            let end = (start + CHUNK).min(to);
            let prices = self.prices(&versions, start, end);
            for (series, points) in self.prices.into_iter().zip(prices.clone()) {
                self.rewriter
                    .replace(DEVICE, series, start..end, points)
                    .await?;
            }
            let [grid, load] = self.flows(start, end).await?;
            let [import, export] = &prices;
            let rates = replay([&grid, &load, import, export], start);
            for (index, series) in self.costs.into_iter().enumerate() {
                let points = rates
                    .iter()
                    .map(|&(time, rates)| ChangePoint {
                        time,
                        value: rates
                            .map(|r| [r.import, r.export, r.savings])
                            .and_then(|r| r.get(index).copied()),
                    })
                    .collect();
                self.rewriter
                    .replace(DEVICE, series, start..end, points)
                    .await?;
            }
            start = end;
        }
        Ok(())
    }

    /// The prices of `versions` from `from` to `to`, as change points.
    fn prices(
        &self,
        versions: &[Version],
        from: SystemTime,
        to: SystemTime,
    ) -> [Vec<ChangePoint>; 2] {
        let mut points: [Vec<ChangePoint>; 2] = [Vec::new(), Vec::new()];
        let mut at = from;
        while at < to {
            let prices = in_force(versions, at).map(|v| v.prices(&self.zone, at));
            let values = [prices.map(|p| p.import), prices.map(|p| p.export)];
            for (points, value) in points.iter_mut().zip(values) {
                let changed = points.last().is_none_or(|p| p.value != value);
                points.extend(changed.then_some(ChangePoint { time: at, value }));
            }
            at = wake(versions, at);
        }
        points
    }

    /// The stored change points of the plant's flows from `from` to `to`.
    async fn flows(
        &self,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<[Vec<ChangePoint>; 2], Error> {
        let mut flows = [Vec::new(), Vec::new()];
        for (points, role) in flows.iter_mut().zip(FLOWS) {
            let series = Series {
                role: role.to_owned(),
                index: None,
            };
            *points = self
                .reader
                .history(plant::DEVICE, &series, from, to)
                .await?;
        }
        Ok(flows)
    }
}
