# 31. Editing

Status: accepted (2026-11-26)

## Context

ADR 20's editor moved, turned and sized by what a press landed on: a picked object moved under a drag, a ring turned it in a turn mode, a context toolbar floated beside it, and a table of exceptions settled which drag orbited. Each fix to a mistaken drag added a rule. Every edit and drag also sent a request. The owner wants every action deliberate, as in Fusion 360: select an object, choose what to do, then do it.

## Decision

**Every action in the menu.** Every action on an object is reachable through the in-scene context menu, opened by a right click or a long press. It offers exactly what applies to what is under the pointer and to the selection, in the current filter. Toolbars and keyboard shortcuts are shortcuts to the same actions, never the only way. The floating context toolbar goes.

**Select first, then act.** A left click selects. A right click selects what it is on and opens the verbs for the selection: Move, Rotate, Resize, Delete, Properties. Choosing a mode shows its handles. One transform gizmo serves every kind of object.

**Modes.** One mode is active at a time and sticks until Esc or another mode.

| Mode | Key | Does |
| --- | --- | --- |
| Select | Esc | selects; the default |
| Move | M | moves the selection |
| Rotate | R | turns the selection |
| Resize | S | sizes edges, corners and pitch |
| Edit shape | E, or double click | moves, inserts and deletes points and edges |
| Line | L | draws lines |
| Rectangle | | draws a rectangle |
| Roof from lines | | makes roof faces from drawn lines |
| Lay row | | on the selected roof face, in its roof view: a tap lays one module, a drag a row |
| Wire | | selects modules in a drag's order to wire them (ADR 35) |

Move, Rotate, Resize and Edit shape chosen with nothing selected ask the person to pick an object, and Lay row a roof face. Drawing tools and Wire need no selection.

**Select only selects.** No drag mutates in Select: a drag navigates (ADR 32), and a quick press on an object never moves it. Delete and the inspector's values edit in Select. ADR 20's press-on-object move, block knob and turn mode go. A tool mode (Wire, Lay row, a drawing tool) owns its drag.
- *Several objects.* Shift- or Ctrl-click adds an object to the selection or takes it out; a Shift-drag draws a selection box. Only what the filter lets pick is selected. Move and Rotate act on the selection as one group, in one undo step; modules stay in their face's plane and snap.
- *Holding a module,* the one exception. A press held 300 ms on a module lifts it, visibly, and the drag that follows moves it, or the selection it is in, in its face's plane with snapping, in one undo step. A press that moves sooner navigates. Move mode moves modules too.

**Handles per mode.** Each mode shows only its own handles:
- *Move:* arrows along the ground axes and the eave's direction, and a free drag.
- *Rotate:* one vertical ring. A roof item turns in its roof face.
- *Resize:* edge and corner handles, and a pitch handle.

While dragging, a value box shows the live value. Typing sets an exact value; Tab moves between fields.

**Snapping.** Magnetic only: to points, edges, midpoints, the eave, perpendicular and parallel. Angles, a rotation's included, snap to 0°, 45°, 90° and the eave's within 3°, and are free between. There is no length grid. Alt turns snapping off. The snap that caught is named beside the pointer.

**Drawing.** Drawing tools are modes and end with Esc. They work in 2D and 3D, on the ground or at the level of a picked part.

**Operations.** Every edit is one named operation of the geometry engine (ADR 30), reached through `@sunreye/scene`; the editor, its tools and the host use the same ones. The modes' operations:

| Operation | Takes |
| --- | --- |
| move | ids, an offset |
| rotate | ids, a centre, an angle |
| resize | an id, a handle (edge, corner or pitch), a value |
| move point | a point id, a plan position |
| insert point | an edge id, an offset |
| delete point | a point id |
| delete | ids |
| draw line | points |
| draw rectangle | its corners |
| roof from lines | edge ids |
| set overhang | a roof-outline edge id, metres |
| add | an object, its place |
| fill face | a face id, fill rules (ADR 35) |
| lay row | a face id, a start, an end |
| wire | ids of modules, optimizers or micro-inverters; a string or AC circuit id |
| unwire | those ids |

- *An answer* names the changed meshes, the ids created and deleted, the values derived (pitches, heights, lengths, areas) and any warnings.
- *A refusal* names its reason, a code the host words, and the offending ids, drawn red.
- *A drag* is one transaction: begin (an operation and its arguments), preview (new arguments, answered as above; a refused preview keeps the last valid one shown), commit (one undo step) or cancel (the scene as before).
- *Load, save, undo and redo* are engine calls too.

**In memory.** The engine holds the scene and its undo history; no edit or drag sends a request.
- *Undo.* One history covers geometry and wiring alike: a snapshot per step, the last 200 kept.
- *Save* serialises the whole scene once and writes it as a new snapshot. A host shows unsaved changes with a dot, saves on Ctrl+S, and mirrors the draft in the browser's storage, offering "Restore unsaved changes" after a crash.

**Benchmark.** Each operation completes within one frame (16 ms) on a large house on a mid-range laptop. It is a benchmark, not a time a test asserts.

**One user.** No multiplayer for now: one person edits a plant at a time, without reservations or locks.

**Touch.** A long press stands for the right click, the wall spot's menu (ADR 35) included. On a module it lifts the module after 300 ms as a held click does: a finger that then moves drags it, and one lifted without moving opens the menu. The modes are buttons in a mode bar. A Snap toggle stands for Alt.

**Filters.** The host restricts what is pickable and which modes exist, by stage of work. Home's:

| Filter | Pickable | Modes |
| --- | --- | --- |
| Dach | buildings, parts, faces, edges, points, openings, obstacles, ground items: ground surfaces, fences, car places, ground rack fields | Select, Move, Rotate, Resize, Edit shape, drawing tools |
| Module | roof faces (opening the roof view, ADR 32), modules, module fields, roof items | Select, Move, Rotate, Resize, Lay row |
| Verdrahtung | modules, optimizers, micro-inverters, strings, AC circuits | Select, Wire |
| Equipment | inverters, batteries, meters, wallboxes | Select, Move, Rotate |

Everything else stays visible and is not pickable.

## Open

- **Other operations** (step 2). The names and arguments of ADR 35's other edits: pulling up, duplicating, clearing a face, keeping an auto-string proposal, attaching an optimizer or micro-inverter.
- **Home's filters** (step 2). How Home's builder levels (ADR 35, *Layout*) choose a filter, and which filter picks neighbours.
- **Multi-select on touch** (step 2). What stands for Shift-click and the selection box.
- **Rotation's zero** (step 2). The direction and sense a typed rotation is measured from.
- **Benchmark house** (step 2). The large house and the reference laptop the benchmark runs on.
- **Shortcuts** (step 2). Keys for Rectangle, Roof from lines, Lay row and Wire.
- **Shallow views** (step 2). Whether ADR 20's rule for drags seen from under 15° carries over to Move's arrows.

## Considered options

- **Handles shown on selection** (the session's first round). Replaced by the owner: handles show only in the chosen mode.
- **A turn mode, other transforms by direct drag** (ADR 20, 2026-11-20). Replaced by modes for every verb.
- **Lengths snapped to 10 cm, angles to 5°** (ADR 20). Replaced by magnetic snapping.
- **A request per edit or drag.** Rejected: drags sent a stream of requests and slowed the editor.
- **Several editors of one plant, with reservations.** Not for now.
- **A plain drag that moves a module in Select.** Rejected: a drag meant to orbit moved modules (ADR 20); the held press is deliberate.

## Consequences

ADR 20's handle, snapping, mistaken-drag and context-toolbar rules no longer apply. Every editing test names a mode.
