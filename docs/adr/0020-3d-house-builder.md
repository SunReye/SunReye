# 20. 3D house builder

Status: accepted (2026-11-09), amended (2026-11-10, 2026-11-12)

## Context

The PV layout (ADR 17) is entered as numbers: planes, module counts, MPPT inputs. Homeowners think in roofs. Shading, optimizers and strings that span roof faces cannot be described as one plane per string. The owner wants to build the house, place modules like a PV planner, see each string's production in 3D, and make that live scene the dashboard.

## Decision

**What it is.** An editor for the geometry of the PV layout. The layout stays the source of truth; the form stays for anyone who does not want 3D. The admin edits; viewers, and the cloud web app later, see the scene read-only.

**Scene.** The scene is part of the PV layout, owned by the layout feature module (ADR 19). Saving it is one configuration change with an effective-from date. Planes and strings are derived from it and are not edited separately once a scene exists. Units are metres, y up, origin at the first block's corner; a compass dial rotates the scene to true north. Plane azimuths follow ADR 17. No map or satellite tiles: they would send the home's address to a tile service.

- **Blocks.** A rectangular footprint (width, depth, eave height, rotation) with one roof: flat, mono-pitch, gable or hip, at a pitch. A plant has several blocks. Dormers, larger L-shapes and free-form polygons wait. The compass dial's angle is the bearing of the scene's −z axis; a block's width runs along x and its depth along z from its corner, turned clockwise seen from above. A mono-pitch roof rises from the front eave (+z), a gable's ridge runs along the width, a hip's along the longer side.
- **Modules.** The admin defines the roofs first, then places modules freely on a grid on each roof face, like a PV planner. A cell is the module's size plus a gap; each face has an edge setback and a portrait or landscape orientation. Strings are painted onto modules and may span faces. Optimizers are set per module.
  - A face's module grid holds one module type. Columns run across the slope and rows up it, from the face's lowest corner on the left seen from the front, starting at the setback; the gap is 2 cm. A flat roof's grid runs along the block's width.
  - The scene is stored with its layout version as one document in the `pv` crate's schema, in which a module names its string by id. Through the API a module names its string by position in the version's strings, so new strings need no id first.
  - The core derives each string's module count, optimizer count and plane, the plane of its first module, with the `pv` crate; the browser's numbers are not trusted. A painted string of another module type than its grid is refused.
- **Obstacles.** Opaque boxes (a neighbour, a wall), cylinders (a chimney, a pole), trees (a trunk with a crown, broadleaf or conifer) and hedges (a straight row), each with position, size and height. A tree shades all year; leaf fall is not modelled.
- **Garage.** A block with walls and any roof; it needs no kind of its own.
- **Surroundings.** Ground surfaces and fences are drawn and never shade; the `pv` crate stores them and ignores them for shading.
  - A *ground surface* is a rectangle on the plot with a footprint like a block's and one finish: lawn, paving, driveway, gravel or path. Later surfaces draw over earlier ones. Without any, the plot is lawn.
  - A *fence* is a polyline on the ground with a height and one finish: wood, metal or wall.
- **Equipment.** Markers for inverters and batteries, each linked to its device and placed on a block's wall, inside or outside.
  - A marker names its device, its kind (inverter or battery, so a hybrid inverter may carry one of each), its block, the wall (front along +z, right along +x, back, left) and its distance from the wall's left end seen from outside. It hangs at 1.5 m, at most half the eave, 10 cm off the wall; its label's anchor floats 1 m above the block's highest point. The `pv` crate places it, so the browser and the core agree; a marker past its wall's ends or on no block is refused. A marker of a removed device shows nothing.
- **Car places.** A parking footprint, optionally under a carport whose roof carries modules, linked to one EVCC loadpoint device (ADR 10). It shows the car while one is connected.
  - A carport is a block marked open: a post at each corner reaches up to its roof instead of walls, and its roof faces carry module grids and shade like any other. A car place stands under one by position, not by reference.
  - A place names its device, its corner, width, length and rotation like a block's footprint, a colour (`#rrggbb`), and an uploaded body by id. The `pv` crate stands the car at the place's centre, its nose along the place's −z, its label's anchor 2.5 m up; a place without a positive size, with another colour or an id no SHA-256 is refused.
- **Car body.** One default body ships: a low-poly mid-size sedan of about 4,000 triangles and under 50 KB, cut from "2024 Tesla Model 3 + Interior" by tonielpro520 (CC BY 4.0) without badges, interior or textures, and painted in the place's colour. The About page credits it. The admin may upload a GLB per car place instead: at most 20 MB, no external URIs, scaled to the place's length and set on the ground, stored in the data directory and included in backups.
  - An upload is admitted only as a glTF 2.0 binary container whose JSON names no `uri` anywhere, so every buffer and image is embedded; the cap holds while the body streams. It is kept as `cars/<sha256>.glb` in the data directory and named by that digest; backups (ADR 3) take the `cars` directory with the database. Viewers read a body; uploading is the admin's.

**Editing.** Undo and redo until save. Saving checks that modules sit inside their face's setback and do not overlap. Unassigned modules are shown and produce nothing. A string whose open-circuit voltage at −10 °C exceeds the inverter's maximum DC input voltage (ADR 5) raises a warning, never a refusal, because the plant may already exist. That voltage scales the datasheet's Voc by its voltage coefficient, as string sizing does. The layout's answer carries the warnings, for strings entered by form too. The browser runs the same checks through the `pv` crate before saving.

**Physics.** Shading is computed in the `pv` crate (ADR 17), per bypass-diode substring, against blocks, obstacles and carport roofs; diffuse light stays unshaded. The `pv` crate also turns blocks, roofs and obstacles into the faces and solids the browser draws, so what is drawn is what shades: the forecast shades with each face as a fan of triangles and with the solids. The core's forecast and the browser run the same code, so the scene and the forecast never disagree. three.js only draws.

**Rendering.** three.js directly, without a Svelte wrapper. The scene is built by pure functions from the layout and drawn by one thin component. It needs WebGL2. It redraws only on a live tick or a camera move, never in a continuous loop. An orbit camera offers preset views (north, east, south, west, top, isometric); each viewer's last view is kept in their browser. The `pv` crate reaches the browser through its own WASM glue crate (ADR 2). Desktop and tablet edit; a phone views.

**Loading.** The dashboard never waits for the scene. three.js and the scene load after the dashboard is interactive: noise textures in a worker, the plant built in slices, shader programs compiled ahead, and the first frame drawn hidden. Meanwhile the hero shows the scene's own studio backdrop with a faint ground shadow; "3D-Ansicht lädt …" appears only after a second. Once the GPU has finished the first frame, the scene and its labels fade in over about 350 ms; the car loads after the house and fades in on its own. With 2D chosen, under the low-power switch or without WebGL2, three.js is never requested; a first switch from 2D keeps the flow until the scene can fade over it. A failed load leaves the 2D flow with "Erneut versuchen".

**Time slider.** A date and time slider moves the sun and the shadows. Per-string production comes from measured values or estimates for past dates, the forecast for today and the next two days, and a clear-sky run of the `pv` crate in the browser for any other date. Once readings exist, each MPPT input's learned correction and its residual over the last 30 days are shown, so a misplaced face or a missing obstacle shows where it is drawn. Nothing changes the scene automatically.

- A day with nothing stored, such as one before the first reading, runs the clear sky too. The browser's clear sky caps no MPPT input, as it reads no inverter profile. The location is the admin's (ADR 9), so for a viewer the sun stays put and no clear sky runs.
- `GET /api/v1/corrections`, read like history, returns each MPPT input's learned factors and its residual: measured against modelled energy in kWh over the whole hours of the last 30 days that are both modelled on archive weather and measured, short of the AC limit, the model uncorrected.
- The clear sky is Ineichen and Perez's at sea level under a Linke turbidity of 3, with still air at 20 °C: a plant stores no altitude, and a turbidity climatology is a 30 MB table. Golden values come from pvlib.

**Live dashboard.** When a scene exists, the dashboard opens on it, updated by live ticks (ADR 9): each string's power, tinted by its share of its own peak and labelled at its centre (estimates carry "≈"); each inverter's AC power; the battery's power, direction and SOC; the car's charging power and the vehicle's SOC when EVCC reports them; grid import or export and house consumption from the `plant` device. Equipment labels float above their markers on leader lines, readable through walls; without markers they sit beside the house. The 2D power flow serves when there is no scene, no WebGL2 or the low-power switch is on, and a toggle switches between them per browser. Until ADR 4 has a role for an inverter's AC output, its label shows its `pv.power`. The scene's tints and labels come from the live values only; three.js loads when the scene is shown.

**Look.** An architectural visualisation that matches the SPA (ADR 21), in studio mode: the plot fades into the page background, with no visible horizon.
- **Materials:** physically based and generated in code: plaster walls, tiled or flat roofs, grass, paving, bark and leaves. No texture files ship.
- **Modules:** full black: black cells, backsheet and frames under anti-reflective glass, which reflects about half as much as plain glass.
- **Light:** the sun at its real position for the plant and time, casting soft shadows, with a sky model as the environment. The builder's time slider moves it, and nights use night lighting. Ambient occlusion runs as one pass and is off on the lite and still motion tiers (ADR 21); the low-power switch shows the 2D flow instead.
- **Strings:** a faint glow on the solar amber ramp in their cells, by share of peak.
- **Theme:** the page background, fog and exposure follow light or dark mode.
- **Rendering quality:** antialiasing is on, and tone mapping is filmic.

**Motion.** There is still no continuous loop. Short ease-in-out tweens run, then rendering stops:
- the camera flies to a preset in about 600 ms;
- tints and labels ease to each tick's values in about 400 ms.

Energy flow shows as tint and label arrows.

**Labels.** Labels are ambient-glass chips with an icon, an animated value and a flow-colour dot. They push each other apart so they never overlap, and stay inside the canvas. Tapping a chip opens that equipment's detail sheet.

**Building it.** Anyone should get from nothing to their roof in minutes, on a tablet or with a mouse.
- **Templates.** An empty scene offers starting points: detached house with gable roof, bungalow with flat roof, house with hip roof, L-house (two blocks), terrace end, and empty. A template only fills the scene; nothing remembers it.
- **Handles.** Selecting an object shows handles in 3D:
  - arrows on its walls drag width and depth;
  - a handle on the ridge or high eave drags the pitch;
  - a ring rotates it;
  - dragging its footprint moves it.
- **Snapping.** Lengths snap to 10 cm, angles to 5°, and edges to other blocks' edges and the compass axes. The live value shows beside the handle while dragging.
- **Modules.** "Fill face" places as many modules as the face's grid holds. A tap toggles one cell, and a drag paints or erases cells.
- **Strings.** Pick a string, then drag across modules to paint it.
- **Inspector.** It shows the exact numbers. Editing one moves the handles, and every handle drag is one undo step.
- **Touch.** One finger on a handle drags it, and on empty space orbits. Two fingers pan and zoom.
- **Layout.** The canvas takes the full height on the left. A glass inspector on the right uses the drill-in pattern: Buildings, Surroundings, Equipment, Modules, Strings. Clicking an object in 3D drills the inspector to it. The module-grid editor is its own level. On a portrait tablet the inspector is a bottom sheet that can be pulled up.

## Considered options

- **A viewer only.** Rejected: a picture on top of typed numbers adds nothing the form does not have.
- **Free-form roof modelling.** Rejected for now: parametric blocks give exact planes and work on a tablet.
- **Shading in three.js.** Rejected: the forecast and the scene would disagree.
- **Threlte.** Rejected: a wrapper that must follow every Svelte major.
- **Map tiles to trace the roof.** Rejected: privacy, licensing and network.
- **SunReye-drawn bodies per class, picked through a car catalogue from the EVCC vehicle title.** Rejected: a stylised body looks like a toy beside the realistic house, and a catalogue is upkeep for a cosmetic. One de-badged default plus uploads covers every car.
- **The full textured car model (2.5 MB).** Rejected: about 2.5 minutes over a slow link, for detail nobody sees from the yard.
- **A numbers-only builder.** Rejected: homeowners think in roofs and drags; the numbers stay in the inspector for precision.

## Consequences

The builder ships after 5.0.0 (ADR 1). The `pv` crate models every module, which also improves the forecast of plants entered by form. The default car keeps a real car's shape, without badge or name; its CC BY credit must stay on the About page. Inverter profiles gain their maximum DC input voltage. The dashboard loads three.js when a scene exists.
