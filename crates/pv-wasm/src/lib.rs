//! WASM exports of the `pv` crate for the browser (ADR 2, 20).
//!
//! Strings cross as UTF-8 in linear memory: the host writes into a buffer from `reserve`, a call
//! returns `ptr << 32 | len` of a JSON reply, `{"ok": …}` or `{"error": "…"}`, and the host hands
//! every buffer back to `release`.

mod clear;
mod edit;

use std::collections::HashMap;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sunreye_pv::{
    COLD, Face, Footing, Location, Misplaced, ModuleGrid, Occluder, RoofFace, Scene, Size, Surface,
    WallFrame, open_circuit_voltage, sun_position,
};

/// The faces, solids, equipment mounts, car stands, ground surfaces, fences and openings of a
/// scene, in the shading frame: east, north, up. The mounts are `null` while a marker lies off its
/// wall, the stands while a car place is refused, the ground, the fences and the openings while
/// one of theirs is.
fn geometry(scene: &[u8]) -> String {
    match serde_json::from_slice::<Scene>(scene) {
        Ok(scene) => json!({ "ok": {
            "faces": scene.faces().iter().map(face).collect::<Vec<_>>(),
            "solids": scene.solids().iter().map(solid).collect::<Vec<_>>(),
            "mounts": scene.mounts().ok().map(|mounts| {
                mounts.iter().map(|m| json!({ "at": m.at, "above": m.above })).collect::<Vec<_>>()
            }),
            "stands": scene.stands().ok().map(|stands| {
                stands.iter().map(|s| json!({ "at": s.at, "forward": s.forward, "above": s.above }))
                    .collect::<Vec<_>>()
            }),
            "ground": scene.ground().ok().map(|ground| {
                ground.iter().map(|g| json!({ "finish": g.finish, "corners": g.corners }))
                    .collect::<Vec<_>>()
            }),
            "fences": scene.fencing().ok().map(|fences| {
                fences.iter().map(|f| json!({
                    "finish": f.finish, "height": f.height, "points": f.points,
                })).collect::<Vec<_>>()
            }),
            "openings": scene.fitted().ok().map(|fitted| {
                fitted.iter().map(|f| json!({ "kind": f.kind, "corners": f.corners, "out": f.out }))
                    .collect::<Vec<_>>()
            }),
        }}),
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

/// A scene and the size of each module type its grids name, by id.
#[derive(Deserialize)]
struct Gridded {
    scene: Scene,
    sizes: HashMap<u32, Size>,
}

/// The roof faces, each grid laid out on its face, the first misplaced module, and what the
/// builder's handles stand on: every block's walls and every chimney's footing, `null` for one
/// that names no roof face.
fn modules(input: &[u8]) -> String {
    let Gridded { scene, sizes } = match serde_json::from_slice(input) {
        Ok(gridded) => gridded,
        Err(error) => return json!({ "error": error.to_string() }).to_string(),
    };
    let roofs = scene.roofs();
    let grids: Vec<Value> = scene
        .grids
        .iter()
        .map(|grid| {
            let face = roofs
                .iter()
                .find(|r| (r.block, r.face) == (grid.block, grid.face));
            match (face, sizes.get(&grid.module_type)) {
                (Some(face), Some(size)) => laid(face, grid, *size),
                _ => Value::Null,
            }
        })
        .collect();
    let misplaced = scene
        .modules(|id| sizes.get(&id).copied())
        .err()
        .map(|at| misplaced(at, &scene.grids, &sizes));
    json!({ "ok": {
        "roofs": roofs.iter().map(roof).collect::<Vec<_>>(),
        "grids": grids,
        "misplaced": misplaced,
        "walls": scene.walls().iter().map(walls).collect::<Vec<_>>(),
        "footings": scene.footings().iter().map(|f| f.as_ref().map(footing)).collect::<Vec<_>>(),
    }})
    .to_string()
}

/// A grid on its face: each module's footprint, the face's outline and that outline inside the
/// setback, corner for corner and `null` where none is left, and the chimneys' footprints.
fn laid(face: &RoofFace, grid: &ModuleGrid, size: Size) -> Value {
    let modules: Vec<Value> = grid
        .modules
        .iter()
        .map(|module| {
            let area = grid.footprint(size, module.spot);
            json!({ "area": area, "corners": face.corners(area) })
        })
        .collect();
    let ring =
        |outline: &[[f64; 2]]| -> Vec<_> { outline.iter().map(|p| face.point(*p)).collect() };
    json!({
        "modules": modules,
        "outline": ring(&face.outline),
        "inset": face.inset(grid.setback).map(|inset| ring(&inset)),
        "blocked": face.chimneys.iter().map(|area| face.corners(*area)).collect::<Vec<_>>(),
    })
}

/// An instant and a place, as `sun` takes them.
#[derive(Deserialize)]
struct Instant {
    unix: i64,
    location: Place,
}

#[derive(Deserialize, Clone, Copy)]
pub struct Place {
    latitude: f64,
    longitude: f64,
}

impl From<Place> for Location {
    fn from(
        Place {
            latitude,
            longitude,
        }: Place,
    ) -> Self {
        Self {
            latitude,
            longitude,
        }
    }
}

/// The sun's zenith and azimuth (ADR 17) at an instant over a place.
fn sun(input: &[u8]) -> String {
    match serde_json::from_slice::<Instant>(input) {
        Ok(Instant { unix, location }) => {
            let sun = sun_position(unix, location.into());
            json!({ "ok": { "zenith": sun.zenith, "azimuth": sun.azimuth } })
        }
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

/// Each string's watts under a clear sky at each of the run's times, by string position.
fn clear_sky(input: &[u8]) -> String {
    match serde_json::from_slice::<clear::Run>(input) {
        Ok(run) => json!({ "ok": run.watts() }),
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

fn roof(face: &RoofFace) -> Value {
    json!({
        "block": face.block, "face": face.face, "tilt": face.plane.tilt,
        "azimuth": face.plane.azimuth, "outline": face.outline,
        "origin": face.origin, "across": face.across, "up": face.up,
    })
}

fn walls([front, right, back, left]: &[WallFrame; 4]) -> Value {
    let wall = |w: &WallFrame| json!({ "left": w.left, "right": w.right, "out": w.out });
    json!({ "front": wall(front), "right": wall(right), "back": wall(back), "left": wall(left) })
}

fn footing(footing: &Footing) -> Value {
    json!({ "foot": footing.foot, "top": footing.top })
}

/// The reply to an edit read from `input`.
fn edited<T: DeserializeOwned>(input: &[u8], reply: impl Fn(&T) -> Value) -> String {
    match serde_json::from_slice::<T>(input) {
        Ok(edit) => json!({ "ok": reply(&edit) }),
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

/// The first misplaced module, with its footprint on the face, so the browser shows it there.
fn misplaced(misplaced: Misplaced, grids: &[ModuleGrid], sizes: &HashMap<u32, Size>) -> Value {
    let (kind, grid, module) = match misplaced {
        Misplaced::Face { grid } => return json!({ "kind": "face", "grid": grid }),
        Misplaced::ModuleType { grid } => return json!({ "kind": "moduleType", "grid": grid }),
        Misplaced::Setback { grid, module } => ("setback", grid, module),
        Misplaced::Overlap { grid, module } => ("overlap", grid, module),
        Misplaced::Chimney { grid, module } => ("chimney", grid, module),
    };
    let area = grids
        .get(grid)
        .and_then(|g| Some(g.footprint(*sizes.get(&g.module_type)?, g.modules.get(module)?.spot)));
    json!({ "kind": kind, "grid": grid, "module": module, "area": area })
}

/// Module types and strings, as `cold_voltages` takes them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sized {
    module_types: Vec<clear::Datasheet>,
    strings: Vec<clear::Wiring>,
}

/// Each string's open-circuit voltage at −10 °C, by position; null for an unknown module type.
fn cold_voltages(input: &[u8]) -> String {
    match serde_json::from_slice::<Sized>(input) {
        Ok(Sized {
            module_types,
            strings,
        }) => {
            let volts: Vec<Option<f64>> = strings
                .iter()
                .map(|w| {
                    let datasheet = module_types.iter().find(|d| d.id == w.module_type)?;
                    Some(open_circuit_voltage(&datasheet.model(), w.modules, COLD))
                })
                .collect();
            json!({ "ok": volts })
        }
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

fn face(face: &Face) -> Value {
    let surface = match face.surface {
        Surface::Wall => "wall",
        Surface::Roof => "roof",
        Surface::Obstacle => "obstacle",
        Surface::Hedge => "hedge",
        Surface::Chimney => "chimney",
    };
    face.colour.as_ref().map_or_else(
        || json!({ "surface": surface, "corners": face.corners }),
        |colour| json!({ "surface": surface, "corners": face.corners, "colour": colour }),
    )
}

fn solid(occluder: &Occluder) -> Value {
    match *occluder {
        Occluder::Triangle(corners) => json!({ "kind": "triangle", "corners": corners }),
        Occluder::Sphere { centre, radius } => {
            json!({ "kind": "sphere", "centre": centre, "radius": radius })
        }
        Occluder::Cylinder {
            base,
            radius,
            height,
        } => json!({ "kind": "cylinder", "base": base, "radius": radius, "height": height }),
        Occluder::Cone {
            base,
            radius,
            height,
        } => json!({ "kind": "cone", "base": base, "radius": radius, "height": height }),
    }
}

#[expect(
    unsafe_code,
    reason = "WASM exports need unmangled symbols and raw buffers"
)]
mod exports {
    use std::ptr::slice_from_raw_parts_mut;

    /// A zeroed buffer of `len` bytes for the host to write into.
    #[unsafe(no_mangle)]
    pub extern "C" fn reserve(len: usize) -> *mut u8 {
        Box::into_raw(vec![0_u8; len].into_boxed_slice()).cast()
    }

    /// Returns a buffer from `reserve` or a reply.
    ///
    /// # Safety
    /// `ptr` and `len` name one live buffer this module handed out, freed once.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn release(ptr: *mut u8, len: usize) {
        // SAFETY: the caller passes back a boxed slice this module leaked, exactly once.
        drop(unsafe { Box::from_raw(slice_from_raw_parts_mut(ptr, len)) });
    }

    /// # Safety
    /// `scene`/`scene_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn geometry(scene: *const u8, scene_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let scene = unsafe { std::slice::from_raw_parts(scene, scene_len) };
        leak(super::geometry(scene))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn modules(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::modules(input))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn sun(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::sun(input))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn clear_sky(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::clear_sky(input))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn cold_voltages(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::cold_voltages(input))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn refit(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Refit::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn place(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Place::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn glide(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Glide::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn chimney_at(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Strike::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn lay(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Lay::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn slide(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Slide::reply))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn fill(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Laid::fill))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn covered(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Laid::covered))
    }

    /// # Safety
    /// `input`/`input_len` name a live buffer from `reserve`.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn grid_at(input: *const u8, input_len: usize) -> u64 {
        // SAFETY: the caller guarantees the buffer, written through `reserve`.
        let input = unsafe { std::slice::from_raw_parts(input, input_len) };
        leak(super::edited(input, super::edit::Strike::grid))
    }

    /// Hands a reply to the host as `ptr << 32 | len`; the host releases it.
    fn leak(reply: String) -> u64 {
        let bytes = reply.into_bytes().into_boxed_slice();
        let len = u64::try_from(bytes.len()).unwrap_or(0);
        let ptr = u64::try_from(Box::into_raw(bytes).cast::<u8>().addr()).unwrap_or(0);
        ptr << 32 | len
    }
}
