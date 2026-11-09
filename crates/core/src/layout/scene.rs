//! A scene's modules decide its strings' module counts and planes (ADR 20); the browser's
//! numbers are never trusted.

use sunreye_pv::{Misplaced, Scene, Size};

use super::{ModuleType, Refusal, StringDraft};

/// Sets each draft's module counts and plane from the modules painted into it; a module names
/// its string by position in `strings`.
pub fn derive(
    scene: &Scene,
    strings: &mut [StringDraft],
    module_types: &[ModuleType],
) -> Result<(), Refusal> {
    let size = |id| {
        let datasheet = &module_types.iter().find(|m| m.id == id)?.datasheet;
        Some(Size {
            width: datasheet.width,
            height: datasheet.height,
        })
    };
    scene.mounts().map_err(|_| Refusal::Scene)?;
    let placed = scene.modules(size).map_err(|misplaced| match misplaced {
        Misplaced::Face { .. } => Refusal::Scene,
        Misplaced::ModuleType { .. } => Refusal::ModuleType,
        Misplaced::Setback { .. } => Refusal::Setback,
        Misplaced::Overlap { .. } => Refusal::Overlap,
    })?;
    let painted = scene.grids.iter().flat_map(|grid| {
        let module_type = grid.module_type;
        grid.modules
            .iter()
            .filter_map(move |m| Some((module_type, m.string?)))
    });
    for (module_type, at) in painted {
        let string = usize::try_from(at).ok().and_then(|at| strings.get(at));
        if string.is_none_or(|s| s.wiring.module_type != module_type) {
            return Err(Refusal::Scene);
        }
    }
    for (at, draft) in strings.iter_mut().enumerate() {
        let mine: Vec<_> = placed
            .iter()
            .filter(|p| p.string.and_then(|s| usize::try_from(s).ok()) == Some(at))
            .map(|p| p.module)
            .collect();
        let wiring = &mut draft.wiring;
        wiring.modules = u16::try_from(mine.len()).unwrap_or(u16::MAX);
        let optimized = mine.iter().filter(|m| m.optimized).count();
        wiring.optimized = u16::try_from(optimized).unwrap_or(u16::MAX);
        if let Some(first) = mine.first() {
            wiring.tilt = first.plane.tilt;
            wiring.azimuth = first.plane.azimuth;
        }
    }
    Ok(())
}

/// The scene with each module's string mapped; one `map` has no answer for is unassigned.
pub fn renumber(scene: &Scene, map: impl Fn(u32) -> Option<u32>) -> Scene {
    let mut scene = scene.clone();
    for module in scene.grids.iter_mut().flat_map(|g| &mut g.modules) {
        module.string = module.string.and_then(&map);
    }
    scene
}
