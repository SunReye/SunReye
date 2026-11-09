//! Car places (ADR 20): a parking footprint linked to an EVCC loadpoint, where the browser draws
//! the car while one is connected. A car casts no shade; a carport is an open block.

use serde::{Deserialize, Serialize};

use crate::{Point, Scene};

/// Metres a car's label floats above the ground.
const CLEAR: f64 = 2.5;
/// The hex digits of an uploaded body's SHA-256.
const DIGEST: usize = 64;

/// A parking footprint: its width runs along x and its length along z from its corner, before
/// it turns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarPlace {
    /// The EVCC loadpoint device's id (ADR 10).
    pub device: u32,
    pub x: f64,
    pub z: f64,
    pub width: f64,
    /// An uploaded body is scaled to it.
    pub length: f64,
    /// Degrees clockwise about the corner, seen from above.
    pub rotation: f64,
    /// The admin's pick, when no catalogue entry matches the vehicle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Body>,
    /// The uploaded GLB's id, its SHA-256 in hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// A stylised body the browser draws.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Body {
    pub class: BodyClass,
    /// `#rrggbb`.
    pub colour: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum BodyClass {
    Sedan,
    Hatchback,
    Suv,
    Van,
    Pickup,
}

/// Where a car is drawn, in the shading frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stand {
    /// The place's centre on the ground.
    pub at: Point,
    /// The horizontal unit vector its nose points along: the place's −z.
    pub forward: Point,
    /// Its label's anchor.
    pub above: Point,
}

impl Scene {
    /// Each car place's stand, in the order of `car_places`.
    ///
    /// # Errors
    /// The index of the first place without a positive size, with a colour no `#rrggbb` or a
    /// model no SHA-256 in hex.
    pub fn stands(&self) -> Result<Vec<Stand>, usize> {
        self.car_places
            .iter()
            .enumerate()
            .map(|(index, place)| self.stand(place).ok_or(index))
            .collect()
    }

    fn stand(&self, place: &CarPlace) -> Option<Stand> {
        let sized = place.width > 0.0 && place.length > 0.0;
        let coloured = place.body.as_ref().is_none_or(|b| colour(&b.colour));
        let modelled = place.model.as_deref().is_none_or(digest);
        if !(sized && coloured && modelled) {
            return None;
        }
        let frame = self.prism(place.x, place.z, place.rotation);
        let at = frame.place([place.width / 2.0, 0.0, place.length / 2.0]);
        let nose = frame.place([place.width / 2.0, 0.0, place.length / 2.0 - 1.0]);
        let [east, north, _] = at;
        Some(Stand {
            at,
            forward: [nose[0] - east, nose[1] - north, 0.0],
            above: [east, north, CLEAR],
        })
    }
}

fn colour(text: &str) -> bool {
    text.strip_prefix('#')
        .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn digest(text: &str) -> bool {
    text.len() == DIGEST && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
