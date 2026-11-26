# 31. Editing

Status: accepted (2026-11-26)

## Context

ADR 20's editor moved, turned and sized by what a press landed on: a picked object moved under a drag, a ring turned it in a turn mode, a context toolbar floated beside it, and a table of exceptions settled which drag orbited. Each fix to a mistaken drag added a rule. The owner wants every action deliberate, as in Fusion 360: select an object, choose what to do, then do it.

## Decision

**Select first, then act.** A left click selects; a right click opens the verbs for the selection: Move, Rotate, Resize, Delete, Properties. Choosing a mode shows its handles; nothing mutates in Select. One transform gizmo serves every kind of object.

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

A mode chosen with nothing selected asks the person to pick an object.

**Select only selects.** In Select, any drag orbits in 3D and pans in 2D (ADR 32). A press on an object never moves it; ADR 20's press-on-object move, block knob and turn mode go. A tool mode (Wire, Lay row, a drawing tool) owns its drag.

**Handles per mode.** Each mode shows only its own handles:
- *Move:* arrows along the ground axes and the eave's direction, and a free drag.
- *Rotate:* one vertical ring. A roof item turns in its roof face.
- *Resize:* edge and corner handles, and a pitch handle.

While dragging, a value box shows the live value. Typing sets an exact value; Tab moves between fields.

**Snapping.** Magnetic only: to points, edges, midpoints, the eave, perpendicular and parallel, and angles of 0°, 45°, 90° and the eave's within 3°. Rotation is free between snaps, which include the eave, the compass and 90°. There is no length grid. Alt turns snapping off. The snap that caught is named beside the pointer.

**Drawing.** Drawing tools are modes and end with Esc. They work in 2D and 3D, on the ground or at the level of a picked part.

**Named operations.** Every edit is a named operation of the geometry engine (ADR 30), reached through `@sunreye/scene`. The editor and undo replay the same operations.

**In memory.** The whole editor runs in memory: the scene, its edits and their undo history. No edit or drag sends a request. Save writes a new snapshot of the whole scene. Each operation completes within one frame (16 ms) on a mid-range laptop, measured on a large house by test.

**One user.** One person edits a plant at a time; there are no reservations or locks.

**Touch.** A long press stands for the right click, the wall spot's menu (ADR 35) included. The modes are buttons in a mode bar. A Snap toggle stands for Alt.

**Actions.** The floating context toolbar goes. Actions live in the right-click menu, the host's toolbar and keyboard shortcuts.

**Filters.** The host may restrict what is pickable and which modes exist, by stage of work:

| Filter | Pickable |
| --- | --- |
| Roof | buildings, parts, points, neighbours, ground |
| Modules | modules, module fields, roof items |
| Wiring | modules, optimizers, strings, AC circuits, inverters, batteries, meters, wallboxes |

Everything else stays visible and is not pickable.

## Open

- **Home's filters.** Which of Home's builder levels (ADR 35, *Layout*) take which filter.
- **Shortcuts.** Keys for Rectangle, Roof from lines, Lay row and Wire.
- **Shallow views.** Whether ADR 20's rule for drags seen from under 15° carries over to Move's arrows.

## Considered options

- **Handles shown on selection** (the session's first round). Replaced by the owner: handles show only in the chosen mode.
- **A turn mode, other transforms by direct drag** (ADR 20, 2026-11-20). Replaced by modes for every verb.
- **Lengths snapped to 10 cm, angles to 5°** (ADR 20). Replaced by magnetic snapping.
- **A request per edit or drag.** Rejected: drags sent a stream of requests and slowed the editor.
- **Several editors of one plant, with reservations.** Rejected for now: most people work alone on a plant.

## Consequences

ADR 20's handle, snapping, mistaken-drag and context-toolbar rules no longer apply. Every editing test names a mode. The 16 ms budget is a test on a large house, not a target.
