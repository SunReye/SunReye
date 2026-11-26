# 30. Scene geometry

Status: accepted (2026-11-26)

## Context

ADR 20 grew one amendment at a time into two geometries: parametric blocks (a rectangle under one of four roofs) and traced free-form roofs, each with its own handles, naming and refusals. Items named a block by its place in a list and a wall by one of four sides, so a traced block, a split edge or a removed block renumbered what stood on it. The owner wants the base systems simple and right before more features. ADR 20 is superseded by ADRs 30 to 35; this one fixes what the scene's buildings are.

## Decision

**One geometry.** Every building is points, edges and planar faces, closed into a solid. A rectangle with a gable roof, a traced roof and a roof taken from a building model are the same thing once made. Templates, ready roofs and taking a roof from a building model are generators: they produce points, edges and faces.
- A generated building keeps its recipe (the generator and its arguments). Move, Rotate and adding items keep it; an edit of its shape or topology drops it, and the geometry is all there is.
- Regenerating from a recipe keeps the id of every element that survives.

**Building.** A building (German UI: Gebäude) is points, edges, roof faces and walls. It replaces the block.

**Parts.** A building is made of parts, each with its own footprint, eave and roof faces. Parts touch or stack, move together with their building, and are picked alone. A garage against the house, an annex or a stepped roof are parts of one building; a separate garage or a neighbour's house is its own building. A part standing on or against a roof face cuts its footprint out of that face's module area, as a dormer does.

**Dormers.** A dormer is a part standing on a roof face.

**Coordinates.** Metres, right-handed, Y up. The origin is the plant's location; heights are from the ground at the origin. Faces are wound counter-clockwise seen from outside. Move and Rotate write into the points: a building has no transform of its own.

**Planes.** Each roof face stores one plane; a point's height is derived from the planes of its faces. A face is planar within 1 mm. No bent face is stored.
- *Pitch.* Setting a face's pitch keeps its eave and moves its ridge. Faces sharing that ridge keep their pitch by sliding it horizontally where that is possible; where it is not, they take the new height and show the pitch that results. A pitch edit never answers "not possible": the editor shows the result.
- *A moved point.* Moving a point (Edit shape, ADR 31) tilts the faces around it about their eave edges. It is shown red, and refused, only where a face would collapse or cross itself.

**Walls and outlines.** A part's stored outline is its wall line. Its roof outline is the wall line widened by each eave edge's overhang. Walls close up to the roof above them, gable triangles and steps between parts included; they are derived, never drawn.

**Overhang.** Each eave edge carries its own overhang: how far, measured level, the roof reaches past the wall below it. It starts at 0.5 m and is set per edge; a negative one is refused. The overhang shades and carries modules like the rest of its face.

**Tracing.** Tracing is an operation that creates faces. Traced on the aerial image (ADR 33), a line is the roof's edge, and the walls are set in from it by each eave edge's overhang.

**Permanent ids.** Points, edges, faces, parts, buildings and objects have permanent ids, never their place in a list.
- An id is an integer from one counter per scene, saved with the scene and never reused. Redo gives back the same ids.
- A wall item (an opening, an equipment object, ADR 34) names its part, a footprint edge by id and an offset in metres from that edge's start corner. An offset past the edge's end flags the item "needs a new place".
- A roof item (a module field, a roof chimney, a roof window, existing PV) names its part and roof face by id.
- Splitting an edge moves each item to the piece it stands on, its offset measured from that piece's start. Deleting an edge flags its items "needs a new place"; they are kept, not dropped.

**Start fresh.** Development is early, so no data is converted: scenes stored before this format are not read. The scene carries a format version field. A core refuses a scene of a version it does not know, and every field it does not know.

**One engine.** One geometry engine, in Rust, runs every operation. It holds the scene and its undo history while editing (ADR 31).
- `crates/scene`: the geometry, the operations, the ids and the file format.
- `crates/pv`: the sun, shading, the electrical model and the simulation (ADRs 17, 34); it reads the scene.
- In the browser both are one WASM artifact, built by their one glue crate, `crates/pv-wasm` (ADR 2); natively they run in Home's core.
- `@sunreye/scene` is a thin typed wrapper over it, replacing its TypeScript operations (ADR 25).

**Build order.** The core is rebuilt in Home from the ground up:
1. `crates/scene`: the geometry engine;
2. the one editor, 3D with a 2D view, on it (ADRs 31, 32);
3. shading, simulation and the electrical primitives (`crates/pv`, ADR 34);
4. site context (ADR 33).

Other features wait.

## Open

- **Verges.** Whether a verge edge carries an overhang as an eave edge does; ADR 20 gave verges one of their own, 0.3 m to start.
- **Dormer heights.** How a dormer's points stand on its face; ADR 20 kept them on the face's plane until set, never below it.
- **Standing on.** How a part standing on another part or on a roof face is stored: a base height, or the id of the face it stands on.
- **Roof lines.** Whether eave, ridge, hip, valley and verge stay stored kinds of edge, as ADR 20's tracing kept them, or are derived from the faces.
- **A point's own height.** How a height set on one point (ADR 35, *Pulling up*) is kept when heights come from the faces' planes, and whether a later pull leaves it.
- **Edge direction.** Which corner of an edge is its start.
- **Resize and the recipe.** Whether Resize changes a recipe's arguments or drops it.
- **Ids through topology edits.** Which piece of a split edge keeps its id; which id survives a deleted point that merges two edges; how faces split, merged or deleted pass on their roof items (re-homed or "needs a new place"); an opening that straddles a split.

## Considered options

- **Blocks beside free-form roofs** (ADR 20). Replaced by one geometry.
- **Items named by list position** (ADR 20). Replaced by permanent ids: an index shifts on every insert and delete.
- **A stored bent face** (ADR 20, 2026-11-23). Replaced by always-planar faces.
- **Operations in TypeScript in `@sunreye/scene`** (ADR 20, 2026-11-23). Replaced by one engine in Rust.
- **Converting block scenes on load, one way** (this ADR's first draft). Rejected: development is early.
- **A dormer as a loop of lines cut into its face** (ADR 20). Replaced by a part on the face.

## Consequences

A core with this format reads no scene stored before it.
