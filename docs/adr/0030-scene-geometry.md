# 30. Scene geometry

Status: accepted (2026-11-26)

## Context

ADR 20 grew one amendment at a time into two geometries: parametric blocks (a rectangle under one of four roofs) and traced free-form roofs, each with its own handles, naming and refusals. Items named a block by its place in a list and a wall by one of four sides, so a traced block, a split edge or a removed block renumbered what stood on it. The owner wants the base systems simple and right before more features. ADR 20 is superseded by ADRs 30 to 35; this one fixes what the scene's buildings are.

## Decision

**One geometry.** Every building is points, edges and planar faces, closed into a solid. A rectangle with a gable roof, a traced roof and a roof taken from a building model are the same thing once made. Templates, ready roofs and taking a roof from a building model are generators: they produce points, edges and faces.
- A generated building keeps its recipe (the generator and its arguments). Move, Rotate and adding items keep it; an edit of its shape or topology drops it, and the geometry is all there is.
- Regenerating from a recipe keeps the id of every element that survives.

**Building.** A building (German UI: Gebäude) is points, edges, roof faces and walls. It replaces the block.

**Parts.** A building is made of parts, each with its own wall line and roof faces. Parts touch or stack, move together with their building, and are picked alone. A garage against the house, an annex or a stepped roof are parts of one building; a separate garage or a neighbour's house is its own building. A carport is a part with open walls (ADR 35).
- *Standing on.* A part stands on the ground, the default; at a fixed height; or on a roof face, named by id, whose plane it follows.
- A part standing on or against a roof face cuts its wall line out of that face's module area, as a dormer does.

**Dormers.** A dormer is a part standing on a roof face.

**Coordinates.** Metres, right-handed: +x east, −z north, +y up. The origin is the plant's location; heights are from the ground at the origin. Faces are wound counter-clockwise seen from outside; a part's edges run counter-clockwise seen from above. Move and Rotate write into the points: a building has no transform of its own. The scene never turns to north: a 2D view turned to an eave turns its camera (ADR 32).

**Roof faces.** A roof face is a base edge and a pitch. The base edge is level, usually the eave; a Mansard roof's upper face takes its lower edge. A flat face is pitch 0 at a height.
- *Computed lines.* Ridges, hips, valleys and apexes are where the faces' planes meet; the engine computes them. Every face is exactly planar. A 1 mm tolerance applies only to fitting an imported building model.
- *Points.* A point stores its plan position (x, z) only. Its height always comes from its faces' planes.
- *Pitch.* Typing a face's pitch keeps its base edge and moves the ridge. Dragging or tracing a ridge solves the pitches of the faces that meet there.
- *A moved point* (Edit shape, ADR 31). A point on a base edge moves that edge, and its faces keep their pitch; a point on a computed line solves its faces' pitches. It is shown red, and refused, only where a face would collapse or cross itself.

**Walls and outlines.** A part's stored outline is its wall line. Its roof outline is the wall line widened by each edge's overhang. Walls close up to the roof above them, gable triangles and steps between parts included; they are derived, never drawn.
- *Eave height* is measured at the wall's top, on the wall line.

**Overhang.** Every roof-outline edge carries its own overhang: how far, measured level, the roof reaches past the wall below it. It starts at 0.5 m at an eave and 0.3 m at a verge, and is set per edge; a negative one is refused. The overhang continues its face's plane outward and down, so changing it never changes a pitch or a ridge. It shades and carries modules like the rest of its face.

**Tracing.** Tracing is an operation that creates faces. Traced on the aerial image (ADR 33), a line is the roof's edge, and the walls are set in from it by each edge's overhang.

**Permanent ids.** Points, edges, faces, parts, buildings and objects have permanent ids, never their place in a list.
- An id is an integer from one counter per scene, saved with the scene. The counter only rises, through undo too: an undo step holds the scene's state, not the counter, so no id is reused.
- A wall item (an opening, an equipment object, ADR 34) names its part, a wall-line edge by id and an offset in metres from that edge's start. An offset past the edge's end flags the item "needs a new place".
- A roof item (a module field, a roof chimney, a roof window, existing PV) names its part and roof face by id.

**Ids through topology edits.** Nothing is dropped: an item without a place is flagged "needs a new place" and kept.
- *A split edge:* the start piece keeps the id; a wall item keeps its offset, measured on the piece it stands on.
- *A deleted point* joining two edges: the first, by direction, keeps its id; the other's items are measured again on it.
- *A split face:* the larger piece keeps the id; roof items go with the piece their centre is on.
- *Merged faces:* the larger keeps its id.
- *A deleted edge or face:* its items need a new place.

**Start fresh.** Development is early, so no data is converted: scenes stored before this format are not read. The scene carries a format version field. A core refuses a scene of a version it does not know, and every field it does not know.

**One engine.** One geometry engine, in Rust, runs every operation. It holds the scene and its undo history while editing; its calls and answers are ADR 31's.
- `crates/scene`: the geometry, the operations, the ids and the file format.
- `crates/pv`: the sun, shading, the electrical model and the simulation (ADRs 17, 34); it reads the scene.
- In the browser both are one WASM artifact, built by their one glue crate, `crates/pv-wasm` (ADR 2); natively they run in Home's core.
- `@sunreye/scene` is a thin typed wrapper over it, replacing its TypeScript operations (ADR 25).

**Build order.** The core is rebuilt in Home from the ground up:
1. `crates/scene`: the geometry engine;
2. the one editor, 3D with a 2D view, on it (ADRs 31, 32);
3. shading, simulation, the electrical primitives and results (`crates/pv`, ADRs 34, 37);
4. site context (ADR 33).

Other features wait.

## Open

- **Dormer heights** (step 1). Whether a dormer's eave height is measured from the ground or from the face it stands on.
- **Roof lines** (step 1). Whether eave and verge stay stored kinds of edge or follow from the base edges.
- **Narrow parts** (step 1). A traced part narrower than its overhangs set in from both sides: refused, or its overhangs reduced to fit.
- **Shapes beyond base edge and pitch** (step 1). Which traced or imported roofs it cannot express, and what the engine does with them.
- **Resize and the recipe** (step 1). Whether Resize changes a recipe's arguments or drops it.
- **A straddling opening** (step 1). An opening across the point where its edge is split.

## Considered options

- **Blocks beside free-form roofs** (ADR 20). Replaced by one geometry.
- **Items named by list position** (ADR 20). Replaced by permanent ids: an index shifts on every insert and delete.
- **A stored bent face** (ADR 20, 2026-11-23). Replaced by always-planar faces.
- **A plane per face, point heights derived from it** (this ADR's first draft). Replaced by base edge and pitch: a face without an eave had no edge to tilt about, and a stored plane needed a tolerance.
- **A compass dial turning the scene to north** (ADR 20). Replaced by fixed axes, north along −z.
- **Operations in TypeScript in `@sunreye/scene`** (ADR 20, 2026-11-23). Replaced by one engine in Rust.
- **Converting block scenes on load, one way** (this ADR's first draft). Rejected: development is early.
- **A dormer as a loop of lines cut into its face** (ADR 20). Replaced by a part on the face.

## Consequences

A core with this format reads no scene stored before it.
