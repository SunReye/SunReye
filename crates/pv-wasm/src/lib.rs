//! WASM exports of the `pv` crate for the browser (ADR 2, 20).
//!
//! Strings cross as UTF-8 in linear memory: the host writes into a buffer from `reserve`, a call
//! returns `ptr << 32 | len` of a JSON reply, `{"ok": …}` or `{"error": "…"}`, and the host hands
//! every buffer back to `release`.

use serde_json::{Value, json};
use sunreye_pv::{Face, Occluder, Scene, Surface};

/// The faces and solids of a scene, in the shading frame: east, north, up.
fn geometry(scene: &[u8]) -> String {
    match serde_json::from_slice::<Scene>(scene) {
        Ok(scene) => json!({ "ok": {
            "faces": scene.faces().iter().map(face).collect::<Vec<_>>(),
            "solids": scene.solids().iter().map(solid).collect::<Vec<_>>(),
        }}),
        Err(error) => json!({ "error": error.to_string() }),
    }
    .to_string()
}

fn face(face: &Face) -> Value {
    let surface = match face.surface {
        Surface::Wall => "wall",
        Surface::Roof => "roof",
        Surface::Obstacle => "obstacle",
    };
    json!({ "surface": surface, "corners": face.corners })
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

    /// Hands a reply to the host as `ptr << 32 | len`; the host releases it.
    fn leak(reply: String) -> u64 {
        let bytes = reply.into_bytes().into_boxed_slice();
        let len = u64::try_from(bytes.len()).unwrap_or(0);
        let ptr = u64::try_from(Box::into_raw(bytes).cast::<u8>().addr()).unwrap_or(0);
        ptr << 32 | len
    }
}
