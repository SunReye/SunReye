# 33. Site context

Status: accepted (2026-11-26)

## Context

ADR 20 fetched no map data in Home: a tile service would learn the home's address. An aerial image and neighbours came only from an embedding app, as flat prisms on a level studio floor. Tracing a roof without a picture of it is guesswork, and a house on a slope among real roofs shades differently from one on a level floor. The owner wants Home to get the same geometry and editor as the embedding app, the site included, without giving up privacy by default.

## Decision

**Opt-in.** Home offers one action, "Load site from public data", which loads the aerial image, the terrain and the neighbouring buildings. Nothing is fetched until the admin chooses it. Without it, the scene stands on the studio floor as before. An embedding app may load the site always.

**Aerial image.** Home may fetch aerial tiles from a state's WMS. The core fetches them, never the browser, and stores them locally. The image is for tracing: it can be hidden, and is hidden after tracing.

**Sources.** One list of regions and their public services (aerial image, terrain, building models), shared by Home and the embedding app. Hessen first.

**Terrain.** The 1 m terrain model (DGM1) as a mesh to about 250 m around the plant, the aerial image draped on it. A building stands at the lowest ground point of its footprint, and its walls reach the ground. The horizon beyond 250 m comes from elevation data.

**Neighbours.** The buildings around the plant, from the state's LoD2 building model, with their real roofs, each on its own ground.
- Read-only and not saved: they are reloaded from the source.
- The admin may hide or delete one. Editing one saves the plant's own copy, which replaces the official one.
- A simple neighbour may be added by hand.
- All of them shade.

They replace ADR 20's prisms supplied by the consumer.

## Open

- **Location.** Home stores its location rounded to 0.01° (ADRs 17, 26), about a kilometre; fetching the site needs the house's position. Whether the admin places the house on a larger area, or the exact position is stored for this.
- **Building models.** Hessen serves LoD2 only as zips per town; how the core gets the buildings near one house.
- **Horizon.** The elevation source and range Home reads beyond 250 m, and whether it replaces the caller-supplied horizon profile (ADR 17).
- **Stored where.** Where the tiles, terrain and the plant's own neighbour edits are kept, whether a backup carries them, and whether the plant document (ADR 26) carries the neighbour edits.
- **Credits.** The About page's credits for site data a homeowner loaded (ADR 26 *Credits*).
- **Refresh.** When loaded site data is fetched again.

## Considered options

- **No map data in Home** (ADR 20, ADR 25 *Imagery stays out of Home*). Reversed: tracing needs the picture, and an opt-in fetch from a state's service, never a commercial tile service, keeps privacy the admin's choice.
- **Surroundings from OpenStreetMap and Terrain Tiles** (ADR 20, removed 2026-11-16). Stays rejected: neither looked good nor helped.
- **Neighbours as prisms** (ADR 20). Rejected: a flat top misses the shade of a real pitched roof.
- **The browser fetches the tiles.** Rejected: the core keeps them, so a viewer's browser sends nothing.

## Consequences

Home makes outbound requests to state services, on the admin's action only. The scene's ground is no longer level once a site is loaded, so shading, the camera and placing on the ground read the terrain.
