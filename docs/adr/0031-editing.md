# 31. Editing

Status: accepted (2026-11-26)

## Context

ADR 20's editor moved, turned and sized by what a press landed on: a picked object moved under a drag, a ring turned it in a turn mode, a context toolbar floated beside it, and a table of exceptions settled which drag orbited. Each fix to a mistaken drag added a rule. Every edit and drag also sent a request. The owner wants every action deliberate, as in Fusion 360: select an object, choose what to do, then do it.

## Decision

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
| Lay row | | lays modules along a drag |
| Wire | | selects modules in a drag's order to wire them (ADR 35) |

Move, Rotate, Resize and Edit shape chosen with nothing selected ask the person to pick an object. Drawing tools and Wire need no selection.

**Select only selects.** No drag mutates in Select: any drag navigates (ADR 32), and a press on an object never moves it. Delete and the inspector's values edit in Select. ADR 20's press-on-object move, block knob and turn mode go. A tool mode (Wire, Lay row, a drawing tool) owns its drag.

**Handles per mode.** Each mode shows only its own handles:
- *Move:* arrows along the ground axes and the eave's direction, and a free drag.
- *Rotate:* one vertical ring. A roof item turns in its roof face.
- *Resize:* edge and corner handles, and a pitch handle.

While dragging, a value box shows the live value. Typing sets an exact value; Tab moves between fields.

**Snapping.** Magnetic only: to points, edges, midpoints, the eave, perpendicular and parallel. Angles, a rotation's included, snap to 0°, 45°, 90° and the eave's within 3°, and are free between. There is no length grid. Alt turns snapping off. The snap that caught is named beside the pointer.

**Drawing.** Drawing tools are modes and end with Esc. They work in 2D and 3D, on the ground or at the level of a picked part.

**Operations.** Every edit is one named operation of the geometry engine (ADR 30), reached through `@sunreye/scene`; the editor, its tools and the host use the same ones.

| Operation | Takes |
| --- | --- |
| move | ids, an offset |
| rotate | ids, a centre, an angle |
| resize | an id, a handle (edge, corner or pitch), a value |
| move point | a point id, a position |
| insert point | an edge id, an offset |
| delete point | a point id |
| delete | ids |
| draw line | points |
| draw rectangle | its corners |
| roof from lines | edge ids |
| set overhang | an eave edge id, metres |
| add | an object, its place |
| fill face | a face id, fill rules (ADR 35) |
| lay row | a face id, a start, an end |
| wire | module ids, a string id |
| unwire | module ids |

- Each answers the changed meshes, or a refusal: `{ reason }`, a code the host words.
- *A drag* is one transaction: begin (an operation and its arguments), preview (new arguments, answering the changed meshes, red where refused), commit (one undo step) or cancel (the scene as before).

**In memory.** The engine holds the scene and its undo history; no edit or drag sends a request.
- *Undo.* One history covers geometry and wiring alike: a snapshot per step, the last 200 kept.
- *Save* serialises the whole scene once and writes it as a new snapshot. A host shows unsaved changes with a dot, saves on Ctrl+S, and mirrors the draft in the browser's storage, offering "Restore unsaved changes" after a crash.

**Benchmark.** Each operation completes within one frame (16 ms) on a large house on a mid-range laptop. It is a benchmark, not a time a test asserts.

**One user.** No multiplayer for now: one person edits a plant at a time, without reservations or locks.

**Touch.** A long press stands for the right click, the wall spot's menu (ADR 35) included. The modes are buttons in a mode bar. A Snap toggle stands for Alt.

**Actions.** The floating context toolbar goes. Actions live in the right-click menu, the host's toolbar and keyboard shortcuts.

**Filters.** The host restricts what is pickable and which modes exist, by stage of work. Home's:

| Filter | Pickable | Modes |
| --- | --- | --- |
| Dach | buildings, parts, faces, edges, points, openings, obstacles, ground items | Select, Move, Rotate, Resize, Edit shape, drawing tools |
| Module | roof faces (opening the roof view, ADR 32), modules, module fields, roof items | Select, Move, Rotate, Resize, Lay row |
| Verdrahtung | modules, optimizers, micro-inverters, strings, AC circuits | Select, Wire |
| Equipment | inverters, batteries, meters, wallboxes | Select, Move, Rotate |

Everything else stays visible and is not pickable.

## Open

- **Multi-select.** Whether and how more than one object is selected outside Wire, as by Shift and click.
- **Compass.** Whether a rotation's 0° is true north or the scene's x axis.
- **Benchmark house.** The large house and the reference laptop the benchmark runs on.
- **Shortcuts.** Keys for Rectangle, Roof from lines, Lay row and Wire.
- **Shallow views.** Whether ADR 20's rule for drags seen from under 15° carries over to Move's arrows.

## Considered options

- **Handles shown on selection** (the session's first round). Replaced by the owner: handles show only in the chosen mode.
- **A turn mode, other transforms by direct drag** (ADR 20, 2026-11-20). Replaced by modes for every verb.
- **Lengths snapped to 10 cm, angles to 5°** (ADR 20). Replaced by magnetic snapping.
- **A request per edit or drag.** Rejected: drags sent a stream of requests and slowed the editor.
- **Undo by replaying operations.** Replaced by a snapshot per step.
- **Several editors of one plant, with reservations.** Not for now.

## Consequences

ADR 20's handle, snapping, mistaken-drag and context-toolbar rules no longer apply. Every editing test names a mode.
