## `forecast-string-correction.ndjson`: forecast correction learned from an MPPT string

One line per case: `{case,producer,input,output}`, database-free. 3.x has no MPPT logic: the producer is the reference
rule in `scripts/oracle/forecast-string-correction.ts`, which folds through 3.x `learn` unchanged and decides only which
hours a string learns from. `input` `{model,observations,arrayNameplateW,inverterNameplateW,exportCapW?}`; an observation is
`{localTime,expectedW,actualW,inverterExpectedW,inverterActualW?}`: the array's modelled hour, its string's measured
`pv.string.power`, and the inverter's modelled and measured total. `output` `{model,touched,factors}` as in
`forecast-correction.ndjson`.

- The floor (3 %) and saturation ceiling (85 %) are 3.x's against the array's nameplate, 4 kWp unless stated: under
  120 W is too dim, 3400 W or more curtailed.
- An hour the inverter is likely curtailed in is skipped: its modelled or measured total at or above 85 % of the
  inverter's nameplate (10 kWp: 8500 W) or the feed-in cap if lower. A missing measured total is judged by the modelled
  one alone.
- No voltage rule. The corpus holds no measured string voltage (profile-decode cases are synthetic register patterns,
  the archives carry no `pv.string.*` rows) and the profiles give no MPPT voltage window, so no threshold is defensible.

| case                                 | boundary                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `string/empty`                       | no observations                                                                       |
| `string/shaded-string`               | one July day, the string at 0.7 of its model while the inverter total is unremarkable |
| `string/array-floor-and-ceiling`     | 119.9 W and 120 W expected; 3400 W expected or measured; 3399.9 W                     |
| `string/night-zero`                  | zero modelled and measured at night, total measured and absent                        |
| `string/negative-string-power`       | a negative string reading is skipped, zero folds at 0.2                               |
| `string/inverter-curtailed`          | measured or modelled total at 8500 W skips the string hour, 8499.9 W does not         |
| `string/inverter-total-missing`      | no measured total: the modelled total decides                                         |
| `string/export-cap`                  | a feed-in cap below the inverter's ceiling lowers it, on modelled and measured totals |
| `string/export-cap-above-saturation` | a cap above the ceiling changes nothing                                               |
| `string/no-array-nameplate`          | an array of 0 kWp learns nothing                                                      |
| `string/prior-model`                 | a stored cell decays and folds                                                        |
| `string/dst-autumn-repeated-hour`    | local 02:00 twice on 2025-10-26: both fold into one cell                              |
| `string/dst-spring-missing-hour`     | local 02:00 absent on 2026-03-29                                                      |
