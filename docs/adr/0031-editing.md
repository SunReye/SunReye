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

A mode chosen with nothing selected asks the person to pick an object.

**Select only selects.** In Select, any drag orbits in 3D and pans in 2D (ADR 32). A press on an object never moves it; ADR 20's press-on-object move, block knob and turn mode go.

**Handles per mode.** Each mode shows only its own handles:
- *Move:* arrows along the ground axes and the eave's direction, and a free drag.
- *Rotate:* one vertical ring. A roof item turns in its roof face.
- *Resize:* edge and corner handles, and a pitch handle.

While dragging, a value box shows the live value. Typing sets an exact value; Tab moves between fields.

**Snapping.** Magnetic only: to points, edges, midpoints, the eave, perpendicular and parallel, and angles of 0°, 45°, 90° and the eave's within 3°. Rotation is free between snaps, which include the eave, the compass and 90°. There is no length grid. Alt turns snapping off. The snap that caught is named beside the pointer.

**Drawing.** Drawing tools are modes and end with Esc. They work in 2D and 3D, on the ground or at the level of a picked part.

**Named operations.** Every edit is a named operation of the geometry engine (ADR 30), reached through `@sunreye/scene`. The editor, the embedding app's tools and undo replay the same operations.

**In memory until saved.** Edits and their history live in memory until saved, in Home and in the embedding app. No edit waits on the network. Each operation completes within one frame (16 ms) on a mid-range laptop, measured on a large house by test.

**Actions.** The floating context toolbar goes. Actions live in the right-click menu, the host's toolbar and keyboard shortcuts.

**Filters.** The host may restrict what is pickable and which modes exist, by stage of work:

| Filter | Pickable |
| --- | --- |
| Roof | buildings, parts, points, neighbours, ground |
| Modules | modules, module fields, roof items |
| Wiring | modules, optimizers, strings, AC circuits |
| Equipment | inverters, batteries, meters |

Everything else stays visible and is not pickable.

## Open

- **Touch.** What on a phone or tablet stands for the right click, the mode keys and Alt. ADR 20 required editing at every width.
- **Wiring mode.** ADR 20's wiring mode selects modules by a drag across them (ADR 35); whether that drag survives "any drag orbits" in the wiring filter.
- **Home's filters.** Which of Home's builder levels (ADR 35, *Layout*) take which filter.
- **Shortcuts.** Keys for Rectangle and Roof from lines.
- **Shallow views.** Whether ADR 20's rule for drags seen from under 15° carries over to Move's arrows.

## Considered options

- **Handles shown on selection** (the first round of this decision). Rejected by the owner: a handle under the pointer invites the mistaken drag the modes remove.
- **A turn mode only, other transforms by direct drag** (ADR 20, 2026-11-20). Rejected: one deliberate step for one verb left the others accidental.
- **A length grid.** Rejected: real houses are not on a 10 cm grid; magnetic snaps to existing geometry and exact typed values cover it.
- **Saving every edit as it happens.** Rejected: a round trip per drag makes editing wait on the network.

## Consequences

ADR 20's handle, snapping, mistaken-drag and context-toolbar rules no longer apply. Every editing test names a mode. The 16 ms budget is a test on a large house, not a target.
