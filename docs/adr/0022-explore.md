# 22. Explore

Status: accepted (2026-11-16)

## Context

History (ADR 21) answers four plant questions, and a detail sheet's analytics read plant figures. A device's own series can be read only as they are now, in the sheet's Readings: an inverter's temperature, an MPPT input's voltage or a meter's phase cannot be charted over time, nor one day laid over another. Users want to inspect their devices' measurements, compare them with earlier days and analyse them in depth. The history read (ADR 9) returns one series of one device per call, at most 1,500 points, and refuses a counter's history past a day; statuses and held values have no rollups (ADR 3).

## Decision

**Screen.** Explore is a screen of its own. It is listed in More and on the rail (ADR 21), and every reading row of a detail sheet whose series has stored history opens it on that device and series at the sheet's range; a row without history is no link. Opened from More with nothing chosen, it shows the plant's PV power and house load for today, so it is never blank. Its header holds the shared range control and one mode switch: Series · Overlay · Fold. The chosen series stand below as removable chips, then "Add series". A viewer uses it as the admin does (ADR 9).

**Jobs.**

- **Series:** up to 6 series, of any devices, on one time axis. Series of one unit share a **lane**; there are at most 4 lanes, stacked, with one pointer across them.
- **Overlay:** one series over up to 5 periods: the range and those picked. Quick picks are the day before, the week before and the same day last year; any date can be picked. Days align on elapsed time from the plant-local midnight: a 23-hour day ends early, and a 25-hour day plots its repeated hour twice, in order. Weeks align Monday to Sunday. Months and years are not overlaid; the fold answers them. In Overlay the range control offers day and week alone; switching in from a longer range opens today if it lies in the range, else the range's last day. Earlier periods are receding tints of the series' colour; the diverging pair stays for under and over (ADR 21). Switching to Overlay with several series chosen keeps the first.
- **Fold:** one series' statistics per period (ADR 9): hour, day, week or month, defaulting to hours for a day, days for a week or month and months for a year. Hours are offered for a range of at most eight days: past that the table is hundreds of rows. Bars of the mean with min–max whiskers for a measurement, or of the delta for a counter, above a sortable table of mean, min, max, energy or delta, and hours with a value. Statuses and held values have no fold.

**Drawing by kind** (ADR 4).

- *Measurement:* up to a day, its raw intervals or minute means as a line; past a day, its hourly or daily statistics (ADR 9), the mean as a line inside its min–max band. History carries no min or max, so no API changes.
- *Counter:* its readings as a step line up to a day; past a day, delta bars from statistics, hourly up to the hour tier's cap and daily beyond.
- *Status:* a band of states. *Held:* a step line.
- *Before retention:* a day whose change points have expired is read from statistics by the hour, its means drawn with their min–max band, and the chart says once that only hourly figures are kept. A status or held value has nothing that old, and the chart says so.
- A gap breaks the line, and the time before a series' first reading stays empty, as in History.

**Picker.** Devices first, by name, the plant first, then physical, computed (ADR 15) and the weather device, and the tariff's `cost.*` series (ADR 12). A removed device with history left is listed and marked removed. Under each device its series are grouped by role namespace with the labels of the sheet's Readings; an indexed series names its index. Extras (ADR 4) are listed by their declared name in a collapsed Extras group, as they are hidden elsewhere. One search filters every device by label and by series id. Only series with stored history are listed; an estimated one carries "≈". Forecasts are not history (ADR 3) and are not listed. The picker is a drawer under the bar and a left pane from 1024 px, the chart beside it.

**Catalog.** `GET /api/v1/series`, a read route, lists every device with stored history, present or removed: its id, name and whether it was removed, and each stored series with its kind, unit and first and last stored instant. A removed device's name comes from its tombstone, and a series' unit from storage (ADR 3), so both hold after the profile is gone. A built-in series stores the unit the core gives it: `cost.*` EUR/h (ADR 12), prices EUR/kWh, irradiance W/m², temperature °C and wind m/s. A computed device has no name; the SPA names it. The picker, the before-retention note and the first-reading edge read it.

**Reads.** One history or statistics call per series and per overlay period, in parallel; the caps keep a view to about six. There is no batch route. A status or held series' history returns raw intervals at any range while they number at most 1,500 (ADR 9).

**State.** The whole view is in the hash route: devices, series, range, mode, overlay periods and the fold's period where it is not the range's default, so a view can be bookmarked, sent to a viewer and stepped back through. Nothing is saved on the server or in the browser.

**Reading the chart.** ADR 21's chart reading: the legend shows the values under the pointer, there are no tooltips, a mouse drag narrows the range, touch has no brushing. There is no pinch zoom. Lanes draw on a canvas: six series of 1,500 points are far past the band count at which SVG charts froze the page. Motion follows the tiers.

**Export.** A CSV of the plotted points, built in the browser: one row per point with its RFC 3339 UTC start and end, a plant-local date column for folds of a day or longer, and one column per series or overlay period headed by its series id and unit. Dot decimals, comma separated. The file name carries the range and the tier, such as `sunreye-2026-11-15-bucket60.csv`.

## Considered options

- **A tab in History.** Rejected: History asks one question at a time (ADR 21); a free series chart is no question.
- **A tab in each detail sheet.** Rejected: sheets exist per flow node, not per device, and a sheet is too narrow for lanes or overlays.
- **A removed device named from the change log.** Rejected: the registry owns names (ADR 19); a tombstone keeps it there.
- **Dual value axes.** Rejected: they hold two units at most and invite reading one series against the other's scale; lanes hold four.
- **Overlaying several series over several periods.** Rejected: 6 series over 5 periods cannot be read.
- **A batch history route.** Rejected until a second consumer needs one: the caps bound the fan-out.
- **Statuses fetched a day per call.** Rejected for a raw read at any range: a status changes rarely, so 1,500 intervals cover weeks.
- **Saved views on the server.** Rejected: the hash route already carries a view, and nothing asks for a list of them.
- **Scatter plots, formulas, derived series and anomaly detection.** Out until a real use asks.

## Consequences

The catalog is a published route; its fields only grow. A device's name reaches viewers through it, as its figures already do.
