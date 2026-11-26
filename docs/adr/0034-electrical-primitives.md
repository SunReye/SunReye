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
- Two primitives connect only where their ports match. A port carries a DC curve (`IvCurve`) or an AC power (`AcPower`).

**One physics seam.** From the module to an inverter's AC output, every kind implements one seam in the Rust engine (`crates/pv`, ADR 30): its inputs in, a DC curve or an AC power out. A new kind plugs in by implementing the seam.
- The graph is compiled once into a flat plan. Curves pass up from the modules; the operating point passes back down.
- The battery, the meter and the grid are a separate dispatch, with state of its own.

**Optimizers and micro-inverters.** Each attaches to one, two or four modules, as its type says, and has its own id. It is checked against its datasheet's limits. It is shown as a marker on its modules, never placed on its own. Its type's data also says whether an optimizer bucks or bucks and boosts, and, for one serving several modules, whether their inputs run in series or each has its own MPP tracking.

**AC circuit.** Micro-inverters join an AC circuit, the AC side's counterpart of a string; the micro-inverter's type gives how many may share one. Strings and AC circuits sit side by side under Verdrahtung.

**Module and module field.** The module is the primitive: an id, on a roof face or in a rack field on the ground (ADR 35, *Racks*).
- Filling a face creates a module field (German UI: Modulfeld): a group edited with the same modes as any object (ADR 31), with overrides per module. It replaces the module grid.
- A module laid by Lay row, by a tap or a drag (ADR 31), joins the field on its face, which it creates where the face has none.
- Resizing a field lays its modules again within its new size.

**Equipment in the scene.** Inverters, batteries, meters and wallboxes are scene objects on a wall (a wall item, ADR 30) or on the ground. They are edited with the same modes and linked to their electrical instance. They replace ADR 20's equipment markers.

## Open

- **New types.** (step 3) The datasheet fields of optimizer and micro-inverter types, and whether they join ADR 27's catalogue.
- **Ports.** (step 3) What besides the signal makes two ports match.
- **DC-coupled battery.** (step 3) Where a battery on an inverter's DC side joins the graph.
- **The `pv` crate.** (step 3) How its string model and `estimate` become implementations of the seam, and which of ADR 35's warnings (MPPT window, cold voltage) move into each kind's checks.
- **Wallbox and car place.** (step 3) How a wallbox object relates to a car place's EVCC device (ADR 35, *Car places*).
- **Schema.** (step 3) How the layout and the plant document (ADR 26) carry primitives and connections.
- **Module field.** (step 3) What a field holds beyond its modules (module type, orientation, gap), and when a module leaves its field.

## Considered options

- **An optimizer as a flag on a module** (ADR 17). Replaced by optimizers as primitives.
- **Equipment markers for inverters and batteries only** (ADR 20). Replaced by equipment objects.
- **A module grid per face** (ADR 20). Replaced by modules and module fields.
