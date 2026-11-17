# 21. Look, feel and navigation

Status: accepted (2026-11-10), amended (2026-11-12, 2026-11-13, 2026-11-15, 2026-11-16, 2026-11-17)

## Context

The first integration build rendered browser defaults: plain links for navigation, bare form fields, overlapping 3D labels. The owner wants the SPA to feel premium: glass, the motion and tactility of the kbase components, easy to operate, with in-depth analytics. Master's (v4) dashboard layout is liked; its flat controls list is not. ADR 11 fixes the stack and the copied components; this ADR fixes how the result looks, moves and navigates.

## Decision

**Shell by input and width, not by device name.**

- Mouse or trackpad, any width: a slim floating glass **icon rail** (about 56 px) at the left edge, always visible. Hovering near it, or moving keyboard focus into it, expands it to labels over the content without pushing the content aside. It collapses about 300 ms after the cursor leaves. A pin keeps it open, kept per browser.
- Touch and at least 768 px wide: the same rail, starting as icons. A tap on the logo opens it with labels, floating over the content like the mouse rail; a pin keeps it open, still floating. A tap outside closes an unpinned rail.
- Touch and narrower: a sticky floating glass **bottom bar** inside the safe area, never hiding on scroll, with at most three screens and More: Dashboard · History · Forecast · More. More opens a drawer: Controls (admin only, first), Explore (ADR 22), Tariff, Settings, Devices, Builder, Status. The rail lists every screen.
- Controls has its own rail entry, visible to admins only.

**Dashboard.** Master's layout:
- **Landscape tablet and desktop:** the page fills the screen and never scrolls. The hero (the 3D scene, or the 2D flow, ADR 11) takes the left ~53 %. The right column stacks:
  - a "now" strip: the current price and the forecast PV still to come today;
  - weather;
  - the today-energy cards (production, consumption, feed-in, purchase, with € and the autarky and self-consumption meters);
  - a small day chart, actual against forecast;
  - EV.
- **Phone:** the same blocks scroll in that order, hero first. The hero's height follows the screen's width, capped by the small viewport (`svh`), never the dynamic one: a browser bar that shows or hides while scrolling moves nothing below it.
- **3D/2D toggle:** sits in the hero's corner, the 3D scene's camera lock (ADR 20) beside it.
- **Headline:** the hero's large figure is PV power while PV produces and switches to house consumption while PV is idle.

**Details by drilling down.** The dashboard answers "now and today". Every figure on it opens its detail:
- **Detail sheets:** a glass side sheet on desktop and tablet, a drawer on the phone. Each has its own hash route, so back closes it, and ends with "Open in history →" at the same range.
- **PV forecast sheet** (2026-11-17): the now strip's PV cell opens a glance at the next three days; depth stays on the Forecast screen, which the sheet links to. Tabs Heute and the next two weekdays slide by order as the weather sheet's do (ADR 23). Each tab heads with its energy: today the kWh still to come and the day's total, a later day its expected total, its peak power and time, and its change against today. Below its chart, actual against forecast for today and the forecast alone later, which reads under the pointer as the weather sheet's charts do: each string's or, without strings, each MPPT input's expected kWh as small bars; the sky's icons by three hours and the sunshine hours from the weather read (ADR 23); the best window, the three consecutive hours that make the most; and today alone, how far measured runs from the forecast so far and the forecast's accuracy over the last 30 whole days.
- **Scrim:** an open sheet dims the page without blurring it.
- **Drawers:** a drawer is shadcn-svelte's `Drawer` (vaul-svelte) from the bottom. It is open or closed, with no snap points: a pull down closes it.
- **Forms and pickers** (adding a point, a profile, a builder object; editing a point; confirms): a `Dialog` where the shell shows its rail (a mouse, or touch from 768 px), a drawer under the bar. They choose on the shell's rule, so every caller agrees. A confirm is asked before anything no undo brings back, never inline in the page: its title names the thing, one line says the consequence, then Cancel and the action. A refusal stays in the open confirm beside the action; success closes it with a toast.
- **Readings:** a device's sheet (string, inverter, PV, battery, grid, house, EV) lists its current readings right after the live graph, before the range analytics, grouped (Jetzt, MPPT inputs or phases as small tables, Zustand, Zähler). Only roles the device has appear. A reading older than its device's usual interval shows its age and dims; an offline device or a stalled stream is said once above the list. An estimated value carries "≈", and a string sharing an MPPT input says so in one sentence and links its siblings. A reading row whose series has stored history opens Explore (ADR 22) on its device and series at the sheet's range.
- **Range control:** detail pages share one: day, week, month, year, custom, with swipe or arrows to step.
- **Live graph:** a power figure's detail sheet opens with v3's live graph (`live-area`, `live-window`, `live-cursor`), restyled here. It shows a fixed two-minute window anchored to the newest sample, so its data, scales and tooltip index change only when a sample lands. Between samples one transform scrolls the marks, on a cursor that eases linearly across the feed's own sample spacing (clamped to 250 ms–5 s) with a slight overshoot, snapped to quarter pixels. The plot keeps a few samples of buffer past its left edge and is downsampled to its pixel budget. Grid power fills diverging around zero.
- **Chart reading:** the legend shows the values under the pointer; there are no floating tooltips. With a mouse or keyboard, dragging across a chart narrows the range. On touch, a tap drills into a bar and there is no brushing.
- **Deep analytics** (heatmaps, the hourly-block grid, per-string comparison) live in tabs on detail pages, never on the dashboard.
- **Sheet content** (2026-11-17, replacing the thin sheets): every sheet answers one job and ranks for it (`ux-layout-design`): its head figure is the one primary, its chart and composition bars secondary, its facts tertiary in one row; nothing repeats the head. Measured sheets keep the range control and their analysis tabs; only the weather and PV forecast sheets, which look ahead, have day tabs. Every chart reads under the pointer through one shared readout: a rule at the pointer, the values in the legend or row header; a finger reads after a short hold inside a sheet, so the drawer does not follow it; on a full screen (History, Forecast, Tariff) a finger reads at once, a tap drills. Each figure states its comparison with the previous range of the same length ("−12 % vs gestern"). A measured sheet's head figure is the sheet's range's, named by the range, and is set against the range before cut to as much as the range has run, as History's baseline is; without readings there, or from next to nothing, it states no change. Every sheet designs its empty, loading, partial and error states: a range before the first reading, which the series catalog dates (ADR 22), reads nothing and says so once in place of the tabs, and a range the record begins in says where; a partial range marks where readings stop, when none were stored after, so a sleeping inverter's night is no stop; a failed read, a refusal as much as a lost core, says so in place of the tabs with a retry, and the range stays. Per sheet:
  - *Autarky and self-consumption* (when did the house run on its own power): the range's autarky heads it, its change in percentage points; both by hour, past a day by day (a year by month, as its bands), an hour without load or PV reading none, never 0 %; one bar for what covered the house (PV direct, battery, grid) and one for where PV went (house, battery, grid), where the battery takes no more PV than was not fed in, as no PV-to-battery flow is published (ADR 14); the best and worst hour or day, of those done; the average of the 30 whole days before today, which does not move with the range.
  - *Savings* (what has the plant earned): € saved per day; its parts (avoided purchase, feed-in earnings, less the purchase it could not avoid); the total since installation with the payback progress (ADR 12); a link to Tariff. The parts are the Tariff chart's days without the standing charge, which no plant avoids. The total and payback name the investment, so they are the admin's alone (ADR 12). Without a tariff in force nothing is saved: the sheet says so in place of its chart, with the way to set one for the admin.
  - *Consumption, house, feed-in, purchase, generator:* below the tabs, one row of facts: the range's peak, from its rollups' `max` (ADR 3), with its hour or, past a day, its day; for consumption and house the share PV covered directly, the autarky sheet's PV bar, so the battery's part is not counted as PV's; for feed-in and purchase their €, the tariff's `cost.*` rates summed over the range (ADR 12), or, without a tariff in force, that none is entered. Above the facts the purchase charts `price.import` in ct/kWh by band, by hour within a day and past a day by day, while a tariff is in force; its legend is titled by the price's mean over the range, as any chart of a mean is, never a sum.
  - *Battery:* SOC as a line under the power; charged and discharged energy with round-trip efficiency; cycles in the range; a Heat tab.
  - *PV, inverter, string:* the range's energy and its peak with time; actual against forecast, the string sheets included; the inverter's temperature where its profile maps one.
  - *EV and each loadpoint:* the range and its charging power; the energy charged and its PV share; sessions as blocks of charging derived from power, start, end and kWh.
  - *Weather:* one row of facts, the sky word with the day's.

**History.** One question at a time, over the shared range control.
- **Card:** four figures answer the range: production, savings, autarky and the plant's state, each with its change against the baseline. The chosen one opens its view below: a one-sentence verdict, its tabs, then the open tab. While the correction has too few days to judge a string, the plant's figure says "learning", not a dash.
- **Beside the chart** (below it on a phone), in this order: the breakdown, the range's peaks, what stands out, payback.
  - *Breakdown:* the chosen question's flows. A main row states its change against the baseline under its value, and the card names the baseline once. A baseline of next to nothing carries no change. Over several recorded days, production and the house load state their mean per day.
  - *Peaks:* the highest power of PV, house load, grid import and feed-in, from the rollups' `max` (ADR 3), each with its hour or, over several days, the day, which a tap opens. They are the range's, not the remembered plant peak of the 2D flow.
- **Before the record:** the time before the plant's first reading is not a gap. Its bands stay empty and unhatched, and coverage, gap hours and the gap list count from the first reading.
- **Two-sided charts:** the legend names the upper and the lower side at every width. A signed role's sides are named for its sign (ADR 4): charged and discharged, imported and exported, else above and below zero. The upper side is named even on a range that ran one way only. Each side takes its flow's colour, so a battery's sides share one.
- **Series names:** a series is named by its role's label in the viewer's language, an indexed one with its index ("Eingang 2 · Spannung"), from one table the sheet's Readings and Explore share. No screen shows a series id as text; only an extra without a declared name keeps its id. Explore's search and CSV headers still use ids (ADR 22).
- **Band chart legend and axes:** the title of what is read stands a size above the keys; an hour band is titled by its clock times ("10:00–11:00 Uhr"). On a phone the legend is one list, a key per line with its value at the right edge; from 520 px the keys run in a row per side. The value axis ticks the baseline and each half of the taller side, and the other side mirrors that step, unsigned, as far as it reaches. The running band's dot has a lane of its own above the axis labels.
- **Forecast tab:** the sum sets all that was measured against the forecast of the whole range; the accuracy figures judge whole past days alone.

**2D power flow.** Ported from v3 (`dev` at `780b4e2`: `power-flow-diagram`, `power-graph`, `flow-pulse`, `plant-ceiling`) and restyled here.
- **Layout:** chosen from the hero's aspect ratio. In portrait, sources stack above the hub and sinks below it. In landscape, sources fan in from the left and the grid from the right. Anchors are fractions of a safe box inset by one caption stack, so captions never clip.
- **Hub and nodes:** the hub is the inverter, showing DC input, its own draw and its efficiency. The nodes are PV, battery (with an SOC gauge), house, generator, grid and EV (with the vehicle's SOC).
- **Data:** values come from the `plant` device (ADR 14) and the `ev` roles (ADR 10). A node shows only when its role exists.
- **Rails:** one cable per segment, carrying one comet charge: a chain of beads, each on its own `animateMotion` along the cable, so the comet bends with the curve. The comet's speed, size and bloom show the rail's share of the remembered plant peak.
  - The remembered peak rises at once, halves over six hours, never drops below 1 kW, and is kept per browser.
  - Crossing times are quantised to quarter seconds, so an unchanged reading never restarts an animation.
  - A rail that reverses fades out and back in. The bloom's blur is static and never animates.
- **Strings:** each string is a node while they fit; when they don't, they collapse into one PV node whose sheet lists them.
- **Estimates:** an estimated value carries "≈", as on the 3D labels and in sheets.
- **Tapping:** a node opens its detail sheet.

**Drill-in navigation for Controls and Settings.**
- **Pattern:** one component. A root list of groups, each row summarising its current values. Tapping a row slides its page in from the right while the parent shifts left and dims. Each level is a hash route, so browser back and the edge-swipe go back. At most two levels deep.
- **Phone layout:** below 1024 px each level is a screen of its own, as wide as the screen, and slides whole. No card holds both levels, so no surface changes size as they trade places. Inside a level the rows sit in inset glass cards, one per section, its label above the card. A page's header (back and title) is a glass bar that stays at the top of the screen. Each level keeps its own scroll position: a page opens at its top, and back returns the root to where it was.
- **Wide screens:** from 1024 px, Controls and Settings show two panes instead: the groups on the left, the chosen group's settings on the right, each pane one card. Each group is still a hash route. Below 1024 px the drill-in slides.
- **Control groups:** come from the role namespace (`battery.*` → Battery, `grid.*` → Grid & export), labelled by Paraglide. Settings without a role go into Advanced. Profiles carry no groups.
- **Writes:** there is no page lock; ADR 7's writes switch is the lock. With writes off, every control is read-only, under a banner explaining why.

**Onboarding.** First-run setup and sign-in (ADR 9, 11) use the same components as Settings, not a look of their own.
- **Steps on the drill-in:** the root lists the steps in order (password, plant, devices, measurement points, PV layout), each row saying whether it is done, next or still to come, under a progress count and bar. One level per step. Only the next step opens: a finished one is changed later in Settings, so setup never runs a write twice. Finishing a step opens the next one; back returns to the list. Under Home Assistant ingress the password step is left out.
- **Values:** bounded numbers (a port, a Modbus unit) use the value editor; free-form values (password, names, hosts, coordinates) keep a text field.
- **PV layout:** the step is the 3D builder (ADR 20), canvas and inspector filling the screen under the setup's progress and back. Skipping it is always offered, and without WebGL2 skipping is the only way on; the layout can be drawn later on the builder route.
- **Sign-in:** one glass card on the backdrop, with the brand mark and the language switch. The admin signs in with the password alone; a viewer chooses "Viewer" and adds their name (ADR 9).
- **Motion and refusals:** the drill-in's slides follow the tiers and land at once on still. A refusal or failed sign-in uses the `error` treatment: the `error` haptic and a destructive alert beside the action, which stays for a fix.

**Value editor.** No sliders in Controls or Settings.
- **Opening:** tapping a setting row opens the value editor: a drawer on touch at any width, an anchored glass popover with a mouse, beside the row in the drill-in and under the row's value in two panes.
- **Header:** the setting's name, its limits, and a large value whose digits roll up or down with the motion.
- **Bounded stepped numbers** use a wheel. Bounds and step come from the profile for inverter settings and from the setting itself in the app.
  - A momentum drum: a fling coasts, then a spring snaps it to the nearest step. Off-centre rows shrink and fade.
  - Fling speed scales with the range.
  - The current value keeps a faint marker.
  - A `selection` tick plays per step crossing the centre, at most about 30 per second.
  - Tapping the large number lets you type the value directly.
  - Arrows move one step, Page Up and Page Down ten, and the mouse wheel one notch per step.
  - Screen readers see a `spinbutton` with its value and unit.
- **Times** use two wheels, hours and minutes, with minutes at the step the profile allows.
- **Enums** use a list with kbase's sliding `active-indicator`.
- **Free-form values** (prices, coordinates, names) keep a text field.
- **Applying:** "Apply 100 A → 80 A" runs ADR 7's write. The editor shows pending until the read-back, then closes with the outcome: confirmed, refused with its reason, or mismatch, linked to the write log. There is no separate confirmation step.
- **Builder time slider:** stays, because it scrubs time rather than setting a value. Its day, like the day a layout applies from, is a button that opens a calendar in a popover; picking a day closes it.
- **Builder controls** are the registry's components (`components/ui`): no browser-default date, time, range, colour or select control. A colour beyond the swatches is typed as `#rrggbb`, a free-form value.

**Glass.**
- **Two levels:**
  - *Overlay glass* (menus, dialogs, sheets) keeps kbase's tokens.
  - *Ambient glass* (rail, bottom bar, dashboard cards, 3D label chips, toasts) is lighter, about 64 % opaque in light and 58 % in dark, with the strong blur: thin enough to show the backdrop's lights, with its text still at WCAG AA over the brightest of them.
- **Backdrop:** both sit over four large, soft lights:
  - *Sun:* kbase's `bg-spotlight` at the top, its tint following the sun at the plant: warm at dawn and dusk, clear by day, indigo at night. The core computes the tint (±6° around the horizon is twilight), so viewers get it without the location (ADR 9). It is recomputed every 15 minutes; without a location it stays indigo.
  - *PV:* solar amber, top right. Its strength follows the plant's live PV power in steps, eased over seconds, and it is out while PV is idle.
  - *Battery and grid:* battery green bottom left, export teal bottom right, so the bottom bar and the rail sit over a light.
  - *Motion:* on the full tier the lights drift and breathe slowly, a step a second, by `transform` and `opacity` alone; a step is a pixel or two of a very soft edge. On lite and still they rest. Each move makes every glass surface over a light blur again, so no animation runs between the steps: one running there, even stepped, cost the 2D dashboard its smoothness budget.
  - No grid pattern anywhere.
- **Opaque fallback:** `prefers-reduced-transparency` and the low-power switch turn every glass surface opaque.

**Colour.**
- **Theme:** dark by default and designed dark-first. Light is fully supported, with a manual override.
- **Energy colours:** each flow has one fixed colour everywhere: charts, tiles, the 2D flow and the 3D scene. Solar amber, battery green, grid import rose-red, export teal, consumption neutral, EV violet. The palette is validated for colour-blind contrast.
- **Contrast:** every energy colour reaches 3:1 as a mark against its surface in both themes; light-mode solar amber is darkened to get there.
- **Diverging pair:** one pair outside the energy colours, orange for under and blue-grey for over, marks corrections and comparisons against a model or a previous period.
- **Brand:** SunReye's v3 mark, a flat sun of eight rays around a disc, in blue-600 (`#2563eb`; a lighter blue in dark mode). The brand colour marks controls only, never data, which is why no energy flow is blue.

**Surfaces.** Boxy: a 2 px corner radius (`--radius: 0.125rem`) on every surface and control. kbase's rules apply:
- a card must do something;
- summary figures sit in a strip divided by hairlines;
- a list is one surface with dividers;
- no visible scrollbars, with edges that fade where more content waits. The fade is shadcn-svelte's `scroll-fade` utility (a mask on the scroller, driven by its scroll position, static where scroll timelines are missing), on every scroll container: sheets, pickers, menus, lists, tables, chip rows. The background and border sit on a wrapper and the fade on the scroller inside it, so glass keeps its edge. A `ScrollArea` keeps its scrollbar for the mouse; a text area and the page itself take no fade. The still tier and the low-power switch drop the fade, whose mask repaints with every scrolled frame;
- a screen fetches its data when it mounts; there are no SvelteKit `load` functions. While its data fills in, the screen stands in its final layout: a number shows dashes, as the animated number does, and a chart or a sentence shows a skeleton or its own empty or loading state of the size it will take. A page never shows a blank or unstyled box.

**Motion.**
- **Source:** kbase's motion vocabulary, from `theme.css`, the motion parts of `app.css`, `animated-number`, and `active-indicator` (kbase `8e6db9e`), plus these curves:
  - *Movement between two resting places* (drill-in, rail, sheet travel, route change, camera flight, chart range change): `--motion-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, 280–350 ms.
  - *Entrances:* kbase's ease-out, 180–250 ms; a large surface (the 3D scene fading in, a sheet) about 350 ms.
  - *Exits:* ease-in, about 150 ms, shorter than their entrance.
  - *Presses:* kbase's 80 ms scale press, released with its spring.
- **Interruptible:** anything a user can interrupt runs on Svelte `Spring`/`Tween` or CSS transitions, never keyframes. A reversed motion continues from where it is. Back-swipes follow the finger 1:1, then a spring takes over at the release velocity and settles at a snap point. Drawers follow the finger 1:1 and, let go, settle back open or close.
- **Route changes** slide by the navigation's order (Dashboard · History · Forecast, then More's list): a later screen comes in from the right while the old one leaves to the left, an earlier one the other way, so back slides the way back. Both stay in one grid cell, the leaving screen keeps its scroll position, and a second change mid-slide goes on from where the screens are. A route outside that order fades in place.
- **Jank rules:** animate only `transform` and `opacity`. The one exception is the lite tier's dashed flow cable, which moves its SVG `stroke-dashoffset`. Never animate `backdrop-filter` or layout properties. Numbers use tabular figures. Charts tween between data sets. Sizes are reserved before data arrives.
- **Live ticks:** numbers, gauges and flow-line thickness ease to each tick for slightly longer than the tick interval, so values glide. 3D tints ease over about 400 ms (ADR 20), then rendering stops. When the stream stalls they stop, flow lines go still, and the connection chip shows the stall. The stream counts as stalled after about 30 s without any message, keep-alives included, as the core sends one every 15 s. A page holds one live connection, shared by everything on it through the one live store, the only caller of the client's stream (#831), and closes it while the tab is hidden, reconnecting when it shows again: a browser keeps six connections to a host over HTTP/1.1, and streams held by several tabs, or several per page, left later requests waiting for minutes (#829).
- **Tiers:** v3's full, lite and still. A device starts on full. About 4 s after the page settles, a frame watch measures strain and drops a struggling device to lite. On lite, each flow rail is one travelling dashed cable instead of a comet chain, and the 3D ambient-occlusion pass is off. The measured strain is kept per device, so a slow wall tablet starts lean the next day. There is no motion setting; the 3D quality is a drawing setting (ADR 20).
- **Off switches:** reduced motion and the low-power switch force still: all of it is instant and nothing moves.

**Transient feedback.** What an action did and needs no answer ("Gespeichert", "Entfernt", a confirmed write) is a toast, not a line added under the form: shadcn-svelte's Sonner, one toaster in the shell, in the bottom bar's ambient glass, ring and elevation at the radius token, bottom right beside the rail and above the bottom bar on the phone. A toast's status shows in its icon, never in a coloured fill. It comes in success and error, with the haptics of the table below, and without animation on the still tier. An error the user fixes in a field, a refusal included, stays inline beside that field.

**Smoothness is measured.** A deliberate e2e journey (outside the gate, ADR 11) runs each signature transition, and a tap during the 3D scene's background load, under 4× CPU throttling and records Long Animation Frames: drill-in, sheet, rail, route change, camera flight, live tick, value-editor fling. It fails if any frame exceeds 50 ms or the 95th percentile exceeds 20 ms. `bun run smoothness` runs every journey against a fake core (`apps/web/e2e/`), at 1× and 4× throttle so software rendering, which the throttle does not scale, shows apart from main-thread work; `bun run smoothness <words>` runs those whose names contain them.

**Haptics.**
- **Library:** `web-haptics` (MIT), pinned to an exact version and wrapped in one `haptics` module that exposes only these events:

  | Event | Preset |
  |---|---|
  | Toggle, segment or tab change | `selection` |
  | A drawer let go (settling open or closing), drill-in commit, rail pin | `soft` |
  | Press on a primary action | `light` |
  | Write confirmed by read-back | `success` |
  | Refusal, mismatch, failed sign-in | `error` |
  | A value editor opens | `nudge` |
  | A value-editor wheel crosses a step | `selection` |

  Nothing else vibrates.
- **Setting:** a per-browser switch under Settings › Display. It defaults to on for touch devices and is forced off by the low-power switch and reduced motion.

## Considered options

- **An always-expanded rail on touch tablets.** Rejected: it costs the hero about 180 px for labels a tap on the logo shows.
- **Five bar items, Tariff among them.** Rejected: at 320 px a fifth of the bar cannot hold "Tarif und Ersparnis", and labels collided; four items give each label room in every locale.
- **Floating chart tooltips.** Rejected: on touch they hide what the finger points at; the legend is the readout.
- **A fully hidden desktop sidebar.** Rejected: it can't be found, and it can't be reached by keyboard or by touch.
- **KPI cards floating over a full-screen 3D scene.** Rejected for master's two-column layout, which the owner prefers.
- **Settings groups declared in profiles.** Rejected: a profile schema change for what role namespaces already give.
- **A lock switch on the controls page.** Rejected: it duplicates ADR 7's writes switch.
- **Sliders and a separate confirmation sheet for writes.** Rejected: a slider is imprecise on touch and has no feel. The value editor shows old → new and applies in one step.
- **A new 2D flow or new live charts.** Rejected: v3's encode magnitude against a remembered plant peak, glide at sample cadence, and survive slow devices. They took long tuning and are kept.
- **v3's per-device motion setting (auto, full, lite, still).** Rejected: the frame watch decides, and the low-power switch is the manual override. The 3D quality (ADR 20) is a setting because capable devices draw far more than the full tier needs, which the frame watch cannot discover by stepping down.
- **Moving particles in the 3D scene.** Rejected for flow; weather's are allowed since 2026-11-17 (ADR 23), in a loop bounded to the full tier and wet weather. Flow particles stay in the 2D flow.
- **No switch for weather effects.** Rejected (ADR 23): *Wettereffekte* chooses content, not motion; the frame watch still governs cost.
- **Snap points on drawers** (a peeking half-open drawer). Rejected by the owner: a drawer is open or closed.
- **Our own draggable bottom sheet.** Rejected for shadcn-svelte's responsive `Drawer`/`Dialog` pattern, which the registry maintains.
- **Vendoring `web-haptics`.** Rejected for now: nothing to change. The wrapper keeps a later swap to one file.

## Consequences

- **iOS haptics:** iOS gets haptics only through `web-haptics`' switch trick and only inside a user gesture, so `success` after a slow read-back may not fire there, and the wheel's per-step ticks during a scroll may not either. Without them the rolling digits and the snap still carry the feel. It must be checked on a real iPhone.
- **Version risk:** `web-haptics` is pre-1.0 and has one author. An upgrade is a deliberate diff.
- **Design file:** the SPA's short design file is a checklist linking here.
