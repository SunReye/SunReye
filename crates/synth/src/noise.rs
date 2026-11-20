//! Randomness as a pure function of the seed, a stream and a position: an instant draws the same
//! value whatever was asked before it, so the forecasts, the archive and the physics share one sky.

/// `SplitMix64`'s finaliser: a position becomes 64 well-mixed bits.
const fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// Independent draws: each quantity takes its own stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stream(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Noise {
    seed: u64,
}

impl Noise {
    #[must_use]
    pub const fn new(seed: u64) -> Self {
        Self { seed: mix(seed) }
    }

    /// Uniform in [0, 1) at `at` of `stream`.
    #[must_use]
    pub fn unit(self, stream: Stream, at: i64) -> f64 {
        let bits =
            mix(self.seed ^ mix(stream.0.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ at.cast_unsigned()));
        f64::from(u32::try_from(bits >> 32).unwrap_or(0)) / 4_294_967_296.0
    }

    /// Roughly standard normal (Irwin–Hall of four), bounded at ±3.5.
    #[must_use]
    pub fn normal(self, stream: Stream, at: i64) -> f64 {
        let sum: f64 = (0..4)
            .map(|i| self.unit(stream, at.wrapping_mul(4).wrapping_add(i)))
            .sum();
        (sum - 2.0) * 3.0_f64.sqrt()
    }

    /// Value noise in [-1, 1]: knots `period` seconds apart, cosine-interpolated between, so it
    /// drifts without steps.
    #[must_use]
    pub fn smooth(self, stream: Stream, unix: i64, period: i64) -> f64 {
        let knot = unix.div_euclid(period);
        let into = unix.rem_euclid(period);
        #[expect(clippy::cast_precision_loss, reason = "seconds within a period")]
        let fraction = into as f64 / period as f64;
        let weight = (1.0 - (fraction * std::f64::consts::PI).cos()) / 2.0;
        let at = |k: i64| self.unit(stream, k).mul_add(2.0, -1.0);
        at(knot).mul_add(1.0 - weight, at(knot + 1) * weight)
    }
}

#[cfg(test)]
mod tests {
    use super::{Noise, Stream};

    #[test]
    fn a_draw_depends_on_the_seed_stream_and_position_alone() {
        let noise = Noise::new(7);
        let first = noise.unit(Stream(1), 42);
        // Other draws in between change nothing.
        assert!(noise.unit(Stream(2), 43) < 1.0);
        assert_eq!(noise.unit(Stream(1), 42).to_bits(), first.to_bits());
        assert_ne!(Noise::new(8).unit(Stream(1), 42).to_bits(), first.to_bits());
        assert_ne!(noise.unit(Stream(2), 42).to_bits(), first.to_bits());
    }

    #[test]
    fn draws_stay_in_their_ranges() {
        let noise = Noise::new(1);
        for at in 0..10_000 {
            let unit = noise.unit(Stream(3), at);
            assert!((0.0..1.0).contains(&unit));
            assert!(noise.normal(Stream(3), at).abs() <= 3.5);
            assert!(noise.smooth(Stream(3), at, 60).abs() <= 1.0);
        }
    }

    #[test]
    fn smooth_noise_meets_its_knots_without_a_step() {
        let noise = Noise::new(1);
        let step = (0..600)
            .map(|t| (noise.smooth(Stream(4), t + 1, 60) - noise.smooth(Stream(4), t, 60)).abs())
            .fold(0.0, f64::max);
        // Two knots at most 2 apart, eased over 60 s: never more than 2·π/2/60 a second.
        assert!(step < 0.06, "{step}");
    }
}
