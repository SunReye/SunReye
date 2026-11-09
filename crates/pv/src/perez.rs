//! Perez 1990 transposition, as pvlib's `get_total_irradiance(model="perez")`.

use crate::{Plane, PlaneIrradiance, Sky, Sun};

const ALBEDO: f64 = 0.25;
const SOLAR_CONSTANT: f64 = 1366.1;
const KAPPA: f64 = 1.041;

/// A clearness bin: its lower edge and coefficients F11, F12, F13, F21, F22, F23.
struct Bin(f64, [f64; 6]);

/// Perez et al. 1990, "allsitescomposite1990".
const BINS: [Bin; 8] = [
    Bin(1.0, [-0.0080, 0.5880, -0.0620, -0.0600, 0.0720, -0.0220]),
    Bin(1.065, [0.1300, 0.6830, -0.1510, -0.0190, 0.0660, -0.0290]),
    Bin(1.23, [0.3300, 0.4870, -0.2210, 0.0550, -0.0640, -0.0260]),
    Bin(1.5, [0.5680, 0.1870, -0.2950, 0.1090, -0.1520, -0.0140]),
    Bin(1.95, [0.8730, -0.3920, -0.3620, 0.2260, -0.4620, 0.0010]),
    Bin(2.8, [1.1320, -1.2370, -0.4120, 0.2880, -0.8230, 0.0560]),
    Bin(4.5, [1.0600, -1.6000, -0.3590, 0.2640, -1.1270, 0.1310]),
    Bin(6.2, [0.6780, -0.3270, -0.2500, 0.1560, -1.3770, 0.2510]),
];

/// Splits the sky's irradiance onto a plane.
#[must_use]
pub fn plane_irradiance(plane: Plane, sky: &Sky) -> PlaneIrradiance {
    let cos_aoi = cos_incidence(plane, sky.sun);

    PlaneIrradiance {
        beam: (sky.dni * cos_aoi).max(0.0),
        sky_diffuse: sky_diffuse(plane, sky, cos_aoi),
        ground_diffuse: sky.ghi * ALBEDO * (1.0 - plane.tilt.to_radians().cos()) / 2.0,
    }
}

/// The cosine of the angle between the sun and the plane's normal.
pub fn cos_incidence(plane: Plane, sun: Sun) -> f64 {
    let (tilt, zenith) = (plane.tilt.to_radians(), sun.zenith.to_radians());
    let projection = tilt.cos().mul_add(
        zenith.cos(),
        tilt.sin() * zenith.sin() * (sun.azimuth - plane.azimuth).to_radians().cos(),
    );

    projection.clamp(-1.0, 1.0)
}

fn sky_diffuse(plane: Plane, sky: &Sky, cos_aoi: f64) -> f64 {
    // Relative airmass is undefined below the horizon; pvlib yields no sky diffuse there.
    if sky.sun.zenith > 90.0 {
        return 0.0;
    }

    let z = sky.sun.zenith.to_radians();
    let kz3 = KAPPA * z.powi(3);
    let clearness = ((sky.dhi + sky.dni) / sky.dhi + kz3) / (1.0 + kz3);
    let brightness = sky.dhi * relative_airmass(sky.sun.zenith) / extraterrestrial(sky.day_of_year);

    // An undefined clearness (no light at all) falls in no bin.
    BINS.iter().rfind(|bin| clearness >= bin.0).map_or(
        0.0,
        |Bin(_, [f11, f12, f13, f21, f22, f23])| {
            let f1 = f13.mul_add(z, f12.mul_add(brightness, *f11)).max(0.0);
            let f2 = f23.mul_add(z, f22.mul_add(brightness, *f21));
            let tilt = plane.tilt.to_radians();
            let horizon_floor = 85.0_f64.to_radians().cos();
            let isotropic = 0.5 * (1.0 - f1) * (1.0 + tilt.cos());
            let circumsolar = f1 * cos_aoi.max(0.0) / z.cos().max(horizon_floor);

            (sky.dhi * f2.mul_add(tilt.sin(), isotropic + circumsolar)).max(0.0)
        },
    )
}

/// Kasten and Young 1989.
fn relative_airmass(zenith: f64) -> f64 {
    1.0 / 0.50572f64.mul_add((96.07995 - zenith).powf(-1.6364), zenith.to_radians().cos())
}

/// Spencer 1971, as pvlib's `get_extra_radiation`.
fn extraterrestrial(day_of_year: u16) -> f64 {
    let b = 2.0 * std::f64::consts::PI / 365.0 * (f64::from(day_of_year) - 1.0);
    let distance = 7.7e-05f64.mul_add(
        (2.0 * b).sin(),
        0.000_719f64.mul_add(
            (2.0 * b).cos(),
            0.00128f64.mul_add(b.sin(), 0.034_221f64.mul_add(b.cos(), 1.000_11)),
        ),
    );

    SOLAR_CONSTANT * distance
}
