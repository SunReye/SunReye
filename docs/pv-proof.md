# PV model: the proof against pvlib

How close a year's run of `sunreye_pv` comes to pvlib on four plants. Decision: ADR 17. Model: [pv-model.md](pv-model.md). Test: `crates/pv/src/tests/proof.rs`. Reference: `crates/pv/fixtures/proof.py`, pvlib 0.16.1.

## Result

The crate's yearly energy against pvlib's, per string and MPPT input; the tolerances are ADR 17's.

| Plant | pvlib | Crate | Deviation | Tolerance, year | Tolerance, month |
| --- | --- | --- | --- | --- | --- |
| Open roof | 6683.6 kWh | 6683.7 kWh | +0.000 % | 0.1 % | 0.1 % |
| Two orientations on one input | 6892.4 kWh | 6892.5 kWh | +0.003 % | 0.1 % | 0.1 % |
| Shaded roof | 5838.2 kWh | 5839.0 kWh | +0.013 % | 0.1 % | 0.1 % |
| Rack field | 6354.1 kWh | 6355.8 kWh | +0.027 % | 0.1 % | 0.1 % |

The two east and west strings each keep within 0.004 % of theirs.

By UTC month, in %:

| Plant | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open roof | −0.00 | −0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | −0.00 | −0.00 |
| Two orientations | +0.00 | +0.01 | +0.01 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 |
| Shaded roof | +0.00 | +0.01 | +0.02 | +0.01 | +0.01 | +0.01 | +0.01 | +0.01 | +0.02 | +0.01 | +0.00 | +0.00 |
| Rack field | +0.02 | +0.04 | +0.03 | +0.03 | +0.03 | +0.02 | +0.03 | +0.03 | +0.03 | +0.03 | +0.03 | +0.02 |

Without shade the crate matches pvlib's chain. With shade a year agrees within 0.03 % and every month within 0.04 %. With the beam's shade traced at every hour's own sun (`traced_every_hour_a_shaded_plants_months_match_pvlib`, as the solar forecast runs) the months are the same.

## The plants

All at Berlin (52.52° N, 13.38° E), one MPPT input each, of the crate's test module (Vmp 34 V, Imp 11.76 A, Voc 41 V, Isc 12.5 A, 1.134 × 1.722 m, three bypass diodes), with no string loss.

- **Open roof:** 16 modules facing south at 35°, nothing around them.
- **Two orientations on one input:** 10 modules facing east and 10 facing west at 20°, in parallel, on an input with a window of 150–850 V, a 180 V start and 30 A.
- **Shaded roof:** 16 modules facing south at 35° in portrait, two rows of 8 in one string, and a wall 4 m tall standing 8 m south of the lower row's edge. Through the winter its shadow covers the lower row, the upper row less, so the string's curve steps at its bypass diodes.
- **Rack field:** 16 modules facing south at 25° in landscape, one row in a field of rows 2.5 m apart. The row in front shades the lowest substrings first.

pvlib knows no scene, so both shaded plants use an obstacle that pvlib models in two dimensions. In the crate, the wall and the row in front are 600 m long.

## The weather

The year is made up, not measured. It is Ineichen's clear sky at a Linke turbidity of 3, dimmed by a fixed pattern of clear, broken and overcast days, and split into beam and diffuse light by Erbs. Temperature follows the season and the hour, and wind runs from 0.5 to 4.1 m/s. That gives 8760 hourly samples, each stamped at the middle of its hour, 4393 of them lit, and 940 kWh/m² of global irradiation. The values are rounded and committed (`proof-weather.csv`), and pvlib reads the same numbers back. Both sides hold each sample for the hour and count it in the UTC month of its stamp.

## What pvlib computes

At every lit hour, independently of the crate's code:

- **Sun:** NREL SPA (`solarposition.spa_python`), geometric.
- **Light on the plane:** Perez (`irradiance.get_total_irradiance`, `irradiance.perez` for its parts), with ground light at albedo 0.25, Martin and Ruiz on the beam, 0.95 on diffuse light.
- **Cell temperature:** Faiman, from the open plane's irradiance.
- **Electrics:** `ivtools.sdm.fit_desoto`, `pvsystem.calcparams_desoto` per substring, `pvsystem.v_from_i`, bypass diodes at −0.5 V. Each peak is found by a dense grid refined with SciPy, and parallel strings share one voltage (`generate.py`).
- **Beam shade:** a substring loses its beam, and the circumsolar part of diffuse light, when any part of it lies in the shadow. That is judged by the sun's elevation projected across the wall (`shading.projected_solar_zenith_angle`) against the wall's top seen from the substring's lower edge, and in the field by `shading.shaded_fraction1d`.
- **Diffuse shade:** each substring's isotropic and horizon-band light is scaled by its strip's average view of the sky over the open sky's. Beside the wall this is the two-dimensional closed form (1 + cos(tilt + top)) / (1 + cos tilt), averaged along the strip. In the field it is `bifacial.utils.vf_row_sky_2d_integ`. Ground light stays, as in the crate.

The rules for which light shade takes are ADR 17's, since pvlib has no rule for a substring. The geometry and every number come from pvlib.

## How the crate shades a substring

The crate judges a substring at its sample points: 27 per substring, 3 across and 9 along, edge to edge, the outer ones 0.1 mm inside its edges (ADR 17, `shade.rs`).

- **Beam:** a substring loses its beam when any sample point is shaded, so as soon as the shadow reaches its edge, as pvlib has it. A year's run looks this up at the 2° grid's node nearest the sun, and traces it at the sun itself wherever the four nodes around the sun disagree, so a shadow's edge falls where the sun puts it (#890).
- **Sky view:** at each node of the 2° grid a substring's view is closed by its shaded sample points' share, weighed by the trapezoid rule, so its view is its mean, as pvlib's along its strip. Each substring's view, against pvlib's:

| Substring | Crate | pvlib |
| --- | --- | --- |
| Shaded roof, lower row | 0.84871 | 0.84871 |
| Shaded roof, upper row | 0.90983 | 0.90979 |
| Rack field, lowest | 0.93369 | 0.93321 |
| Rack field, middle | 0.96912 | 0.96947 |
| Rack field, highest | 0.99166 | 0.99180 |

## Before #890

A year's run looked a substring's beam shade up at the grid node nearest the sun, which moved the shadow's edge by up to a node's half-width. It weighed most where the sun stands near an obstacle's top for hours: the upper row's lower edge sees the wall's top at 17.7°, and the noon sun stands between 14° and 20° from December to January. An hour that the grid counted lit and pvlib shaded moved that whole hour's beam, so October read low and the other winter months high. Now a step traces, at the sun itself, each module with a substring on whose beam the four nodes around the sun disagree (ADR 17).

| Plant | Year | Jan | Feb | Oct | Nov | Dec |
| --- | --- | --- | --- | --- | --- | --- |
| Shaded roof | +0.119 % | +4.37 | +2.78 | −1.56 | +3.01 | +0.00 |
| Rack field | +0.128 % | +1.94 | +0.04 | −0.00 | +2.43 | −0.55 |

From March to September every month kept within 0.07 %.

## Before #889

The sample points stood inset half a spacing from the edges: 0.096 m above a portrait module's edge, 0.063 m above each landscape substring's. The beam went only once the shadow passed that inset, and a node closed whole on any shaded sample, so a substring took about its lowest sample point's view.

| Plant | Year | Worst month | Summer |
| --- | --- | --- | --- |
| Shaded roof | −0.615 % | +3.62 % (Oct), −3.56 % (Dec) | about −1.1 % |
| Rack field | +0.006 % | +7.09 % (Jan) | about −0.45 % |

The rack field's winter months read high, which flatters an offer; behind the wall the summer read low. Over a year they offset.

## Not compared

- **The AC side.** It is pvlib's `inverter.pvwatts` by construction and has its own tests.
- **Cables, soiling, degradation, the loss chain and the typical year.** These are arithmetic on the run, each with its own test.
- **The horizon profile.** It is checked by its own tests (`tests/horizon.rs`).
- **A three-dimensional scene.** pvlib has none. The crate's shade is checked by hand-worked cases (`tests/shade.rs`, `roofing.rs`, `surroundings.rs`).
- **Measured production.** Checking the model against plants on SunReye Home is the other half of ADR 17's proof, and it is still open.

## Running it

```sh
cd crates/pv/fixtures && uv run --with pvlib==0.16.1 python proof.py   # about 5 minutes
cargo test -p sunreye-pv proof -- --nocapture                          # prints the deviations and views
```
