# 34. Electrical primitives

Status: accepted (2026-11-26)

## Context

The layout (ADR 17) knows modules, strings, MPPT inputs and inverters, with an optimizer as a flag on a module. Micro-inverters, optimizers shared by two or four modules, meters and wallboxes have no place in it, and equipment markers (ADR 20) hang only inverters and batteries on a block's wall. Each new kind of device would bend the model. The owner wants modules, inverters, optimizers and micro-inverters as primitives with seams.

## Decision

**A plant is primitives joined at seams.**

```
Module ─┬─ (optimizer) ── String ─────── MPPT input ── Inverter ─┐
        └─ micro-inverter ── AC circuit ─────────────────────────┴─ AC side: meter, battery, grid
```

- Each kind has a type (its datasheet, as ADR 27's types) and instances with permanent ids (ADR 30).
- Two primitives connect only where their ports match.

**One physics seam.** Every kind implements one seam in the Rust engine: its inputs in, a DC curve or an AC power out. The solver walks the graph. A new kind plugs in by implementing the seam.

**Optimizers and micro-inverters.** Each attaches to one, two or four modules, as its type says, and has its own id. It is checked against its datasheet's limits. It is shown as a marker on its modules, never placed on its own.

**AC circuit.** Micro-inverters join an AC circuit, the AC side's counterpart of a string; its type's datasheet gives how many may share one. Strings and AC circuits sit side by side under Wiring.

**Module and module field.** The module is the primitive: an id, on a roof face. Filling a face creates a module field (German UI: Modulfeld), a group edited with the same modes as any object (ADR 31), with overrides per module. It replaces the module grid.

**Equipment in the scene.** Inverters, batteries, meters and wallboxes are scene objects on a wall (an edge id and a fraction, ADR 30) or on the ground. They are edited with the same modes and linked to their electrical instance. They replace ADR 20's equipment markers.

## Open

- **New types.** The datasheet fields of optimizer, micro-inverter and AC circuit types, and whether they join ADR 27's catalogue.
- **Ports.** The port kinds and what makes two match.
- **Migration.** How a module's optimizer flag (ADR 17) and the equipment markers become instances and scene objects.
- **The `pv` crate.** How its string model and `estimate` become implementations of the seam, and which of ADR 20's warnings (MPPT window, cold voltage) move into each kind's checks.
- **Wallbox and car place.** How a wallbox object relates to a car place's EVCC device (ADR 35, *Car places*).
- **Schema.** How the layout and the plant document (ADR 26) carry primitives and connections, and how that is versioned with the scene's conversion (ADR 30).
- **Module field.** What a field holds beyond its modules (module type, orientation, gap), and when a module leaves its field.

## Considered options

- **An optimizer as a flag on a module** (ADR 17). Replaced by optimizers as primitives.
- **Equipment markers for inverters and batteries only** (ADR 20). Replaced by equipment objects.
- **A module grid per face** (ADR 20). Replaced by modules and module fields.
