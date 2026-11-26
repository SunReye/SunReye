# SunReye

A local-first monitor for home solar, battery and meter hardware: it reads devices, stores history, shows it, and writes a device's settings on request.

## Plant and devices

**Plant**:
The one site being monitored. It has one timezone and one location, set by the admin.
_Avoid_: Site, installation, system

**Reference plant**:
The plant the performance benchmark generates ten years of, the largest home it must stay fast for.
_Avoid_: Test plant, demo plant

**Device**:
One physical or logical unit that produces readings: an inverter, a battery, a meter, a wallbox.
_Avoid_: Inverter (as the general term), asset

**Pending device**:
A device without a connection: it can be named by strings and equipment objects and produces no readings until it is given one.
_Avoid_: Planned device, placeholder, draft device

**Plant document**:
A plant as an installer planned it: location, types, layout, scene and pending devices, without any connection. The core imports it.
_Avoid_: Export, project file, handoff file

**Handoff code**:
The one-time code with which the core fetches a plant document.
_Avoid_: Claim code, share code (which grants access), invite

**Connection**:
How the core reaches one or more devices: an endpoint, broker or HTTP host, plus its credentials.
_Avoid_: Integration, source

**Endpoint**:
A request/response network address with its transport (Modbus TCP, RTU over TCP, Solarman). One task serialises all traffic to it, for every device behind it.
_Avoid_: Port, link

**Device address**:
Where a device sits behind its connection: a Modbus unit id or an EVCC loadpoint index. It belongs to the device.
_Avoid_: Slave id

**Topic root**:
The topic prefix of a broker connection, such as `evcc`, under which its profiles' topics sit. It belongs to the connection.
_Avoid_: Prefix, base topic

**Integration**:
An outbound adapter for a neighbour: the role endpoint, the MQTT publisher with Home Assistant discovery, the cloud relay.
_Avoid_: Connection, plugin

**Transport**:
The wire framing on an endpoint: Modbus TCP, RTU over TCP, Solarman V5, or `sim`.
_Avoid_: Protocol, driver

## Profiles

**Profile**:
A declarative file describing one device model or family: its quantities, how to read them and which settings it may write.
_Avoid_: Driver, template, map

**Official profile**:
A profile signed by the profile key and backed by a replayable capture of a real device. Its settings are `verified` one by one, once written on real hardware.
_Avoid_: Verified profile

**Community profile**:
Any other profile. It loads read-only until an admin enables a write.
_Avoid_: Custom profile, unofficial profile

**Index**:
A hosted `index.json` listing profiles with their hashes and signatures.
_Avoid_: Source, registry, repository

**Schema**:
The integer version of the profile format. The core supports the current schema and the previous one. It bumps only on a breaking change; additive features are capabilities.
_Avoid_: Profile version (a profile has its own semver)

**Quantity**:
One value a profile declares: read from a register or computed from earlier quantities, and published as a role.
_Avoid_: Metric, point, field

**Scale factor**:
A register holding the signed power of ten a quantity's raw value is scaled by, read with the value: SunSpec's `sunssf`.
_Avoid_: Exponent, multiplier

**Sentinel**:
The raw value a register type holds when the device does not implement it, such as SunSpec's 0x8000 for a signed word. It reads as no value.
_Avoid_: NaN, null value

**Read plan**:
The list of register blocks the core compiles from a profile at load time, or for SunSpec at connect.
_Avoid_: Poll list

**Identify probe**:
The read that tells which profile, and which variant of it, a device answers to: a magic register such as `SunS`, or a device-type register.
_Avoid_: Fingerprint, detection

**Family**:
A manufacturer's model range that one profile describes together, because its models share one register map and differ only in ratings and limits, such as Deye's SG05LP3.
_Avoid_: Series (a series is a stored role), range, product line

**Base**:
What every model of a family shares, with the family's largest limits. A device that matches no variant is read as the base.
_Avoid_: Default, parent, generic profile

**Variant**:
The device type within one profile that an identify probe chooses, such as a SunSpec inverter's model 101, 102 or 103 by phases, or a Deye model by its rated power. A family's variant is its base with overrides.
_Avoid_: Model (a SunSpec model is a register block)

## Quantities and storage

**Role**:
A brand-neutral quantity name with a unit and a sign convention, such as `battery.power`.
_Avoid_: Metric, point, entity

**Reading**:
One decoded value of a role from a device at an instant.
_Avoid_: Sample, datapoint

**Series**:
One role at one index, such as `pv.mppt.power[2]`; an unindexed role is its own series. The key of storage, rollups and history reads.
_Avoid_: Channel, metric

**Change point**:
A stored value and the instant it began. History is a series of change points and gaps.
_Avoid_: Row, sample

**Interval**:
The span from one change point to the next change point or gap. Derived, never stored.
_Avoid_: Period

**Bucket**:
A 60 second slot aligned to the Unix epoch: the unit of a flush.
_Avoid_: Window, tick

**Rollup**:
An hourly (UTC hour) or daily (plant-local day) aggregate built from intervals.
_Avoid_: Aggregate, summary

**Explore**:
The screen that charts any stored series of any device over a range.
_Avoid_: Explorer, analytics page

**Lane**:
One band of an Explore chart, holding the series of one unit on a shared time axis.
_Avoid_: Axis, track

**Overlay**:
One series over several periods, laid on one plant-local clock axis.
_Avoid_: Comparison (History's baseline is a different thing)

**Fold**:
One series' statistics per hour, day, week or month.
_Avoid_: Aggregation, rollup (stored), summary

**Saved view**:
A named Explore view the admin keeps for the whole plant, shown to everyone who opens Explore.
_Avoid_: Favourite, preset, dashboard

**Self-consumption**:
The share of the PV energy used on site rather than fed in, over an hour or longer.
_Avoid_: Self-use, own consumption (a measurement point's own consumption is something else)

**Autarky**:
The share of the house load not bought from the grid, over an hour or longer.
_Avoid_: Self-sufficiency, independence

**Usable capacity**:
The energy a full battery gives today, inferred from its state of charge over whole discharges, not read from the device.
_Avoid_: State of health, SOH, nameplate

**Round-trip efficiency**:
The share of the energy that went through the battery that it gave back over a range: what it gave, over what it took less what it holds more at the range's end than at its start.
_Avoid_: Battery efficiency, inverter efficiency (the inverter's own, of the moment)

**Full cycles**:
What the battery gave over a range, counted in its capacities.
_Avoid_: Cycles (the vendor's own count is something else)

**Charging session**:
A run of hours in which a loadpoint charged, with its start, end and energy.
_Avoid_: Session (a sign-in), EVCC's session (plug-in to unplug)

**PV share of the charge**:
The share of what the cars charged over a range that PV met directly: each hour's charge counts at the share of the house load PV met directly in that hour.
_Avoid_: Solar charging share, PV-to-EV flow (none is measured)

**Deadband**:
The smallest change in a role's unit that is stored. The stored series is never wrong by more than this.
_Avoid_: Threshold, tolerance

## Settings

**Setting**:
A device parameter the core may write, declared by a profile.
_Avoid_: Control, command, parameter

**Recipe**:
The ordered steps that apply one setting.
_Avoid_: Script, macro

**Precondition**:
A device state a recipe requires before it writes. One that does not hold refuses the write.
_Avoid_: Guard, check

**Outcome**:
The result of a write: `verified`, `mismatch`, `unknown`, `partial`, or `unchanged` when no write was needed.
_Avoid_: Status, result

**Snapshot toggle**:
A setting that locks another setting at a fixed value and, on release, restores the value it held before. Deye's battery discharge lock is one.
_Avoid_: Composite control, switch

**Time-of-use slot**:
One row of a device's own schedule: from its start until the next slot's, the battery works toward a SOC target at a power, charging from the grid or not. Its settings are written like any other.
_Avoid_: Band (a tariff's), program, time window

**Live control**:
A write the device reverts unless it is refreshed. Only a controller under a lease may use it.
_Avoid_: Remote control, setpoint

**Controller**:
A named automation that writes settings through the funnel. None exists in the first release.
_Avoid_: Automation engine, bot

**Lease**:
A controller's exclusive, revocable hold on the settings it controls.
_Avoid_: Lock, ownership

## Plant model

**Measurement point**:
A place in the plant where a device measures a flow, with a parent point. The root is the grid connection.
_Avoid_: Node, meter position

**Claim**:
A device measuring a measurement point. Two claims on one point are flagged, never summed.
_Avoid_: Assignment, binding

**Own consumption**:
A measurement point's power minus that of its measured children: the unmeasured remainder no child explains.
_Avoid_: Residual (the daily energy balance check), rest

**Residual**:
The energy a consuming measurement point gave out over a day that its measured children do not explain. A consumer cannot give energy out, so a residual is a missing or misplaced point.
_Avoid_: Own consumption, imbalance

**House load**:
All consumption in the plant except the battery's charging.
_Avoid_: Consumption (alone), home power

**Day type**:
Which kind of day a plant-local date is for its loads: working day, Saturday, or Sunday and public holiday.
_Avoid_: Weekday class, calendar type

**MPPT input**:
One maximum-power-point tracker input of an inverter: the finest level at which PV is measured.
_Avoid_: PV1 (a vendor label), string

**String**:
Modules in series, wired to one MPPT input; they may sit on different roof faces. Strings on one input are in parallel.
_Avoid_: Array, panel group

**Wiring order**:
The order a string runs through its modules, from its first.
_Avoid_: Paint order

**Wire**:
To put a module into a string, at a place in its wiring order; to unwire takes it out. Also the mode for it, where every string's wiring order is drawn and a drag across modules selects them. German UI: verdrahten, lösen; the mode Verdrahten.
_Avoid_: Paint, assign (alone), link, wiring mode, string tool

**Auto-stringing**:
Wiring a roof face's unwired modules into new strings in a serpentine, as few as the inverter's limits allow; previewed before it is kept. German UI: Automatisch verdrahten.
_Avoid_: Auto-layout, auto-wiring, string wizard

**Wall spot**:
Where a right click struck a building's wall: the part, the wall, the place along it and the height. What is added from the right-click menu goes there; held by the page, never stored.
_Avoid_: Wall selection, anchor, drop point

**Optimizer**:
A DC converter attached to one, two or four modules, as its type says, between them and their string; drawn as a marker on its modules.
_Avoid_: Power optimiser, module electronics

**Micro-inverter**:
An inverter attached to one, two or four modules, as its type says, feeding an AC circuit; drawn as a marker on its modules.
_Avoid_: Microinverter, module inverter

**AC circuit**:
Micro-inverters joined on one AC line, as many as their type allows; the AC side's counterpart of a string.
_Avoid_: AC string, branch circuit

**MPPT window**:
The voltages an MPPT input tracks between, with the start voltage it wakes at and its maximum input current: the input's limits from the inverter's datasheet.
_Avoid_: MPP range, DC window

**MPPT window warning**:
A notice that a string or an MPPT input leaves the input's limits at −10 °C or at a 70 °C cell; it never refuses a layout.
_Avoid_: Sizing error, string error

**Substring**:
The cells of one module behind one bypass diode. Shade bypasses a substring, not the whole module.
_Avoid_: Cell string, diode group

**Shading table**:
Which substrings a scene shades at each sun position of a grid over the sky, traced once per scene and looked up by a year's run.
_Avoid_: Shade map, shadow cache

**Horizon profile**:
The far horizon's elevation at each degree of azimuth, which the caller supplies to a run: a sun below it gives no beam, and it trims each substring's sky view. Never stored in the layout.
_Avoid_: Skyline, horizon mask

**Sky view**:
The share of the isotropic sky a substring sees above the horizon profile and past the scene, 1 under an open sky.
_Avoid_: SVF, sky factor

**Module type**:
The datasheet values of one PV module model.
_Avoid_: Panel model

**Inverter type**:
The datasheet values of one inverter model, among them each MPPT input's limits; a device carries a copy.
_Avoid_: Inverter model, inverter profile (a profile describes registers)

**Battery type**:
The datasheet values of one battery model: usable capacity, power and round-trip efficiency.
_Avoid_: Battery model

**Datasheet catalogue**:
Inverter and battery types copied from makers' datasheets under the module catalogue's rules. SunReye holds its format and checks; SunReye Plan collects the entries. Picking one adds a type.
_Avoid_: Device database, product list

**Module catalogue**:
Module types' datasheet values bundled with SunReye, each naming the maker's datasheet it was copied from. Picking one adds a module type.
_Avoid_: Preset (a preset is a camera view), module database

**Scene**:
The 3D geometry of the plant: buildings, obstacles, equipment, car places and where each module sits. Part of the PV layout.
_Avoid_: Model, 3D view

**Building**:
Points, edges, roof faces and walls closed into a solid, made of one or more parts. German UI: Gebäude.
_Avoid_: Block, house

**Point**:
A corner of a building, where its edges meet.
_Avoid_: Vertex, node

**Edge**:
A straight line between two points of a building: a wall-line edge, an eave, a ridge or any other roof line.
_Avoid_: Segment, side

**Face**:
A flat surface of a building bounded by its edges.
_Avoid_: Polygon, surface

**Base edge**:
A roof face's lowest level outline edge, which its pitch rises from; an outline edge that is one is an eave, any other a verge.
_Avoid_: Hinge, axis

**Wall line**:
A part's outline where its walls stand, seen from above.
_Avoid_: Footprint (of a building or part), ground plan

**Roof outline**:
A part's wall line widened by each edge's overhang: where its roof ends, seen from above.
_Avoid_: Footprint (of a building or part), eave line

**Wall**:
A building's side over one edge of its part's wall line, from the ground up to the roof above it, gable and step included.
_Avoid_: Facade

**Filter**:
What the editor lets a person pick, and which modes it offers, at one stage of work: in Home Dach, Module, Verdrahtung and Equipment.
_Avoid_: Stage, workspace, layer

**Part**:
A piece of a building with its own wall line and roof faces, standing on the ground, at a height or on a roof face; parts touch or stack and move with their building. A separate garage is its own building, not a part.
_Avoid_: Block, section, wing

**Module field**:
Modules on one roof face grouped as one object, made by a fill and joined by modules placed on that face, each module keeping its own place and any override. German UI: Modulfeld.
_Avoid_: Module grid, array, panel layout

**Mode**:
What the editor does with the selection until Esc or another mode: Select, Move, Rotate, Resize, Edit shape, Lay row, Wire, or a drawing tool. Each shows only its own handles; a tool mode owns its drag.
_Avoid_: Tool (alone), Turn mode, context toolbar (its actions are in the right-click menu)

**Selection**:
What is picked in the editor, one for both cameras: one object or several the filter lets pick, acted on as one group; in Wire, the modules crossed, in that order. Held by the page, never stored.
_Avoid_: Marked modules, lasso

**Held move**:
Moving a module, or the selection it is in, by pressing it until it lifts, then dragging it in its face.
_Avoid_: Drag-move, pick-up

**Edit shape**:
The mode that moves, inserts and deletes a building's points and edges; every face stays flat.
_Avoid_: Bent face (a face is always planar), vertex edit

**Roof view**:
The camera facing one roof face square on, orthographic, eave level at the bottom, orbit locked, for placing modules on it.
_Avoid_: Face view, fly-in

**Site context**:
The aerial image, terrain and, later, neighbouring buildings around the plant, loaded from a state's public data on request.
_Avoid_: Surroundings (ground surfaces and fences), map, environment

**Setback**:
The margin along every edge of a roof face that no module may cross.
_Avoid_: Border, margin

**Fill rules**:
How "Fill face" lays a face's free roof: the gap between modules, never under 2 cm; the alignment, from the setback's lower left or centred in it; and the keep-out margin, kept free round each roof chimney, roof window, existing PV and dormer. A call's, never stored with the scene.
_Avoid_: Fill settings, spacing

**Overhang**:
How far a roof reaches past the wall below it, at every edge of its roof outline, eaves and verges alike.
_Avoid_: Eave depth, soffit

**Roof line**:
A line traced along a roof seen from above: an eave, ridge, hip, valley or verge. Every closed loop of them is a roof face.
_Avoid_: Stroke

**Pulling up**:
Giving a traced roof its heights: its eaves to one height, then its ridges to theirs, which sets its faces' pitches. German UI: Höhe ziehen.
_Avoid_: Extrude, lift

**Dormer**:
A part standing on a roof face, with roof faces of its own. It cuts its wall line out of the face's module area, and its front and cheeks are walls up from that face. German UI: Gaube.
_Avoid_: Roof extension, Dachaufbau

**Ready roof**:
A common German roof, such as a Satteldach or a Mansarddach, placed in one click as the lines a person could have traced and pulled up, then edited as any traced roof.
_Avoid_: Template, preset, roof type

**Ready dormer**:
A common German dormer, such as a Schleppgaube or a Satteldachgaube, or a Zwerchhaus, placed in one click on a face as the lines a person could have traced and pulled up, then edited as any traced roof.
_Avoid_: Dormer template, dormer preset

**Covering**:
What a roof face is covered with: tiles, slate, sheet metal or bitumen; unknown until someone says.
_Avoid_: Roofing, material, Eindeckung

**Rack field**:
Rows of modules tilted off a flat roof face or level ground, at their own tilt and azimuth.
_Avoid_: Ground mount, elevation, substructure, Aufständerung

**Roof chimney**:
An upright box standing on one roof face of a part; no module may stand on its footprint.
_Avoid_: Chimney obstacle, stack

**3D quality**:
How sharply a browser draws the scene (Auto, Niedrig, Mittel, Hoch, Ultra), apart from what moves.
_Avoid_: Graphics tier, motion tier

**Roof window**:
A window lying flush in one roof face; it casts no shade and no module may cover it.
_Avoid_: Skylight, Dachfenster, roof obstacle

**Existing PV**:
Modules already on one roof face that stay, as one rectangle; drawn only, they produce nothing and no new module may cover them.
_Avoid_: Bestandsanlage, old modules, existing array

**Obstacle**:
An opaque box, cylinder, tree or hedge standing on the ground in the scene that casts shade on the modules.
_Avoid_: Shader, object

**Neighbour**:
A building around the plant from the state's building model, with its real roof, on its own ground; read-only and never saved. A plant keeps only which neighbours it hides or deletes and its own edited copies. A hidden one still shades.
_Avoid_: Surrounding shape, context building

**Aerial image**:
A picture of the ground from above, north up over its extent, from a state's service, for tracing; draped on the terrain, and shown or hidden by a toggle.
_Avoid_: Satellite tiles, map, orthophoto

**Equipment object**:
An inverter, battery, meter or wallbox in the scene, on a wall or the ground, linked to its device; its live label hangs above it.
_Avoid_: Equipment marker, pin, icon

**Opening**:
A window or a door in a building's wall: a window, a French window, a front door or a garage door. It is drawn and never shades.
_Avoid_: Hole, cutout, aperture

**Car place**:
A parking spot in the scene, linked to one EVCC loadpoint device, optionally under a carport.
_Avoid_: Garage, charger

**Carport**:
An open part: a post at each corner instead of walls, under a roof that carries modules like any other.
_Avoid_: Shelter

**Car body**:
What the scene draws for a connected car: the default low-poly sedan in the car place's colour, or a GLB the admin uploaded.
_Avoid_: Car model

**Ground surface**:
A rectangle on the plot with one finish, such as lawn, paving or a driveway, drawn as a flat grey. Drawn only; it casts no shade.
_Avoid_: Floor, texture

**Studio floor**:
The light-grey ground the scene stands on, fading into the page. A plot without ground surfaces shows only it.
_Avoid_: Lawn, ground plane

**Clay**:
The matte off-white the scene draws everything built in, with no map: a white-box model. Roofs, crowns, trunks and fences are each a flat tone of it.
_Avoid_: Finish, texture, plaster

**Fence**:
A line on the plot with a height and a finish. Drawn only; it casts no shade.
_Avoid_: Wall (a building's side), garden wall (an obstacle)

**Plant peak**:
The most power the plant has moved recently, remembered with a six-hour half-life. A flow rail shows its share of it.
_Avoid_: Ceiling, max power

**Motion tier**:
How much a device animates: full, lite or still. On Automatisch a measured frame strain lowers it; the low-power switch and reduced motion force still.
_Avoid_: Animation level, performance mode

**Frame strain**:
A measurement that a device did not hold its frames. It lowers the motion tier or Auto's 3D quality, and is forgotten after seven days.
_Avoid_: Jank count, performance score

**Frame limit**:
A browser's choice of the most frames a second the 3D scene draws, *Bildrate*: Unbegrenzt, 60 or 30.
_Avoid_: FPS cap, refresh rate

**Canvas chip**:
A surface lying over the 3D scene, from a live label to the builder's inspector sheet: the card colour, nearly opaque, without blur.
_Avoid_: Glass chip, badge

**Motion setting**:
A browser's choice of motion tier, *Bewegung*: Automatisch, where measured strain decides, or Voll or Reduziert, which hold. It never chooses still.
_Avoid_: Motion mode, animation setting

**Range card**:
A card over the range whose content a finger drags to the earlier or later range, the neighbour already beside it.
_Avoid_: Swipe card, pager card

**Segmented control**:
A row of a few words, one chosen, its pressed box sliding to the next choice: the hero's 3D/2D toggle is one.
_Avoid_: Toggle group, pill tabs, switcher

**Chart entrance**:
How a chart first shows: it builds up from its baseline and fades in.
_Avoid_: Chart animation, intro

**Template**:
A ready-made starting scene the builder offers when the scene is empty.
_Avoid_: Preset (a preset is a camera view)

**Computed device**:
A device whose readings the core computes or fetches instead of polling hardware: a tariff, a price feed, a forecast, the plant aggregates.
_Avoid_: Virtual device, coded device

**Forecast**:
A value issued at one time about a later target time.
_Avoid_: Prediction, projection

**Solar forecast**:
The forecasts of the plant's PV power per string, MPPT input and inverter, made from weather forecasts and corrected.
_Avoid_: PV prediction, yield forecast (a year's run gives a yield)

**Load forecast**:
The forecasts of one consuming measurement point's own consumption; summed, they forecast the house load.
_Avoid_: Consumption forecast, demand forecast

**Forecast accuracy**:
How far a series' day-ahead forecasts missed what was measured, over the last 30 days: per quarter hour, and in daily energy.
_Avoid_: Skill, forecast quality

**Clear-sky index**:
The plant's measured PV energy over a quarter hour divided by what it would make under a clear sky: how clear the sky really was.
_Avoid_: Clearness (alone), cloud factor

**Weather code**:
The WMO code the weather provider gives an instant: clear, cloudy, fog, drizzle, rain, snow, showers or thunder, with intensity.
_Avoid_: Condition, weather type

**Trial weather**:
A whole instant's weather the builder's weather button shows the plant in, in place of the stored weather; held by the page, never saved. German UI: the button's words (Klar, Regen, …).
_Avoid_: Sample (a reading), preset (a camera view), demo weather

**Typical year**:
One year of weather for a rounded location, each calendar month taken whole from the past year closest to twenty or more of them, at quarter hours; the year an offer's expected yield (P50) is simulated on.
_Avoid_: TMY, average year, reference year

**Irradiance map**:
A roof face's yearly irradiation per square metre, sampled over the face and drawn on it, shaded as the year's run shades.
_Avoid_: Heat map, solar map

**Cautious yield**:
The yearly yield exceeded in nine years of ten (P90): the simulated typical year less 1.2816 deviations of past years' irradiation on the planes over the typical year's.
_Avoid_: Worst case, minimum yield

**Loss chain**:
The energy a year's run leaves after each named loss, from irradiation on the planes at the datasheet's efficiency to what an inverter delivers; the losses sum to the whole. A loss the run did not compute is absent. German UI: Verlustkette.
_Avoid_: Loss tree, waterfall (a chart of it), performance ratio

**Clipping**:
The loss of the chain the inverter's AC rating cuts from its DC power. German UI: Kappung am Wechselrichter.
_Avoid_: Curtailment, Abregelung (both the feed-in an export cap holds back)

**Correction**:
A multiplier the plant learns per MPPT input, plant-local month and hour: measured over modelled PV power on past weather.
_Avoid_: Calibration, bias factor

**Tariff**:
The prices the plant pays for a kWh bought and earns for a kWh fed in, each a base price with optional bands, and a standing charge, applying from a date.
_Avoid_: Rate plan, contract

**Standing charge**:
The fixed amount a tariff bills each month whatever is bought, spread evenly over the month. German UI: Grundpreis.
_Avoid_: Base price (a flow's price where no band applies), grid fee, monthly fee, base fee

**Band**:
A tariff price that holds on given weekdays for a span of the plant-local wall-clock day.
_Avoid_: Time slot, period, window

**Spot price**:
A bidding zone's day-ahead wholesale price for one slot, before grid fees, levies and taxes.
_Avoid_: Dynamic tariff, market price

**Savings**:
The bill without the plant, the whole house load bought at the import price, less the bill with it.
_Avoid_: Profit, yield

**Payback**:
The savings summed since the first, against the investment amount the admin enters.
_Avoid_: Amortisation, return on investment

**Pace**:
The savings of the last twelve months, the rate at which payback is projected.
_Avoid_: Savings rate, trend

## Remote access

**Install id**:
The globally unique identity of one install, created at first run. One install is one plant.
_Avoid_: Plant id, serial

**Relay**:
The cloud service that carries encrypted traffic between a core and its paired clients without reading it.
_Avoid_: Cloud backend, proxy, tunnel server

**Account**:
A cloud identity, signed in by social login, that routes to installs and holds a passkey-wrapped key.
_Avoid_: User (a user is local), profile

**Device key**:
The X25519 key pair one browser or app generates, used as its Noise static key; the core trusts it when an account it trusts has signed it.
_Avoid_: Session key, token

**Organisation**:
An installer company in the cloud identity, with members; a homeowner may grant it access to an install.
_Avoid_: Business, company account, tenant

**Share code**:
The code an organisation gives a homeowner to grant access; it carries the organisation key's fingerprint.
_Avoid_: Invite, referral

## Platform

**Feature module**:
A part of the core that owns its tables and is reached only through its interface: commands, queries and the events it publishes.
_Avoid_: Service, component

**Session**:
One browser's sign-in, carried by a cookie and ended by 30 days without use.
_Avoid_: Login, token

**Viewer**:
A local account the admin creates that reads live values and history and changes nothing.
_Avoid_: User, guest

**Token**:
A secret an integration sends instead of signing in, scoped to read or to everything the admin does.
_Avoid_: API key, password

**Capability**:
A statement of what the core, a profile or a device supports, published in one document.
_Avoid_: Feature flag
