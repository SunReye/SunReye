# @sunreye/scene

SunReye's scene and layout types, generated from the crates, and the pure operations both products run on a scene (ADRs 20, 25). Plain JavaScript with its types beside it: no build step, no browser, no 3D library.

## Types

`Scene`, `Layout`, `LayoutChange`, `ModuleType` and every type they name, as the core's API reads and writes them. `schema.d.ts` and `scene-schema.js` are generated; `bun run --cwd apps/home/web api` rewrites them.

- `roofFaceKey(face)`, `RoofFaceId`: one key for a roof face, by block and face, however it was picked.
- `faceCount(scene, block)`: how many roof faces a block has, as the `pv` crate lists them: a traced or free-form block its faces, a dormer's too; a flat or mono-pitch roof one, a gable two, a hip four; 0 for no block. A face index below it names a face, so a consumer checks one without the engine.
- `moveBlock(scene, block, [x, z])`: the scene with the block moved that many metres east and south, a traced one with its points; what stands on it is placed in its face or on its wall and rides along. `centroidOf(footprint)`: the x and z a block turns about. `removeBlock(scene, block)`: the scene without the block and its chimneys, roof windows, existing PV, markers, openings, grids and face details, later blocks' following them down; the last block may go. `turnBlock(scene, block, degrees)`: the scene with the block turned clockwise seen from above about its footprint's centroid, a traced one with its points, a drawn one by its rotation and corner; what stands on its roof turns with it. Each gives the same scene for no such block.
- `SCENE_SCHEMA`: the scene's JSON Schema (2020-12), generated with the types: `$ref` to `$defs.Scene`, every field the core knows and no other. Number widths are left out; it uses only JSON Schema's own keywords.
- `SCENE_SCHEMA_VERSION`: the package version the schema was generated at. A scene carries no version of its own (ADR 25); the plant document's version gates one in transit (ADR 26).

## Tracing a roof

A traced roof is a free-form block whose `freeForm.traced` keeps its points (x, y, z; y its height now), the points whose height was set, its lines (pairs of points) and, per face, the points its corners are. The lines are the source; the faces are derived. Each operation takes a scene and returns the next one, so a consumer may run it in the browser or where it keeps the scene.

- `snap(scene, click, reach): Snap`: what a click (`{ x, z, height? }`, metres) snaps to within `reach` metres seen from above: `{ kind: "point", block, point, at }`, `{ kind: "line", block, line, at }`, or `{ kind: "free", at }`. A point wins over a line.
- `addLine(scene, from, to, reach, into?): Edited`: a line between two ends, each a click (snapped) or a traced point (`{ block, point }`). It splits the line a click snaps onto and every line it crosses, adding points but no line. A line touching no traced block, nor lying inside one of its faces, starts a new one; one joining two is refused (`"joins"`), as is one of no length (`"short"`). Chaining clicks passes the answer's `{ block, point: to }` as the next `from`. `into` names the line's block wherever it touches another: a traced block, or `"new"` for a new one (a roof at another height beside one); then it splits only its own block's lines, and a block that is no traced roof is refused (`"missing"`).
- `moveLine(scene, block, line, { x, z }): Edited`: moves a line level with the straight run it lies in, their points with them; refused (`"crosses"`) when lines would cross.
- `movePoint(scene, block, point, { x, z }): Edited`: moves a point level, keeping its height; refused (`"crosses"`) when lines would cross.
- `splitLine(scene, block, line, { x, z }): Edited`: puts a point into a line where the place lies along it.
- `removePoint(scene, block, point): Edited`: takes a point out, the two lines meeting there joined.
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

## Dormers

A closed loop traced inside a face, apart from its lines or joined to them by one line or at one point, is a dormer: the faces inside it are its own, and the face around it keeps its place and its loop. The house's outline, eaves and ridges are its faces' that stand on no other.

- `dormers(scene, block): Dormer[]`: each dormer as `{ face, faces }`, the face it stands on and its own.
- `pullDormer(scene, block, face, kind, height): Edited`: the eaves (its outline's corners) or ridges (its inner lines' ends) of the dormer face `face` belongs to, at `height`, but where its face stands higher; a point pulled above its face is set. Refused (`"missing"`) for a face of no dormer.

A dormer's points that are not set lie on the plane of its face, so one traced on a pulled roof lies on it and follows the house's pulls. The edit that cuts a face, or moves its cut, drops that face's grid. The `pv` crate takes a traced face lying inside another as a cut in that one's module area, its setback holding from the cut, and stands the dormer's walls on that face.

## Ready roofs

A ready roof is placed in one click as the lines a person could have traced: `placeRoof` clicks them with `addLine`, marks and sets what the outline does not tell (`markLine`, `setHeight`), and pulls the eaves and ridges up. It is then a traced block like any other.

- `readyRoofs: ReadyEntry[]`: the ready roofs for a menu, in order, each `{ id, de, en }`: its id and its name in German and English.
- `placeRoof(scene, id, { x, z }, { width, depth, eave, ridge }): Edited`: ready roof `id` as a new traced block, its corner at `x`, `z`, `width` metres along x and `depth` along z; its eaves at `eave` metres and its top (a ridge, a mono-pitch roof's high side, a parapet) at `ridge`. A gable's ridge runs along x, a hip roof's along the longer side. Refused `"joins"` where it would touch a traced block, `"short"` without a positive size, `"missing"` for an unknown id.

The ids: `satteldach`, `pultdach`, `versetztes-pultdach`, `flachdach`, `flachdach-attika`, `walmdach`, `krueppelwalmdach`, `zeltdach`, `mansarddach`, `mansardwalmdach`, `schleppdach`, `sheddach`, `schmetterlingsdach`, `tonnendach`. A point has one height, so a step between two roof parts (a versetztes Pultdach, a Sheddach's teeth, a parapet's inner wall) is a strip 10 cm wide seen from above; a Tonnendach is six flat strips.

## Ready dormers

A ready dormer is placed on a face in one click as the lines a person could have traced, then pulled up by its own eaves and ridges (`pullDormer`): an edit of the block, its faces derived again.

- `readyDormers: ReadyEntry[]`: the ready dormers for a menu, in order: `schleppgaube`, `satteldachgaube`, `walmgaube`, `flachdachgaube`, `zwerchhaus`.
- `placeDormer(scene, block, face, id, { x, z }, { width, depth, eave? }): Edited`: ready dormer `id` on face `face` of traced block `block`, its middle at `x`, `z` seen from above, its front toward the face's low side; `width` metres across the slope and `depth` up it, where its top (a ridge, a shed's high side, a flat roof) meets the face; its front eave at `eave` metres, halfway between the face and its top without one. A Flachdachgaube is level at its top. A Zwerchhaus stands on the face's eave under `x`, `z`, `depth` up from it: its gable is in the wall, its eaves the house's, its valleys run up the face, and its ridge's ends are set; touching the outline, it is the house's, not a dormer. `faces` says where the block's faces went. Refused `"missing"` for an unknown id, block or face, `"short"` without a positive size, on a face without slope or with an eave not between the face and the top, `"crosses"` where it is not wholly on its face.

## Every edit named

Each edit the tracing makes, on the canvas or on a tracing bar, is a `TraceEdit`: its operation's name and arguments, so a consumer keeping the scene elsewhere makes the same next scene.

- `TraceEdit`: `{ kind: "add", from, to, reach }` (`reach` the metres its clicks snapped within), `{ kind: "move", block, line, by }`, `{ kind: "remove", block, line }`, `{ kind: "pull", block, which, height }` (the eaves or ridges), `{ kind: "mark", block, line, as }`, `{ kind: "height", block, point, height }`, `{ kind: "roof", id, at, size }`, `{ kind: "dormer", block, face, id, at, size }`, `{ kind: "pullDormer", block, face, which, height }`.
- `replay(scene, edit): Edited`: the scene the edit makes, by the operation it names; refused `"missing"` for a kind it does not know.

## Face details

`Scene.faceDetails` holds what is known of a roof face beyond its shape, named by block and face as a grid is: its `covering` (`tiles`, `slate`, `metal`, `bitumen`; unknown without one) and `pitchConfirmed` (estimated without it). At most one per face.
