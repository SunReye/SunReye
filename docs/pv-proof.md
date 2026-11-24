# PV model: the proof against pvlib

How close a year's run of `sunreye_pv` comes to pvlib on four reference plants. Decision: ADR 17. Model: [pv-model.md](pv-model.md). Test: `crates/pv/src/tests/proof.rs`. Reference: `crates/pv/fixtures/proof.py`, pvlib 0.16.1.

## Result

The crate's yearly energy against pvlib's, per string and MPPT input; the tolerance is ADR 17's.

| Plant | pvlib | Crate | Deviation | Tolerance |
| --- | --- | --- | --- | --- |
| Open roof | 6683.6 kWh | 6683.7 kWh | +0.000 % | 0.1 % |
| Two orientations on one input | 6892.4 kWh | 6892.5 kWh | +0.003 % | 0.1 % |
| Shaded roof | 5838.2 kWh | 5802.3 kWh | −0.615 % | 1 % |
| Rack field | 6354.1 kWh | 6354.5 kWh | +0.006 % | 1 % |

The two east and west strings each keep within 0.004 % of theirs.

By UTC month, in %:

| Plant | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open roof | −0.00 | −0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | −0.00 | −0.00 |
| Two orientations | +0.00 | +0.01 | +0.01 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 |
| Shaded roof | +1.44 | +1.74 | −0.71 | −1.07 | −1.17 | −1.12 | −1.15 | −1.07 | −1.00 | +3.62 | +3.60 | −3.56 |
| Rack field | +7.09 | +0.40 | −0.42 | −0.44 | −0.47 | −0.45 | −0.46 | −0.44 | −0.42 | −0.19 | +6.75 | +1.44 |

Unshaded, the crate is pvlib's chain. Shaded, a year agrees within 1 % and a month within 7 %, for the two reasons below.

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

## Why the shaded plants differ

- **Sky view at a substring's edge, not its mean.** The crate closes a node of its 2° grid whole when any of the substring's sample points is shaded there (ADR 17). Its view is therefore about the lowest sample point's view, while pvlib averages along the strip. Beside the wall the lower row sees 0.816 of the open sky in the crate and 0.849 in pvlib. In the field the three substrings see 0.917, 0.959 and 0.986 against pvlib's 0.933, 0.969 and 0.992. This makes the crate read about 1.1 % low through the summer on the shaded roof and 0.45 % low on the rack field, conservative on both.
- **When the beam goes.** The crate decides shade by 27 sample points per substring, inset from its edges, at the 2° node nearest the sun. pvlib decides it at the substring's edge, at the sun's exact position. At hourly samples, an hour that one side counts as shaded and the other as lit moves a whole hour's beam. In the winter months, with few lit hours, that swings a month by up to 7 %, in both directions. Over the year these swings largely offset the summer's view.

## Not compared

- **The AC side.** It is pvlib's `inverter.pvwatts` by construction and is tested on its own (`tests/year.rs`).
- **Cables, soiling, degradation, the loss chain and the typical year.** These are arithmetic on the run, each with its own test.
- **The horizon profile.** Its sky views are checked against closed forms (`skyview.csv`).
- **A three-dimensional scene.** pvlib has none. The crate's shade is checked by hand-worked cases (`tests/shade.rs`, `roofing.rs`, `surroundings.rs`).
- **Measured production.** Checking the model against plants on SunReye Home is the other half of ADR 17's proof, and it is still open.

## Running it

```sh
cd crates/pv/fixtures && uv run --with pvlib==0.16.1 python proof.py   # about 5 minutes
cargo test -p sunreye-pv proof -- --nocapture                          # prints the deviations
```
