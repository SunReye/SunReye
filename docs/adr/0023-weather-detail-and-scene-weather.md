# 23. Weather detail and scene weather

Status: accepted (2026-11-17), amended (2026-11-17)

## Context

The weather device (ADR 17) stores irradiance, temperature and wind. The scene's light (ADR 20) and the dashboard's sky word read one number from it: the forecast's diffuse share of the global irradiance. Two faults follow. Under a closed sky the sun keeps a third of its light and casts soft shadows, which an overcast day does not. And the forecast for now is a forecast: when it misses, the scene shows sun under a grey sky. Rain, snow, fog and lying snow are not known at all.

## Decision

**Quantities.** The weather device gains these `weather.*` roles, forecast and archive alike (ADR 17):

| Role | Unit | Step | Resolution |
|---|---|---|---|
| `weather.code` | WMO weather code, unitless | 1 | 15 min |
| `weather.precipitation` | mm/h | 0.01 | 15 min |
| `weather.snowfall` | cm/h | 0.01 | 15 min |
| `weather.visibility` | m | 1 | 15 min |
| `weather.humidity` | % | 0.1 | 15 min |
| `weather.wind_direction` | ° (0 north, 90 east) | 1 | 15 min |
| `weather.gusts` | m/s | 0.01 | 15 min |
| `weather.apparent_temperature` | °C | 0.1 | 15 min |
| `weather.sunshine` | s per hour | 1 | hourly |
| `weather.cloud_cover` | % | 1 | hourly |
| `weather.snow_depth` | m | 0.001 | hourly |

One Open-Meteo request asks for `minutely_15` and `hourly` together. Sunshine is summed into hours, so the forecast and the archive share one scale. A quantity the provider has only hourly is stored at hourly targets in the same store, and a reader holds a value until the next target, an hour at most. The archive has no visibility and no thunderstorms: past fog comes from the code alone. Cloud layers, rain apart from snow, showers, freezing level and lightning are not stored. Once after the upgrade, a background job fetches the archive for the new quantities over the whole span weather history already covers.

**Clear-sky index.** The weather device stores `weather.clearness` as history: over each 15 minutes, the plant's measured PV energy divided by the energy the `pv` crate models for a clear sky with each input's correction applied (ADR 17). It is plant-wide: the inputs at their AC limit or without readings leave both sums. It is null with the sun under 5°, with no input left, or while the modules are snow-covered. The same job computes it back over stored PV history.

**Snow-covered modules.** Modules count as snow-covered while `weather.snow_depth` is at least 1 cm and measured PV is under 5 % of the clear-sky estimate in daylight. For instants without readings they never do.

**The sky.** The scene and the sky word take the cloud at an instant from `weather.clearness` where it has a value, so now and the past show the sky that was measured. Elsewhere they take it from the forecast or the archive: the diffuse share, with `weather.cloud_cover`. Precipitation, snow, fog and thunder always come from `weather.code` and the amounts, which no reading measures.

**Light.** Amending ADR 20: as the sky closes, the sun's cast shadows fade out completely. A weak directional term is left, so faces turned to the sun stay a little brighter and the white model keeps its form; ambient occlusion keeps the contacts.

**Scene weather.** It follows the instant shown, as the light does: the dashboard's now and the time slider's. Dates with neither forecast nor archive are clear and dry.

- *Rain and snow:* particles drawn in the scene's own render, without a pass. Their density follows precipitation or snowfall; they slant with the wind's speed and direction; snow drifts, rain streaks. They move on the full tier only; lite draws a sparse still field; still and reduced motion draw none.
- *Lens glass:* one fragment pass after tone mapping, at reduced resolution. Rain beads and runs down it and refracts the scene; snow settles at its edges and melts; frost creeps in from the corners below about 0 °C in humid air. It is sparse and weighted to the edges, so the middle of the plant stays readable, and fades in and out with the weather. Full tier only, and off at *Niedrig*. Labels, the inspector and hit-testing sit above it: it bends only the rendered scene.
- *Fog:* the scene's distance fog thickens toward grey as visibility falls, or on codes 45 and 48, scaled to the plant's own distances so it deepens away from the camera; the backdrop greys with it, so the floor no longer lands on the page colour while fog stands.
- *Wet ground:* the ground and roofs darken while precipitation is above 0 and dry back over about an hour.
- *Lying snow:* the ground and roofs whiten while snow depth is at least 1 cm; snow-covered modules are drawn white.
- *Thunder:* codes 95–99 close the sky and dim the whole scene's light by about a third. No lightning flashes.
- On every tier the light, fog, wet ground and lying snow carry the weather.

**Motion.** Amending ADR 20's "no continuous loop": while moving particles or glass are shown, on the full tier, the scene renders in a loop capped at 30 fps. The loop pauses while the tab is hidden or the canvas is off screen, and stops when the weather turns dry. The frame watch (ADR 21) counts its frames, so a device that struggles drops to lite, where nothing loops.

**Builder.** While the admin edits, the builder leaves out glass, particles, fog and wet ground, so faces and edges stay exact. The light and lying snow follow the instant shown. Outside editing, its time slider shows the weather as the dashboard does.

**Off switch.** A per-browser *Wettereffekte* switch under Settings › Display, on by default, removes particles, glass, fog, wet ground and lying snow. The weather light stays: it is how the scene is lit. Reduced motion and the low-power switch still force the still tier. The 2D flow draws no weather.

**Dashboard.** The now strip's weather cell shows an icon and a word from `weather.code`; its cloud part ("Sonnig", "Heiter", "Bewölkt", "Bedeckt") follows the clear-sky index for now where it has a value. The weather detail shows today and the next two days by the hour: the code's icons; temperature with apparent temperature; precipitation bars, snow in its own colour; cloud cover, with the clear-sky index over it for past hours; wind with a direction arrow and gusts; humidity; sunshine per day; snow depth while snow lies and visibility on fog.

**Explore.** The new roles are history like any other (ADR 22). `weather.code` is drawn as a band of states, not a line.

## Considered options

- **Shadows kept under a closed sky (ADR 20 before).** Rejected: an overcast day casts none; ambient occlusion keeps the form.
- **The forecast alone for now.** Rejected: when it misses, the scene contradicts the window.
- **Blending the clear-sky index with the forecast.** Rejected: a measurement of now needs no forecast.
- **The clear-sky index computed in the browser.** Rejected: the core has the model and the corrections, and a stored series serves past instants and every client.
- **Cloud layers (low, mid, high).** Rejected: the forecast and the archive draw their bounds at different heights.
- **Stepped particles, a few times a second.** Rejected: rain stutters.
- **Light and fog only.** Rejected by the owner: the scene should show rain and snow.
- **Lightning flashes.** Rejected: flashes can trigger photosensitive seizures.

## Consequences

The weather device's role set and the clear-sky index are published; Open-Meteo's code table becomes part of the API's meaning. The weather fetch grows by an hourly block. The clear-sky index is not recomputed when the layout or a correction changes; past quarters keep the index of their time. The scene gains a render loop and a post pass, both bounded to the full tier and wet weather. Snow-covered modules no longer read as a closed sky.
