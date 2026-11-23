# @sunreye/scene

SunReye's scene and layout types, generated from the crates, and the pure operations both products run on a scene (ADRs 20, 25). Plain JavaScript with its types beside it: no build step, no browser, no 3D library.

## Types

`Scene`, `Layout`, `LayoutChange`, `ModuleType` and every type they name, as the core's API reads and writes them. `schema.d.ts` and `scene-schema.js` are generated; `bun run --cwd apps/web api` rewrites them.

- `roofFaceKey(face)`, `RoofFaceId`: one key for a roof face, by block and face, however it was picked.
- `SCENE_SCHEMA`: the scene's JSON Schema (2020-12), generated with the types: `$ref` to `$defs.Scene`, every field the core knows and no other. Number widths are left out, so a validator needs no custom formats.
- `SCENE_SCHEMA_VERSION`: the package version the schema was generated at. A scene carries no version of its own (ADR 25); the plant document's version gates one in transit (ADR 26).

## Tracing a roof

A traced roof is a free-form block whose `freeForm.traced` keeps its points (x, y, z; y its height now), the points whose height was set, its lines (pairs of points) and, per face, the points its corners are. The lines are the source; the faces are derived. Each operation takes a scene and returns the next one, so a consumer may run it in the browser or where it keeps the scene.

- `snap(scene, click, reach): Snap`: what a click (`{ x, z, height? }`, metres) snaps to within `reach` metres seen from above: `{ kind: "point", block, point, at }`, `{ kind: "line", block, line, at }`, or `{ kind: "free", at }`. A point wins over a line.
- `addLine(scene, from, to, reach): Edited`: a line between two ends, each a click (snapped) or a traced point (`{ block, point }`). It splits the line a click snaps onto and every line it crosses, adding points but no line. A line touching no traced block starts a new one; one joining two is refused (`"joins"`), as is one of no length (`"short"`). Chaining clicks passes the answer's `{ block, point: to }` as the next `from`.
- `moveLine(scene, block, line, { x, z }): Edited`: moves a line level, its points with it; refused (`"crosses"`) when lines would cross.
- `removeLine(scene, block, line): Edited`: removes a line and the points no line uses; a block left without lines goes, and what named a later block moves up.
- `loops(points, lines): number[][]`: the closed loops seen from above, counter-clockwise, as point indices.
- `Edited` is `{ scene, block, from, to }` or `{ refused }`, with `Refusal` one of `"short"`, `"joins"`, `"crosses"`, `"missing"`.

After every edit the block's faces are derived again. A loop keeping three or more of an old face's points stays that face, at its index, with its module grid, roof chimneys, roof windows and face details; of two such loops the one keeping more points stays it, then the larger. Other loops are new faces after them. A face whose loop went takes what stood on it, and later faces move up with theirs. A click on plain ground lands at height 0; one bringing a `height` (a surface that carries heights) sets its point's height.

Pulling up, a point's height, ready shapes and dormers join this module, each an edit of a block's lines whose faces `rebuild` derives (`roof-faces.js`).

## Face details

`Scene.faceDetails` holds what is known of a roof face beyond its shape, named by block and face as a grid is: its `covering` (`tiles`, `slate`, `metal`, `bitumen`; unknown without one) and `pitchConfirmed` (estimated without it). At most one per face.
