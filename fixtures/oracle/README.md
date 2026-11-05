# Oracle fixture corpus

What the 2.x TypeScript engine does, recorded as data, so the Rust core can be proved against it after the
engine is deleted (ADR 0002). Every golden value comes from running the 2.x code; nothing is derived by hand.

```sh
bun scripts/oracle/generate.ts      # rebuild everything
bun run test:oracle                 # database-free groups: freshness, replay, README coverage
bun run test:db                     # database groups, among the rest of that layer
```

- **Deterministic.** No clock, no randomness: a second run is byte-identical.
- **Fresh.** A committed file that differs from what its generator produces fails a test.
- **Where it runs.** Transport framing and profile decode need no database. Rollups, statistics and archives run as
  `apps/server/db-tests/oracle.test.ts` against TimescaleDB, only on `sunreye_dbtest` (`DB_TEST_URL` names the
  server). The generator refuses `--database-url` / `ORACLE_DATABASE_URL` naming any other database. No live inverter
  and no production database is touched; transport cases talk to a loopback server on `127.0.0.1`.
- **Profiles.** Profile decode reads a `SunReye-Official-Profiles` checkout: `SUNREYE_PROFILES_DIR`, else the sibling of
  the main checkout. Each line carries the metric definitions it decoded with and the profile file's `sha256`.

## What 2.x does that the core must decide about

- **`rtu-over-tcp` writes MBAP frames, not RTU.** modbus-serial's `TcpRTUBufferedPort` strips the CRC and adds a Modbus
  TCP header, so the bytes equal `tcp`'s. It differs only in reading replies: it resynchronises on junk before a reply
  (`rtu-over-tcp/leading-junk` decodes, `tcp/leading-junk` times out).
- **Rollup buckets are UTC.** `minute_rollups`, `hourly_rollups` and `daily_rollups` use `time_bucket` without a zone;
  the plant zone enters only in the statistics reads, which label a UTC bucket with the local date and hour it
  starts on. A day bucket therefore does not move on a DST day; `dailyLocal` (from hourly buckets) does.
- **A tier replays only the UTC days it covers whole.** Partial days in an archive are reported as `no tier covered`
  and not imported.
- **A counter delta chains to the previous bucket's high.** A restart books 0 for the restart hour and the hour after;
  a single spurious low read costs one bucket and books the whole rise back in the next.
- **No yearly query exists.** `yearly` folds the monthly totals with `derivePeriodEnergy`.

## 1. `transport.ndjson`: transport framing

One line per case. `exchanges` is the wire in order: `{dir:"tx",hex}` is a request the 2.x client wrote,
`{dir:"rx",chunks:[hex…]}` is one reply as the server sent it (one entry per TCP read; `decoded` on Solarman frames is
`decodeFrame` of each), `result` is what `ModbusTransport` returned or `{error:{name,message,modbusCode?,errno?}}`.
`device` maps register to word, `deviceUnits` the unit ids that answer, `metrics` the profile decoded with.
Replay: send each `rx` when its preceding `tx` arrives. Producer: `ModbusTransport.read` / `write` / `probeUnit`
(`packages/inverter-core/src/modbus-transport.ts`), through `connectTCP`, `connectTcpRTUBuffered`, `SolarmanV5Port`.

| framing | cases |
| --- | --- |
| `tcp`, `rtu-over-tcp`, `solarman-v5` | `read-unit-1`, `read-unit-0` (unit ids 1 and 0), `write-register` (FC16 for one word), `probe-unit` (silent unit 0, answering unit 1), `fragmented-reply` (reply split across reads), `leading-junk`, `exception-2-split` (atomic group refused with exception 2, plan splits) |
| `solarman-v5` only | `logger-serial-discovery`, `transient-05-retried`, `persistent-05-is-exception-2`, `wrong-serial-06`, `heartbeat-and-stray-frames` |

Case names are `<framing>/<case>`:
`tcp/read-unit-1` `tcp/read-unit-0` `tcp/write-register` `tcp/probe-unit` `tcp/fragmented-reply` `tcp/leading-junk`
`tcp/exception-2-split` `rtu-over-tcp/read-unit-1` `rtu-over-tcp/read-unit-0` `rtu-over-tcp/write-register`
`rtu-over-tcp/probe-unit` `rtu-over-tcp/fragmented-reply` `rtu-over-tcp/leading-junk` `rtu-over-tcp/exception-2-split`
`solarman-v5/read-unit-1` `solarman-v5/read-unit-0` `solarman-v5/write-register` `solarman-v5/probe-unit`
`solarman-v5/fragmented-reply` `solarman-v5/leading-junk` `solarman-v5/exception-2-split`
`solarman-v5/logger-serial-discovery` `solarman-v5/transient-05-retried` `solarman-v5/persistent-05-is-exception-2`
`solarman-v5/wrong-serial-06` `solarman-v5/heartbeat-and-stray-frames`.

## 2. `profile-decode.ndjson`: profile decode

One line per official profile. `profile` is `{id,name,manufacturer,version,sha256}`, `metrics` the register-bound and
computed metrics (`via`, `type`, `addr`, `scale`, `offset?`, `range?`, `expr?`), `blocks` the 2.x read plan
(`planReads`, tolerance 0). Each case has `runs` (`{start,words}`, the registers answered), `readings` (key to value; a
metric whose register went unanswered is absent) and `clamped` (key to the value before its `range` clamp).
Producer: `decode` and `applyComputed` (`packages/inverter-core/src/codec.ts`, `computed.ts`).

Cases per profile: `zeros`, `ramp`, `all-ones` (signed -1, double word 2^32-1, range clamps), `sign-bit`,
`first-block-absent`, `double-word-split` (one word of a double word unanswered).

Profiles: `deye-sg01hp3` `deye-sg01hp3-10k` `deye-sg01hp3-12k` `deye-sg01hp3-15k` `deye-sg01hp3-20k`
`deye-sg01hp3-25k` `deye-sg01hp3-5k` `deye-sg01hp3-6k` `deye-sg01hp3-8k` `deye-sg05lp3` `deye-sun10k-sg05lp3`
`deye-sun12k-sg05lp3` `deye-sun14k-sg05lp3` `deye-sun15k-sg05lp3` `deye-sun16k-sg05lp3` `deye-sun18k-sg05lp3`
`deye-sun20k-sg05lp3` `deye-sun5k-sg05lp3` `deye-sun6k-sg05lp3` `deye-sun8k-sg05lp3`.

`profile-manifest.ndjson` has the same profiles in the same order. Each line is `{profile:{id,sha256},manifest}`,
`manifest` being the `/api/profile` body 2.x answers: identity, derived `capabilities` and one render-ready entry per
metric (`kind` and `storage` resolved, absent fields omitted). Producer: `buildManifest`
(`packages/inverter-core/src/capabilities.ts`). `role-kinds.ndjson` is one line: every canonical role to the
metric kind it prescribes (`ROLE_CATALOG`, `roles.ts`), for a metric that states no kind.

## 3. `rollups.ndjson`: rollups

One line per case, plant zone `Europe/Berlin`. `readings` is the input: metric key to `[instant, value]`; `counters`
lists the lifetime counters (`is_counter`). `tiers` is the output: metric key, then `minute` / `hour` / `day`, each a list
of `{time,avg,max,min}` for the buckets that hold data (`avg` is the time-weighted mean, interpolated from the
neighbouring buckets). Producer: `queryRollup` (`apps/server/src/shared/history.ts`) over the three continuous
aggregates after `refresh_continuous_aggregate`.

| case | boundary |
| --- | --- |
| `dst-spring-2026-03-29` | local day of 23 hours |
| `dst-autumn-2025-10-26` | local day of 25 hours |
| `midnight-crossing` | value held across Berlin midnight |
| `counter-restart` | lifetime counter restarts inside an hour |
| `partial-window` | readings cover part of the day |
| `zero-and-negative` | zero and negative power, flat counters |
| `absent-readings` | four hours without readings |
| `stale-across-midnight` | last evening reading is the only one until morning |
| `day-register-reset` | `production.today` falls to 0 at midnight |
| `year-boundary` | readings across New Year |
| `spurious-low-read` | one counter sample reads far too low |

## 4. `statistics.ndjson`: statistics

Same case names and inputs as rollups. Per case: `window` (local-day aligned), `monthWindow`, `roles` (role to key),
`hourly` (energy per hour, `HourEnergy`), `daily` (UTC day buckets from `daily_rollups`), `dailyLocal` (plant-local days
from `hourly_rollups`), `monthly`, `yearly` (`PeriodEnergy`; load implied from the flows, the profile maps no load
counter). Producers: `fetchBucketEnergy`, `fetchCounterDeltaMatrix` + `accumulateTotals` + `derivePeriods` (the
composition `energySeries` runs; `apps/server/src/energy/`), and `derivePeriodEnergy` over summed months for `yearly`.
Cases: `dst-spring-2026-03-29` `dst-autumn-2025-10-26` `midnight-crossing` `counter-restart` `partial-window`
`zero-and-negative` `absent-readings` `stale-across-midnight` `day-register-reset` `year-boundary` `spurious-low-read`.

## 5. `archives/`: archives

One directory per archive: `archive.tar.gz` (the container), its members as text (`manifest.json`, `config.json`,
`config-log.ndjson`, `readings.ndjson`) and `expected-import.json`. Both are assembled with the 2.x writer
(`buildManifest`, `writeArchive`, `synthesiseSpine` in `packages/db/src/archive*.ts`) from authored rows, not exported:
`exportArchive` reads the first plant of its database and `sunreye_dbtest` is shared. They are imported by `importArchive`
through the `pg` client the `sunreye import` command uses; `expected-import.json` is what landed: `result`
(`skipped`, `inserted` per stream, `replays`, `problems`), then the plant, connections, devices, settings, installed
profiles, metric keys, raw rows, per-day counter energy and config log, read back by name.

| archive | content |
| --- | --- |
| `current-2.x` | battery, Solarman endpoint, automation enabled (`automations`) and its held register value (`automationState`), daily, hourly and raw history, a configuration register |
| `legacy-1.2.0` | spine synthesised from 1.x settings, device named by its profile id, daily, hourly (one whole day), minute (a partial day, not replayed) and raw history; a lifetime counter loses its total inside the raw day |

## 6. `forecast.ndjson`: PV forecast

One line per case: `{case,producer,input,output}`, database-free, produced by the 3.x code. Irradiance is a synthetic
bell computed by the generator, recorded in `input`; the second day of a series is dimmer.

- `sunPosition`: `input` `{latitude,longitude,atMs,planes}`, `output` `{sun:{elevationDeg,azimuthDeg},cosAoi}` with one
  `cosAoi` per plane. Producers: `sunPosition`, `cosAoi` (`apps/server/src/forecast/solar-geometry.ts`).
- `pvPowerW`: `input` `{sample,kwp,tempCoefficient,systemLoss}`, `output` `{watts}`. Producer: `pvPowerW` (`pv-model.ts`).
- `buildSolarForecast`: `input` `{config,data,provider,timeZone,nowMs,sim?,correction?}`, `correction` being the learned
  model as `month:hour` to `{ratio,weight}`; `output` `{raw,usable}`, each `toForecastExport` of that view. Producers:
  `buildSolarForecast`, `toForecastExport` (`solar-forecast.ts`), the `flowStep` clipping physics
  (`apps/server/src/energy/energy-flow.ts`) and `correctionFactor` (`forecast-correction.ts`).

| case | boundary |
| --- | --- |
| `geometry/summer-noon` | sun near the meridian, plane facing away (`tilt` 90, `azimuth` 180) |
| `geometry/winter-morning` | low sun in the south-east |
| `geometry/evening-west` | sun north of west, behind a south plane |
| `geometry/night` | sun below the horizon |
| `geometry/southern-hemisphere` | sun in the north |
| `power/no-dni-no-wind` | raw GTI, NOCT cell temperature |
| `power/iam-split` | beam/diffuse split with DNI and `cosAoi` |
| `power/iam-glancing` | beam at a glancing angle |
| `power/iam-beam-capped-by-gti` | projected DNI above GTI |
| `power/sun-behind-plane` | negative `cosAoi`: diffuse only |
| `power/faiman-wind` | Faiman cell temperature |
| `power/faiman-calm` | Faiman at 0 m/s |
| `power/iam-and-faiman` | both refinements |
| `power/dni-without-cos-aoi` | DNI alone falls back to raw GTI |
| `power/zero-coefficient-zero-loss` | 0 %/°C and 0 % loss |
| `power/cold-gain` | cell below 25 °C gains |
| `power/derate-floor` | derate below zero clamps to 0 W |
| `power/night` | no irradiance |
| `power/negative-gti` | negative GTI |
| `forecast/quarter-hour-grid` | 15-minute grid, DNI and wind |
| `forecast/hourly-grid` | hourly grid, no DNI or wind |
| `forecast/gap-over-an-hour` | three hours missing |
| `forecast/dst-spring-berlin` | 23-hour plant day, series at `+01:00`; `nowMs` 00:30 plant time, the previous UTC date; night irradiance from 18:00 the evening before |
| `forecast/dst-autumn-berlin` | 25-hour plant day, series at `+02:00`; `nowMs` 00:30 plant time, the previous UTC date; night irradiance from 18:00 the evening before |
| `forecast/empty-series` | no samples (`times: []`), battery and feed-in cap |
| `forecast/sun-behind-plane` | north-facing steep array |
| `forecast/no-arrays` | no arrays |
| `forecast/per-array-overrides` | per-array `tempCoefficient` / `systemLoss` over the plant default, 0 included |
| `forecast/feed-in-cap-only` | feed-in cap, no battery |
| `forecast/battery-live-soc` | battery, live SOC, no `dayStartSocPct`: past slots stay raw |
| `forecast/battery-negative-capacity` | negative `usableKwh` with a feed-in cap: past slots stay raw |
| `forecast/battery-day-start-soc` | battery with `dayStartSocPct`: past slots simulated through the night drain and a morning fill, re-seeded at the current slot |
| `forecast/battery-unknown-soc` | no SOC: starts at the reserve floor; unbounded charge rate |
| `forecast/battery-without-sim-inputs` | battery, no feed-in cap, no sim inputs |
| `forecast/learned-correction` | correction factors shrunk and clamped |
| `forecast/next15-across-slot-boundary` | `next15` window spans two slots |
| `forecast/remaining-today-mid-slot` | `remainingTodayKwh` prorates the running hourly slot |

## 7. `forecast-correction.ndjson`: learned forecast correction

One line per case: `{case,producer,input,output}`, database-free, produced by the 3.x code. A model is `month:hour` to
`{ratio,weight}`; observations carry `localTime` (plant-local `YYYY-MM-DDTHH:mm`), `expectedW` and `actualW`.

- `learn`: `input` `{model,skill,observations,nameplateW,exportCapW?}`, `output` `{model,touched,skill,improvementPct,factors}`:
  the model after the fold in month, hour order, the cells the batch changed, the skill, its `skillImprovementPct` and
  `correctionFactor` of every cell. Producer: `learn` (`apps/server/src/forecast/forecast-correction.ts`). Nameplate
  10 kWp unless stated: an hour expecting under 300 W is too dim, one expecting or measuring 8500 W or more is curtailed.
- `correctionFactor`: `input` `{model,month,hour}`, `output` `{factor}`.
- `skillImprovementPct`: `input` `{skill}`, `output` `{pct}`.

| case | boundary |
| --- | --- |
| `learn/empty` | no observations |
| `learn/one-day` | one July day, dawn too dim, noon curtailed |
| `learn/shrinkage-toward-one` | one observation at 1.4: the factor moves a sixth of the way |
| `learn/clamp-high` | ratio 5 folds as 2.5, the factor stops at 1.4 |
| `learn/clamp-low` | ratio 0.01 folds as 0.2, the factor stops at 0.6 |
| `learn/half-life-decay` | a year of 0.7 in June and July, then 1.1: the older months fade |
| `learn/skill-zero-error` | measured equals expected: no error, no improvement |
| `learn/zero-production-day` | nothing measured all day: every lit hour folds at 0.2 |
| `learn/dim-negative-and-curtailed-skipped` | the floor and ceiling at their edges, zero and negative expected, negative measured |
| `learn/export-cap` | a feed-in cap below the saturation ceiling lowers it |
| `learn/export-cap-above-saturation` | a cap above the ceiling changes nothing |
| `learn/no-nameplate` | no arrays: nothing is learned |
| `learn/prior-model-out-of-sample-skill` | a stored model and skill: the skill uses each cell's factor before its own fold |
| `learn/dst-autumn-repeated-hour` | local 02:00 twice on 2025-10-26: both fold into one cell |
| `learn/dst-spring-missing-hour` | local 02:00 absent on 2026-03-29 |
| `factor/unlearned-cell` | no cell for the slot |
| `factor/zero-weight` | a cell without weight applies 1 |
| `factor/shrunk` | weight 5 halves the ratio's distance from 1 |
| `factor/at-upper-bound` | shrunk to exactly 1.4 |
| `factor/above-upper-bound` | clamped to 1.4 |
| `factor/at-lower-bound` | shrunk to exactly 0.6 |
| `factor/below-lower-bound` | clamped to 0.6 |
| `factor/december-midnight` | month 12, hour 0 |
| `skill/no-samples` | no samples: 0 |
| `skill/zero-error` | no raw error: 0 |
| `skill/improved` | corrected error lower |
| `skill/worse` | corrected error higher: negative |
| `skill/perfect` | no corrected error: 100 |
