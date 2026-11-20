//! The `pv` model over the plant's layout at knots ten minutes apart, run on every core: the
//! physics scales a knot to the irradiance of each poll.

use sunreye_pv as pv;

use crate::home::Input;
use crate::plant::STRING_COUNT;
use crate::sky::Sky;

/// Seconds between knots.
pub const KNOT: i64 = 600;

/// The plant's wiring as the `pv` model takes it, with each inverter's AC rating.
#[derive(Debug, Clone)]
pub struct Wiring {
    pub layout: pv::Layout,
    pub ratings: [f64; 2],
}

/// The model's output under one weather instant: each inverter's MPPT inputs and each string's
/// DC power, in the layout's string order.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Knot {
    /// W/m² the model ran under.
    pub ghi: f64,
    pub inputs: [[Input; 2]; 2],
    pub strings: [f64; STRING_COUNT],
}

impl Knot {
    /// The model under `weather`; dark without global irradiance.
    #[must_use]
    pub fn of(wiring: &Wiring, weather: &pv::Weather) -> Self {
        let mut knot = Self {
            ghi: weather.ghi,
            ..Self::default()
        };
        if weather.ghi <= 0.0 {
            return knot;
        }
        let estimate = pv::estimate(&wiring.layout, weather);
        let inputs = estimate.inverters.iter().map(|i| &i.inputs);
        for (inverter, modelled) in knot.inputs.iter_mut().zip(inputs) {
            for (input, model) in inverter.iter_mut().zip(modelled) {
                *input = Input {
                    power: model.power,
                    voltage: model.voltage,
                    current: model.current,
                };
            }
        }
        let strings = estimate
            .inverters
            .iter()
            .flat_map(|i| &i.inputs)
            .flat_map(|i| &i.strings);
        for (string, power) in knot.strings.iter_mut().zip(strings) {
            *string = *power;
        }
        knot
    }
}

/// Knots from a start, in time order.
#[derive(Debug, Clone, Default)]
pub struct Model {
    from: i64,
    knots: Vec<Knot>,
}

impl Model {
    /// The model under the measured sky at every knot from `from` to `to`, split over the
    /// machine's cores.
    #[must_use]
    pub fn run(wiring: &Wiring, sky: Sky, from: i64, to: i64) -> Self {
        let from = from.div_euclid(KNOT) * KNOT;
        let count = usize::try_from((to - from).div_euclid(KNOT) + 2).unwrap_or(0);
        let knots = parallel(count, |i| {
            let at = from + i64::try_from(i).unwrap_or(0) * KNOT;
            Knot::of(wiring, &sky.at(at).weather())
        });
        Self { from, knots }
    }

    /// The knot at or before `unix`; dark outside the span.
    #[must_use]
    pub fn at(&self, unix: i64) -> Knot {
        usize::try_from((unix - self.from).div_euclid(KNOT))
            .ok()
            .and_then(|i| self.knots.get(i))
            .copied()
            .unwrap_or_default()
    }
}

/// `make` of every index below `count`, in order, computed on every core.
pub fn parallel<T: Send + Default + Clone>(
    count: usize,
    make: impl Fn(usize) -> T + Sync,
) -> Vec<T> {
    let threads = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    let mut out = vec![T::default(); count];
    let size = count.div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        for (chunk, part) in out.chunks_mut(size).enumerate() {
            let make = &make;
            scope.spawn(move || {
                part.iter_mut()
                    .enumerate()
                    .for_each(|(i, slot)| *slot = make(chunk * size + i));
            });
        }
    });
    out
}
