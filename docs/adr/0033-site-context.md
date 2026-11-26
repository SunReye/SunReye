# 33. Site context

Status: accepted (2026-11-26)

## Context

ADR 20 fetched no map data in Home: a tile service would learn the home's address. An aerial image and neighbours came only from the builder's consumer, as flat prisms on a level studio floor. Tracing a roof without a picture of it is guesswork, and a house on a slope among real roofs shades differently from one on a level floor. The owner wants Home to have its site without giving up privacy by default.

## Decision

**Opt-in.** Home offers one action, "Load site from public data". Nothing is fetched until the admin chooses it. Without it, the scene stands on the studio floor as before.

**Location.** The exact position is stored in the core only once the admin opts in; otherwise the location stays rounded to 0.01° (ADRs 17, 26). Weather requests stay rounded after opting in. Opting out rounds the stored location again.

**Aerial image and terrain first.** Home's site starts with the aerial image and the terrain. Neighbours from the state's building model come later.

**Aerial image.** Home may fetch aerial tiles from a state's WMS. The core fetches them, never the browser, and stores them locally. The image is for tracing (ADR 30, *Tracing*). A toggle shows or hides it; it is hidden by default once a building exists.

**Sources.** One list of regions and their public services (aerial image, terrain, building models). Hessen first.

**Terrain.** The 1 m terrain model (DGM1) as a mesh to about 250 m around the plant, the aerial image draped on it. A building stands at the lowest ground point of its footprint, and its walls reach the ground. The horizon beyond 250 m comes from elevation data.

**Neighbours.** The buildings around the plant, from the state's LoD2 building model, with their real roofs, each on its own ground.
- Read-only, and reloaded from the source rather than saved.
- The admin may hide one, which is not drawn and still shades, or delete one, which neither draws nor shades. The plant keeps both lists, by each building's id in the source.
- Editing one saves the plant's own copy, which replaces the official one. A simple neighbour may be added by hand.
- The forecast shades with the neighbours, as the editor does, so the scene and the forecast never disagree.

They replace ADR 20's prisms supplied by the consumer.

## Open

- **Building models.** Hessen serves LoD2 only as zips per town, too heavy for a home's core; how it gets the buildings near one house.
- **Horizon.** The elevation source and range Home reads beyond 250 m, and whether it replaces the caller-supplied horizon profile (ADR 17).
- **Stored where.** Where the tiles, terrain and the plant's neighbour edits are kept, whether a backup carries them, and whether the plant document (ADR 26) carries the neighbour edits.
- **Credits.** The About page's credits for site data a homeowner loaded (ADR 26 *Credits*).
- **Refresh.** When loaded site data is fetched again.

## Considered options

- **No map data in Home** (ADR 20, ADR 25 *Imagery stays out of Home*). Reversed: the aerial image is for tracing, and fetching is the admin's opt-in.
- **Surroundings from OpenStreetMap and Terrain Tiles** (ADR 20, removed 2026-11-16). Stays removed: neither looked good nor helped.
- **Neighbours as prisms** (ADR 20). Replaced by LoD2 buildings with real roofs.
- **Only the editor shades with neighbours** (ADR 20). Rejected: the forecast would disagree with the scene.

## Consequences

Home makes outbound requests to state services, on the admin's action only. Once a site is loaded, the ground is no longer level.
