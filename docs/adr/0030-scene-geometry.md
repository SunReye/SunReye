# 30. Scene geometry

Status: accepted (2026-11-26)

## Context

ADR 20 grew one amendment at a time into two geometries: parametric blocks (a rectangle under one of four roofs) and traced free-form roofs, each with its own handles, naming and refusals. Items named a block by its place in a list and a wall by one of four sides, so a traced block, a split edge or a removed block renumbered what stood on it. The owner wants the base systems simple and right before more features. ADR 20 is superseded by ADRs 30 to 35; this one fixes what the scene's buildings are.

## Decision

**One geometry.** Every building is points, edges and planar faces, closed into a solid. A rectangle with a gable roof, a traced roof and a roof taken from a building model are the same thing once made. Templates, ready roofs and taking a roof from a building model are generators: they produce points, edges and faces. A generated building keeps its recipe (the generator and its arguments) until it is edited by hand; then the recipe is dropped and the geometry is all there is.

**Building.** A building (German UI: Gebäude) is points, edges, roof faces and walls. A wall is a footprint edge raised to the eave. It replaces the block.

**Parts.** A building is made of parts, each with its own footprint, eave and roof faces. Parts touch or stack, move together with their building, and are picked alone. A garage against the house, an annex or a stepped roof are parts of one building; a separate garage or a neighbour's house is its own building.

**Heights.** Points carry heights; they are the truth, and pitches are derived from them.
- Setting a face's pitch keeps its eave and moves its ridge points. Faces sharing those points keep their pitch by sliding the ridge horizontally where that is possible; where it is not, they take the new height and show the pitch that results.
- Nothing answers "not possible": the editor shows the result.

**Planar faces.** A face is always planar. A moved point follows the planes of the faces it belongs to. A move no plane allows is shown red while dragging and rolled back on release, with the reason. A bent face is no longer a stored state; ADR 20's *Bent* face goes.

**Permanent ids.** Points, edges, faces, parts, buildings and objects have permanent ids, never their place in a list.
- A wall item (an opening, an equipment object, ADR 34) names its part, a footprint edge by id and a fraction along it. A roof item (a module field, a roof chimney, a roof window, existing PV) names its part and roof face by id.
- Splitting an edge keeps each item on the piece it stands on. Deleting an edge flags its items "needs a new place"; they are kept, not dropped.

**Start fresh.** Development is early, so no data is converted: scenes stored before this format are not read. The scene carries a format version field. A core refuses a scene of a version it does not know, and every field it does not know.

**One engine.** One geometry engine, in Rust, runs every operation, in a new crate, `crates/scene`: in the browser as WASM and natively in Home's core. `@sunreye/scene` is a thin typed wrapper over it, replacing its TypeScript operations (ADR 25). The `pv` crate builds on it and shades with the faces and solids it produces.

**Overhang.** Each eave edge carries its own overhang: how far, measured level, the roof reaches past the wall below it.

**Dormers.** A dormer is a part standing on a roof face.

**Build order.** The core is rebuilt in Home from the ground up:
1. `crates/scene`: the geometry engine with permanent ids, buildings and parts, operations and planar faces;
2. shading and simulation on it (`crates/pv`);
3. the one editor, 3D with a 2D view, on it (ADRs 31, 32);
4. site context (ADR 33).

Other features wait.

## Open

- **Gables.** How a wall reaches above the eave under a gable or a stepped part.
- **Verges.** Whether a verge edge carries an overhang as an eave edge does; ADR 35 keeps ADR 20's verge overhang until settled.
- **Roof lines.** Whether eave, ridge, hip, valley and verge stay stored kinds of edge, as ADR 20's tracing kept them, or are derived from the faces.

## Considered options

- **Blocks beside free-form roofs** (ADR 20). Replaced by one geometry.
- **Items named by list position** (ADR 20). Replaced by permanent ids: an index shifts on every insert and delete.
- **A stored bent face** (ADR 20, 2026-11-23). Replaced by always-planar faces.
- **Operations in TypeScript in `@sunreye/scene`** (ADR 20, 2026-11-23). Replaced by one engine in Rust.
- **Converting block scenes on load, one way** (this ADR's first draft). Rejected: development is early.
- **A dormer as a loop of lines cut into its face** (ADR 20). Replaced by a part on the face.

## Consequences

A core with this format reads no scene stored before it.
