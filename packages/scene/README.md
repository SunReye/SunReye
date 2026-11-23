# @sunreye/scene

SunReye's scene and layout types, generated from the crates, and the pure operations both products run on a scene (ADRs 20, 25). Plain JavaScript with its types beside it: no build step, no browser, no 3D library.

## Types

`Scene`, `Layout`, `LayoutChange`, `ModuleType` and every type they name, as the core's API reads and writes them. `schema.d.ts` and `scene-schema.js` are generated; `bun run --cwd apps/web api` rewrites them.

- `roofFaceKey(face)`, `RoofFaceId`: one key for a roof face, by block and face, however it was picked.
- `SCENE_SCHEMA`: the scene's JSON Schema (2020-12), generated with the types: `$ref` to `$defs.Scene`, every field the core knows and no other. Number widths are left out; it uses only JSON Schema's own keywords.
- `SCENE_SCHEMA_VERSION`: the package version the schema was generated at. A scene carries no version of its own (ADR 25); the plant document's version gates one in transit (ADR 26).

## Tracing a roof

A traced roof is a free-form block whose `freeForm.traced` keeps its points (x, y, z; y its height now), the points whose height was set, its lines (pairs of points) and, per face, the points its corners are. The lines are the source; the faces are derived. Each operation takes a scene and returns the next one, so a consumer may run it in the browser or where it keeps the scene.

- `snap(scene, click, reach): Snap`: what a click (`{ x, z, height? }`, metres) snaps to within `reach` metres seen from above: `{ kind: "point", block, point, at }`, `{ kind: "line", block, line, at }`, or `{ kind: "free", at }`. A point wins over a line.
- `addLine(scene, from, to, reach): Edited`: a line between two ends, each a click (snapped) or a traced point (`{ block, point }`). It splits the line a click snaps onto and every line it crosses, adding points but no line. A line touching no traced block starts a new one; one joining two is refused (`"joins"`), as is one of no length (`"short"`). Chaining clicks passes the answer's `{ block, point: to }` as the next `from`.
- `moveLine(scene, block, line, { x, z }): Edited`: moves a line level, its points with it; refused (`"crosses"`) when lines would cross.
- `removeLine(scene, block, line): Edited`: removes a line and the points no line uses; a block left without lines goes, and what named a later block moves up.
- `loops(points, lines): number[][]`: the closed loops seen from above, counter-clockwise, as point indices.
- `Edited` is `{ scene, faces, block, from, to }` or `{ refused }`: `faces[i]` is where the block's old face `i` went, `-1` when it went away; `from` and `to` are the line's points, with `Refusal` one of `"short"`, `"joins"`, `"crosses"`, `"missing"`.

After every edit the block's faces are derived again. A loop keeping three or more of an old face's points stays that face, at its index, with its module grid, roof chimneys, roof windows, existing PV and face details; of two such loops the one keeping more points stays it, then the larger. A loop keeping no old face is new: it takes the place of a face that went, the first first, else a place after the others. A face whose loop went takes what stood on it; only where more faces went than came do later faces move up, with theirs, as `faces` says. A click on plain ground lands at height 0; one bringing a `height` (a surface that carries heights) sets its point's height.

## Pulling a traced roof up

The tracing has no heights; the roof is pulled up in two moves, eaves then ridges. Each is an `Edited` as above, `from` and `to` -1 unless said.

- `pullEaves(scene, block, height)`, `pullRidges(scene, block, height)`: every eave, or ridge, point of the block to `height` metres, but a point whose height was set.
- `markLine(scene, block, line, kind)`: makes a line, both its points, an eave or a ridge (`Kind`, `"eave" | "ridge"`), kept in `traced.eaves` and `traced.ridges`; `from` and `to` are its points. A point that splits such a line is one too.
- `setHeight(scene, block, point, height)`: a point's height, set: no pull changes it; `from` and `to` are the point.
- `lineKind(scene, block, line)`: an eave or a ridge when both its points are; undefined for a hip, a valley or a verge.
- `bent(scene, block)`: the block's faces more than 2 cm off their plane, as the `pv` crate measures it. They are drawn in the warning colour; every edit drops a module grid on one, as the crate refuses it.

Without the person's word, a corner of the outline is an eave; any other point an inner line ends at is a ridge, unless that line only runs straight on through it; any other point on the outline an eave. A gable's ridge ending on its verges is a ridge; a hip's hips, which end at corners, are not.

After every edit, a point that is no eave, ridge or set point takes its height on a face whose eave, ridge and set points fix a plane (the best fit to three or more not in one line), again until none changes; so faces stay flat, and a line drawn on a pulled roof lands on it.

Ready shapes and dormers will join this module, each an edit of a block's lines whose faces `rebuild` derives (`roof-faces.js`).

## Face details

`Scene.faceDetails` holds what is known of a roof face beyond its shape, named by block and face as a grid is: its `covering` (`tiles`, `slate`, `metal`, `bitumen`; unknown without one) and `pitchConfirmed` (estimated without it). At most one per face.
