# Changelog

<!--
  This preamble is hand-written and version-independent. release-please owns the
  "## [version]" sections below it, and scripts/addon-changelog.mjs rewrites the
  body of one of those sections in place — neither touches anything above the
  first "## [", so this survives a release. Fold it into the generated 2.0.0
  section (or delete it) once 2.0.0 is out and the note has done its job.
-->

## Read this before updating to 2.0.0

**2.0.0 rebuilds how readings are stored, and renames your Home Assistant entities once.** Those are
the two breaking changes that touch your instance. A third one only concerns you if you **author or
share inverter profiles** — see "If you author or share inverter profiles" below.

- **Your Home Assistant entity ids change — once, and then never again.** Read the section below
  before you update: **dashboards, automations, scripts and template sensors that name a
  `sensor.sunreye_*` entity have to be re-pointed one time.** Home Assistant records history against
  the entity id, so a new entity starts a fresh history; your old recorded data stays under the old
  entity until you delete it. If keeping one continuous history matters to you, rename the new entity
  to the old entity id in Home Assistant — it offers to move the long-term statistics across.
- **The upgrade is in place and automatic.** There is nothing to export, reinstall or restore. Update
  the addon and it happens.
- **Take a backup first anyway.** This release moves data. The addon writes one for you; keep it
  until you have seen a few days of charts.

### Your entities are renamed once, to something that will never move again

Until 2.0.0 every entity was named after the **inverter profile**: the topics, the `unique_id` Home
Assistant keys entities on, and the Home Assistant device were all built from the profile's id. That
was a bug, and a bad one. Correcting a typo in a profile id, or switching a mis-detected profile for
the right one, **renamed every entity you had** — and because a discovery announcement is retained on
the broker, the old entities did not disappear, they were left behind as permanent duplicates that
never update again. Nothing warned you; the charts and cards just went quiet.

Identity now comes from your **plant name** and **device name** instead, which are frozen when you
first set them and cannot move afterwards. Concretely:

| | Before (1.x) | After (2.0.0) |
| --- | --- | --- |
| MQTT topic | `sunreye/deye-sg05lp3/pv/power` | `sunreye/<plant>/<device>/pv/power` |
| `unique_id` | `sunreye_deye-sg05lp3_pv_power` | `sunreye_<plant>_<device>_pv_power` |
| Entity id | `sensor.sunreye_pv_power` | `sensor.sunreye_<device>_pv_power` |
| HA device | `sunreye_deye-sg05lp3` | `sunreye_<plant>_<device>` |

`<plant>` and `<device>` are the machine names taken from the plant name and inverter name you are
asked for on first open (see below) — so with a plant called "Haus Süd" and the default inverter
name, PV power becomes `sensor.sunreye_inverter_pv_power` and its `unique_id` becomes
`sunreye_haus-sud_inverter_pv_power`.

**What you need to do, once:** after the update, open Home Assistant, check your dashboards and
search your automations, scripts and template sensors for `sunreye_` — anything still on an old name
needs the new one. Searching for `sensor.sunreye_` in Settings → Automations & Scenes, and in your
`configuration.yaml`, finds all of them. Renaming an entity in Home Assistant is also fine if you
prefer your old ids: the new entity is the one receiving data, so rename it to whatever your
automations already say.

**The old entities are cleaned up for you.** SunReye clears the retained announcements it made under
the old scheme, once, right after it has announced the new ones — so you are never left with no
entities, and you do not end up with two of everything. It only ever touches announcements it made
itself; nothing belonging to another integration is affected.

**Nothing is announced under a placeholder.** Home Assistant discovery is held until you have given
your plant and inverter their names, precisely because a retained announcement under the wrong name
is not something a later rename can take back. That is why the form below is required rather than
optional.

### Your history comes back in two stages

The update itself is a catalogue-only step that takes under a second, and live data works from the
moment it finishes. Your **pre-update history is replayed separately**, out of the boot chain,
because on a Home Assistant box that part takes minutes rather than seconds.

Until that backfill has run, charts and statistics cover only the time since the update. SunReye
tells you so rather than drawing a partial answer: a range that reaches back past the update is
refused with an explanation instead of quietly reporting a smaller number. **You can defer the
backfill** and run it when it suits you; it is resumable, so interrupting it — including a power cut
— loses nothing and duplicates nothing.

### You are asked for two names, once

1.2.0 had a single inverter setting and no notion of a site or a device. 2.0.0 needs both, and it can
create the records but not invent the names, so on first open after the update it asks for a **plant
name** and an **inverter name** (pre-filled from your profile) on one short form. Home Assistant MQTT
discovery is held until both are set, so nothing is announced under a placeholder.

These two names are what your entity ids are built from, and they are frozen once set — that is the
whole point of asking. Their labels stay editable afterwards; only the machine names underneath are
fixed, so you can rename your plant on screen without renaming a single entity.

### If you author or share inverter profiles

**Skip this if you only install profiles.** Nothing you have installed stops working: 2.0.0 reads
every profile published so far, exactly as before.

Profiles carry a `schemaVersion`, and 2.0.0 writes a new one. Profiles built by 2.0.0 — or by
`@sunreye/profile-sdk` 3.0.0 — declare `schemaVersion: 3`, while **every SunReye 1.x accepts version
1 and nothing else** and refuses anything newer outright. Because profiles travel through a shared
git profile source, that break lands on people who have not updated yet: if you rebuild an existing
profile, or add a new one, to a source others use, every install still on 1.x fails to load it.

What to do, if you maintain a shared source:

- Keep the currently published v1 build where it is until the people using it have updated. It keeps
  working on 2.0.0 as well, so there is no rush to replace it.
- Only publish a rebuilt (v3) profile once the installs reading that source are on 2.0.0.
- If you author with `@sunreye/profile-sdk`, note it is now **3.0.0** — a major, precisely so this
  does not reach you as an automatic upgrade. See its changelog before moving your range up.

### Also new: take your whole instance out as one file

`export` writes every reading, your plant setup and your settings to one portable archive, and
`import` reads it back — into another machine, or into a future SunReye whose storage layout has
changed again. The archive names devices and metrics the way the API and your Home Assistant
entities already do, and refers to no internal id, which is why an upgrade like this one should not
be needed again.

## [2.0.0](https://github.com/SunReye/SunReye/compare/addon-v1.2.0...addon-v2.0.0) (2026-08-30)


### ⚠ BREAKING CHANGES

* **db:** a reading is identified by a device and a metric instead of a profile id and a metric name. The v2 schema replaces both 1.x rollup generations with one. The upgrade from 1.2.0 is in place and automatic — a sub-second catalogue step during start-up, after which live data works — followed by a separate, resumable backfill that replays your pre-update history and can be deferred. Until that backfill has run, charts cover only the time since the update, and a range reaching further back is refused with an explanation rather than answered partially. ([59de72d](https://github.com/SunReye/SunReye/commit/59de72d8d5912af801534f6ece143a2402744f10))
* **mqtt:** Home Assistant identity moves off the inverter profile id and onto your plant and device names, so every SunReye entity id, `unique_id`, MQTT topic and Home Assistant device is renamed once. Dashboards, automations, scripts and template sensors naming a `sensor.sunreye_*` entity have to be re-pointed one time; the retained announcements made under the old scheme are cleared for you, once, right after the new ones are announced. Read "Read this before updating to 2.0.0" at the top of the addon changelog before updating. ([0804685](https://github.com/SunReye/SunReye/commit/08046851e12fd51da18b295ffc0cb750cf209648))
* **server:** on first open after the update the instance asks once for a plant name and an inverter name, and holds Home Assistant MQTT discovery until both are set, so nothing is ever announced under a placeholder. ([5633f5d](https://github.com/SunReye/SunReye/commit/5633f5d958ee739581c4039d62ea461a05c45ecc))
* **server:** the `activeProfile` global is gone. Devices are read from the `devices` table as `DeviceInstance` values whose capabilities are derived from their roles, so the runtime, the MQTT bridge, the automation engine and the write path address a device rather than the one active profile. ([8add910](https://github.com/SunReye/SunReye/commit/8add910ae79e6265864aaa2e2fdcdf30ac014494))
* **auth:** configuration reads are admin-gated. `GET /api/profiles/updates` shipped ungated and is now `requireAdmin`, so a client polling a configuration endpoint without admin credentials is now refused. ([3a353a3](https://github.com/SunReye/SunReye/commit/3a353a35ffd458655cc88ed2c0e67f1a88377db4))
* **ws:** the five legacy per-topic WebSocket routes are gone. Everything runs over the multiplexed `/ws`, authorization is decided per subscribe frame rather than at the upgrade, and the envelope publishes on the plain topic name — the `mux:` prefix is gone. ([33ec667](https://github.com/SunReye/SunReye/commit/33ec6678d46c76b8ae34b83bc0fb27a4c5dfdca6))
* **server:** `GET /api/automations/history` is removed, along with the in-memory decision ring behind it and the `DecisionPoint` wire type. The optimizer is a device now, so its decisions are rows in `metrics_raw` read through `/api/history` and `/api/history/rollup` under the `optimizer` slug. The `automations` topic stays; its `history` and `point` fields do not. ([4ce8057](https://github.com/SunReye/SunReye/commit/4ce8057111828ec8d3877940b2eaa11f53340924))
* **web:** the `/system` page is retired — each power-flow node now opens onto its own readings. ([dd77bcb](https://github.com/SunReye/SunReye/commit/dd77bcbca06e063750b8b40c2597b45f259124af))
* **inverter-core:** a profile built with 2.0.0 is refused by every SunReye 1.x install. The profile `schemaVersion` moved 1 → 2 ([0c3a239](https://github.com/SunReye/SunReye/commit/0c3a23909ab73816fb5c2f90a6ffc1988c1f38bf)) → 3, and 1.x validates `schemaVersion: 1` and nothing else, so it rejects any profile emitted by these builders or by `@sunreye/profile-sdk` 3.0.0 outright. Profiles are distributed through a shared git profile source, so this lands on people who have *not* updated: rebuild or newly author a profile in a shared source and every install still on 1.x fails to load it. Already-published v1 profiles are unaffected — 2.0.0 still reads them and upcasts on load — so the action is the author's: leave the existing v1 build in place for 1.x users, and have anyone who needs the newer build update to 2.0.0 first. ([4ae4d04](https://github.com/SunReye/SunReye/commit/4ae4d044b060c8a8299141b197948062486e12d6))

### Features

* **db:** build one database image carrying timescaledb_toolkit ([acafef4](https://github.com/SunReye/SunReye/commit/acafef44e91b1771578b2acc965ba5901e26295b))
* **db:** portable export/import as a permanent, schema-independent feature ([166220b](https://github.com/SunReye/SunReye/commit/166220b80a529be0b992b876af5cb0e1cc4b98e7))
* **db:** re-derive retention against the measured footprint ([82eeaf0](https://github.com/SunReye/SunReye/commit/82eeaf0f68bc1d8a843b3c3d81922d37b30bec4d))
* **db:** the in-place 1.2.0 -> 2.0.0 upgrade ([dcbdb46](https://github.com/SunReye/SunReye/commit/dcbdb46ed9a6acd2c77cfaab96519e85ba8f9009))
* **inverter-core:** sample computed-metric inputs in one atomic read ([fea7f48](https://github.com/SunReye/SunReye/commit/fea7f48eacd16930e488386afc20b268f058e7ab))


### Bug Fixes

* **addon:** derive the backup's raw-data exclusion from the live retention policy ([c6e68aa](https://github.com/SunReye/SunReye/commit/c6e68aac4a2364b9461e6389525ceac92771db4f))
* **addon:** exclude compressed chunk data from a non-full dump ([2ec3ec3](https://github.com/SunReye/SunReye/commit/2ec3ec3871ce88981c5977ae73dd2456bec5a2f9))
* **addon:** keep raw in the default backup once the minute tier is frozen ([3d159df](https://github.com/SunReye/SunReye/commit/3d159dfd0e3b1c8d88716f90f857502dc8dac944))
* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **addon:** serve the multiplexed live socket at exactly /ws ([ab06deb](https://github.com/SunReye/SunReye/commit/ab06deb285fb5bda0d08b8e84016d32cd41d07be))


### Performance Improvements

* **addon:** size PostgreSQL memory for a small box ([4435796](https://github.com/SunReye/SunReye/commit/443579645fc7dccaa9576805913a1e97f37c3fe1))
* **db:** compress after 2h, checkpoint every 2h, compress WAL with zstd ([42bac87](https://github.com/SunReye/SunReye/commit/42bac87c62ab92f3f9085d367e687e766dfc4b84))

## [1.2.0](https://github.com/SunReye/SunReye/compare/addon-v1.1.1...addon-v1.2.0) (2026-07-19)


### Features

* **db:** add evcc integration config schema ([5848e77](https://github.com/SunReye/SunReye/commit/5848e774df7857a37149fbd4c7747ed691afd6b8))
* **evcc:** optional residual-home split (Home = load − EV) ([0e0327f](https://github.com/SunReye/SunReye/commit/0e0327f3c6404afd026d38e3fd70f33ec9ec6702))
* **evcc:** stream loadpoint state to the dashboard over WebSocket ([67aad79](https://github.com/SunReye/SunReye/commit/67aad79a30002269fa21d22f4acbcf28cca009d8))
* **server:** evcc mqtt ingest, control relay, and routes ([98413b7](https://github.com/SunReye/SunReye/commit/98413b7a0394c6d8ef905334b0852d402167ff4a))
* **web:** EVCC EV charger — power-flow node, dashboard card, settings ([4d5fd57](https://github.com/SunReye/SunReye/commit/4d5fd5781ab835c46688f7f71168356c15b709bc))


### Bug Fixes

* **server:** keep solar forecast remaining-today fresh under cache ([23d07f9](https://github.com/SunReye/SunReye/commit/23d07f997792d0e8e027f2e93c839021b27e097c))
* **web:** make solar forecast dialog open instantly with fresh data ([9674a5e](https://github.com/SunReye/SunReye/commit/9674a5ed8a7a0d4e6a9020eaa02b31c43e1060b2))
* **web:** stop dashboard animation stutter on weak devices ([b2b10e6](https://github.com/SunReye/SunReye/commit/b2b10e6473641d71648117992ed94f12984d73c7))

## [1.1.1](https://github.com/SunReye/SunReye/compare/addon-v1.1.0...addon-v1.1.1) (2026-07-18)


### Bug Fixes

* **web:** keep KPI money value on one line in narrow dashboard cards ([d785203](https://github.com/SunReye/SunReye/commit/d785203e9939f3a49a53dfcf94c71fe774028212))
* **web:** keep KPI money/ratio value on one line in narrow cards ([1623250](https://github.com/SunReye/SunReye/commit/16232504533b9e05c4fd828df64aaae3616187f8))

## [1.1.0](https://github.com/SunReye/SunReye/compare/addon-v1.0.1...addon-v1.1.0) (2026-07-18)


### Features

* **server:** add battery/solar/grid 3-way consumption split to energy series ([a543e00](https://github.com/SunReye/SunReye/commit/a543e006f5daf6dc588d8c9b8dcaa1362d2499a4))
* **web:** compact overview cards + per-card detail dialogs with charts ([75f1db3](https://github.com/SunReye/SunReye/commit/75f1db3627677e3803ed9002cac5b4d01747015a))
* **web:** two-column overview on tablet/desktop with portrait diagram ([3925757](https://github.com/SunReye/SunReye/commit/3925757a5d88a4ceac6d229e5dc2b9db186b953c))
* **web:** weather card shows remaining kWh; forecast dialog overlays actual vs predicted ([02b5ed4](https://github.com/SunReye/SunReye/commit/02b5ed4cfc5e8d6bd802d0c9b4a74e29ad95343e))


### Bug Fixes

* **server:** use *.today registers for current-day energy split and cost KPIs ([d7f61b4](https://github.com/SunReye/SunReye/commit/d7f61b46266bc0194cb1ffd36e53ed022a28d54e))
* **web:** header-bar trigger on mobile, floating trigger + gutter on desktop ([7107941](https://github.com/SunReye/SunReye/commit/71079417e2e0ec06b660e187a1c6adf802824ede))
* **web:** pad app content so floating sidebar trigger never overlaps page headers ([86a854f](https://github.com/SunReye/SunReye/commit/86a854fa6b78943aa784ac1f0c60940e47733862))
* **web:** stack weather tile on narrow screens to stop temp/forecast overlap ([745b4d5](https://github.com/SunReye/SunReye/commit/745b4d555d0a04953bd5698293ffb1d56d7dd5e6))
* **web:** stop detail-dialog charts overflowing on mobile ([02db01d](https://github.com/SunReye/SunReye/commit/02db01d4763050c26e4da484da3933e09d62e591))


### Dependencies

* The following workspace dependencies were updated

## [1.0.1](https://github.com/SunReye/SunReye/compare/addon-v1.0.0...addon-v1.0.1) (2026-07-18)


### Bug Fixes

* allow every user to see the app in the sidebar and access via ingress ([e4c0f71](https://github.com/SunReye/SunReye/commit/e4c0f71dfcc61ab6503f2f7421c98099757a186b))

## [1.0.0](https://github.com/SunReye/SunReye/compare/addon-v0.7.1...addon-v1.0.0) (2026-07-18)


### ⚠ BREAKING CHANGES

* no inverter profile ships in the box. Existing installs keep their installed/active profile; new installs must install one from a profile source before the full dashboard comes online.


### Features

* **auth:** lock down read endpoints with a public-dashboard opt-out ([ffed21f](https://github.com/SunReye/SunReye/commit/ffed21f847697e98ad252a897a5db724e12497e8))
* **inverter-core:** generic role-based coherent simulator ([b2cbe12](https://github.com/SunReye/SunReye/commit/b2cbe129c1cc37467647cd10caf5041c40eccd94))
* **profiles:** bake in the official profile source (protected) ([b6ff3bd](https://github.com/SunReye/SunReye/commit/b6ff3bd8112b885963213baacd76570bd0692db1))
* remove bundled SG05 profile; ship profile-agnostic core ([440fcd2](https://github.com/SunReye/SunReye/commit/440fcd2f252e1ac822eacef8ae3ad14e7685c916))
* **weather:** Open-Meteo backend + location settings; dedupe accessors ([3a07f80](https://github.com/SunReye/SunReye/commit/3a07f804fee30b24bec610043300fd9f92dbf823))
* **weather:** PV production forecast on the weather tile ([aeabc30](https://github.com/SunReye/SunReye/commit/aeabc302cf760546f2509c176627cab23510d62c))
* **web:** add i18n infra (Paraglide) + English messages + missing-key lint ([26cc44c](https://github.com/SunReye/SunReye/commit/26cc44ccaa55cb6b7023c49855f29ec7022d1c01))
* **web:** add sensor visibility settings to hide metrics from the dashboard ([4cd919d](https://github.com/SunReye/SunReye/commit/4cd919ddee68eb5315772ba77f152a9201631fcf))
* **web:** anonymous read-only dashboard for logged-out visitors ([803619f](https://github.com/SunReye/SunReye/commit/803619ff40a718f973d720769873a8d7d3b3ebb2))
* **web:** give custom charts independent left/right y-axes per unit ([8d709a8](https://github.com/SunReye/SunReye/commit/8d709a88490c073c0e5613f0fbdf0bc4e5c1eab2))
* **web:** rework Costs headline tiles for clarity ([92bf171](https://github.com/SunReye/SunReye/commit/92bf17173edcb6b1b69e47d6efeffed8df41c4ed))
* **web:** single-screen kiosk overview + System detail page ([5c30cfe](https://github.com/SunReye/SunReye/commit/5c30cfefb0d01f876061a5e68b2d507b36306536))
* **web:** consistent sticky Save bar across settings forms ([dd4d025](https://github.com/SunReye/SunReye/commit/dd4d025814ed8dff958c56683a4787f0fcf69bd0))
* **web:** cost + self-consumption KPIs on the daily-energy cards ([bdeeddc](https://github.com/SunReye/SunReye/commit/bdeeddc49549d27a234507e09b92d9462a6d5de5))
* **web:** link to the public dashboard from login ([d77e9f8](https://github.com/SunReye/SunReye/commit/d77e9f8bb4b634812e0a59c88aea20e07e1d60aa))
* **web:** responsive kiosk power-flow redesign ([5393462](https://github.com/SunReye/SunReye/commit/5393462583dab794ceb04120a2d9cc04202432ef))
* **web:** restore self-sufficiency & self-consumption tiles on costs ([f91ae6d](https://github.com/SunReye/SunReye/commit/f91ae6dddcafac2c6f639badd67875c49b1bde7d))
* **web:** show today's solar savings on the production card ([1368c04](https://github.com/SunReye/SunReye/commit/1368c04d9376fa8ff78e0b365c2ae4ed897e3b81))
* **web:** split settings into routed panels with a grouped nav ([67d7e64](https://github.com/SunReye/SunReye/commit/67d7e640bca8c3296eb55f49fcb44af4b73cee85))
* **web:** translate auth, onboarding & setup wizard ([c5cd2f6](https://github.com/SunReye/SunReye/commit/c5cd2f6a003447eba2a22b8a5c63df5a865662d5))
* **web:** translate costs, history, controls & inverter components ([6c91294](https://github.com/SunReye/SunReye/commit/6c91294345723d29043624d54fda6d603593a8db))
* **web:** translate missed profile-source & TOU toasts ([2f7ee42](https://github.com/SunReye/SunReye/commit/2f7ee42132caeb500429e40db10e7fd745735655))
* **web:** translate role-mapped surfaces + fill de/es/it/fr ([33b8311](https://github.com/SunReye/SunReye/commit/33b83112d50a809579c8143dd361ea4b0e0381b9))
* **web:** translate settings area ([9c44ab0](https://github.com/SunReye/SunReye/commit/9c44ab027f3b92d85d98388a063c81259295bb00))


### Bug Fixes

* Home Assistant discovery, number ranges, settings tabs, chart dot ([a5beaf6](https://github.com/SunReye/SunReye/commit/a5beaf6f1fceebaee23942dffa94ada44d2ef61e))
* **inverter-core:** clamp range-annotated computed metrics ([f5d9132](https://github.com/SunReye/SunReye/commit/f5d9132cabcd51829623415e8f083f9125f2ba0e))
* **server:** boot onboarding-only when saved profile is missing ([1f77599](https://github.com/SunReye/SunReye/commit/1f775996db6bd625bb81a0dde2fed5a03527022e))
* **server:** serialize profile-repo syncs to avoid git lock races ([b5e408c](https://github.com/SunReye/SunReye/commit/b5e408c8f4742500bb679b4aba2a9a346f4c4747))
* **test:** load web test-setup and exclude paraglide from root coverage run ([24a7169](https://github.com/SunReye/SunReye/commit/24a716953404b56d92de716a8d0386c7d9fca5bc))
* **web:** align custom charts with entity charts on /history ([0c70c4c](https://github.com/SunReye/SunReye/commit/0c70c4c5428fefa5665440a74badf9a25b3dbafb))
* **web:** align daily-energy KPI rows and add loading skeleton ([08ff247](https://github.com/SunReye/SunReye/commit/08ff247c7864ccb09bd45e6a818a76616b72bd14))
* **web:** centre the overview tile strip when the weather tile is absent ([3738df2](https://github.com/SunReye/SunReye/commit/3738df25e5192b26d034681d51a6ab7af86655a8))
* **web:** group profile families by base-id token subset ([75a07e2](https://github.com/SunReye/SunReye/commit/75a07e2ba8499f2bd778f85a64b352f63983687d))
* **web:** honour hidden sensors in the power-flow diagram ([b862702](https://github.com/SunReye/SunReye/commit/b862702683b669b651df69ce042969de86ddf918))
* **web:** keep power-flow captions inside the hero on short viewports ([0ad109f](https://github.com/SunReye/SunReye/commit/0ad109f09c6292952bd237761ec1d70cc5678d24))
* **web:** make grid import/export tiles headline the euro amount ([92f06c4](https://github.com/SunReye/SunReye/commit/92f06c4573b4b6ccc87e707576afc8b305facca2))
* **web:** prevent first login from bouncing back to login ([af89186](https://github.com/SunReye/SunReye/commit/af891867c2b0a52d2f0f04b2f0ab327dea368d6d))
* **web:** reconnect metrics stream on resume and after socket loss ([9fa0e4c](https://github.com/SunReye/SunReye/commit/9fa0e4c2bc92cf7736274e48f202678a02ac0f9a))
* **web:** translate PV-string node flow state ([8aaa93c](https://github.com/SunReye/SunReye/commit/8aaa93c69ab22fe2837ff1f52d66d0b6fafa06f7))

## [0.7.1](https://github.com/SunReye/SunReye/compare/addon-v0.7.0...addon-v0.7.1) (2026-07-13)


### Bug Fixes

* **profiles:** register downloaded profiles immediately, no restart ([7bca64e](https://github.com/SunReye/SunReye/commit/7bca64e994e04de6cd96554fe2623f6645268f60))

## [0.7.0](https://github.com/SunReye/SunReye/compare/addon-v0.6.0...addon-v0.7.0) (2026-07-13)


### Features

* **db:** add custom charts schema and migration ([855f9a9](https://github.com/SunReye/SunReye/commit/855f9a9a6517be2892037059746a9deba1a47289))
* **inverter-core:** add semver parse/compare/bump utilities ([0bbdfe7](https://github.com/SunReye/SunReye/commit/0bbdfe760a314d546a229cdb278edce1f1d943cf))
* **server:** add background profile update checker ([58883cb](https://github.com/SunReye/SunReye/commit/58883cbb78cf447676c9e42d09f9411d9836aee8))
* **server:** add custom charts API routes ([350cd8c](https://github.com/SunReye/SunReye/commit/350cd8c16b8c0e54b850714a746d68110f48e2d5))
* **web:** add instance-wide date & time display preferences ([4d5e130](https://github.com/SunReye/SunReye/commit/4d5e1307f90d2920b248b69054366c295219a0a4))
* **web:** add a day stepper to the history range picker ([d9e29c3](https://github.com/SunReye/SunReye/commit/d9e29c33e8e1c978c111384eacd2d29620408f9f))
* **web:** add custom charts section to history page ([c46eee9](https://github.com/SunReye/SunReye/commit/c46eee9c95a0dfb908a88b465829d5f53c050618))
* **web:** auto-save profile sources with optimistic updates ([2f20016](https://github.com/SunReye/SunReye/commit/2f2001638c4149ba8de1e86052abb858edaaed21))
* **web:** group available profiles by manufacturer and family ([a202d44](https://github.com/SunReye/SunReye/commit/a202d44aed33fafd465ed6c4fbdd96a6eac6697c))
* **web:** show source repo on available profiles ([52d4411](https://github.com/SunReye/SunReye/commit/52d44111f3ffe559564ab4bc96ae59bbf1c54fc5))
* **web:** step forward into live view from the history stepper ([e75507d](https://github.com/SunReye/SunReye/commit/e75507d1f882c033884eba95e3c58ebf75ed51fe))
* **web:** surface available profile updates in settings ([a8a6bf4](https://github.com/SunReye/SunReye/commit/a8a6bf484757c7b7866aa38751ce0bd9da03b366))


### Bug Fixes

* **addon:** carry merged changelog and defer version bump until images are pushed ([ea9a58a](https://github.com/SunReye/SunReye/commit/ea9a58a748fb66e3e9652deb893e374f9e9ee438))
* **server:** natural-sort browsed profiles by manufacturer and model ([551e228](https://github.com/SunReye/SunReye/commit/551e22884311e12eca214e050208c5dd94d0b853))
* **web:** derive active route from the hash under the hash router ([63a0ba3](https://github.com/SunReye/SunReye/commit/63a0ba30658dd88a01a3cb798f270055c5872db2))
* **web:** keep the desktop sidebar open after navigation ([dbc0aef](https://github.com/SunReye/SunReye/commit/dbc0aef25942ee32e80fe365001758f83a15cfb5))
* **web:** stack profile meta over source repo on mobile ([72b2c1e](https://github.com/SunReye/SunReye/commit/72b2c1efbbdd6ef5a4e2e90ca6292fb707f32eaf))
* **web:** step into today from a non-day range in history stepper ([b71915d](https://github.com/SunReye/SunReye/commit/b71915d1b1d056fa4e900d4c976dfbde8d7a7f4b))


### Performance Improvements

* **deploy:** tune bundled postgres for write endurance ([2138bfb](https://github.com/SunReye/SunReye/commit/2138bfb21ababdb3fde2875a6132e8a33acf7ec1))
* **server:** batch history writes to cut SSD write wear ([30c30e3](https://github.com/SunReye/SunReye/commit/30c30e358d34375c1c9685f52c3ee5438c77202e))

## [0.6.0](https://github.com/SunReye/SunReye/compare/addon-v0.5.0...addon-v0.6.0) (2026-07-13)


### Features

* **inverter-core:** add sumOf deferred aggregates + prune dangling overlay refs ([41b413e](https://github.com/SunReye/SunReye/commit/41b413e4c6381a05ed204e4f8a84ef5fb7de4e20))
* **web:** add lock toggle to controls page ([af984dd](https://github.com/SunReye/SunReye/commit/af984dd0938935cb2115c913da4278ae279a1705))
* **web:** align setup profile picker with settings and animate selection ([ec64c05](https://github.com/SunReye/SunReye/commit/ec64c050146b547525762d4d8aec7e9345c72c61))
* **web:** move settings to sidebar footer, close nav on click ([3bcd3fe](https://github.com/SunReye/SunReye/commit/3bcd3feca2ff29deece1363fb431376501be3715))
* **web:** searchable profiles grouped by manufacturer with restart confirm ([d543faa](https://github.com/SunReye/SunReye/commit/d543faa8fab307f36f4b2151f099c79dd30aa1c0))


### Bug Fixes

* **web:** resolve mobile overflow across settings and setup ([4460188](https://github.com/SunReye/SunReye/commit/4460188886e85dbb17a9d033023d2ddd2e874a52))
* **web:** stop history chart overflow on non-live ranges ([e7833ed](https://github.com/SunReye/SunReye/commit/e7833ed0ed1021d67495b11bfa471d947b0b72d2))
* **web:** use native Tabs for settings navigation ([79b377d](https://github.com/SunReye/SunReye/commit/79b377d0e902cd65e85f6038ca11038b5e197637))

## [0.5.0](https://github.com/SunReye/SunReye/compare/addon-v0.4.0...addon-v0.5.0) (2026-07-12)


### Features

* **profiles:** add profile families & per-model variants ([ee0879d](https://github.com/SunReye/SunReye/commit/ee0879dd9dace727780dfa3b4bb596a37d21c06b))


### Reverts

* **docs:** publish the docs site under /SunReye again ([bee80d8](https://github.com/SunReye/SunReye/commit/bee80d8b863fcce2f8e3234b1cc0f431a84631c8))

## [0.4.0](https://github.com/SunReye/SunReye/compare/addon-v0.3.0...addon-v0.4.0) (2026-07-12)


### Features

* **docs:** publish the docs site at the organization root ([710a5ea](https://github.com/SunReye/SunReye/commit/710a5eabf8185c8551130c7457c05a373bba7612))

## [0.3.0](https://github.com/ediiiz/SunReye/compare/addon-v0.2.2...addon-v0.3.0) (2026-07-12)


### Features

* **addon:** serve the web UI as static files from nginx ([9c57dd2](https://github.com/ediiiz/SunReye/commit/9c57dd234fcc2b5fd7b706184a8ab5c6ebaa1c13))
* **addon:** ship server and migrate as one compiled binary ([68fd0db](https://github.com/ediiiz/SunReye/commit/68fd0db4db22a42f6253032363eb4ba3f9940bba))


### Performance Improvements

* **addon:** prune unused database runtime libraries ([a68f0aa](https://github.com/ediiiz/SunReye/commit/a68f0aa6d5a4d336f65e29cfcf74f65056f8f4a4))

## [0.2.2](https://github.com/ediiiz/SunReye/compare/addon-v0.2.1...addon-v0.2.2) (2026-07-12)


### Bug Fixes

* **addon:** manage postgres settings via include, add worker headroom ([cdd30b4](https://github.com/ediiiz/SunReye/commit/cdd30b42c6e0a1038b5fb26516407664d1f85361))
* **addon:** stop spooling the web bundle to a temp file ([ae8ce97](https://github.com/ediiiz/SunReye/commit/ae8ce97784f8d121104428bbaaf4f19021a4b84f))

## [0.2.1](https://github.com/ediiiz/SunReye/compare/addon-v0.2.0...addon-v0.2.1) (2026-07-12)


### Bug Fixes

* **addon:** stop exporting LOG_LEVEL into the container environment ([48da4b8](https://github.com/ediiiz/SunReye/commit/48da4b81aea928b677c13eb017dd38bfe22d13d9))

## [0.2.0](https://github.com/ediiiz/SunReye/compare/addon-v0.1.0...addon-v0.2.0) (2026-07-12)


### Features

* **addon:** home assistant addon with embedded timescaledb ([f22b52a](https://github.com/ediiiz/SunReye/commit/f22b52a039adbb10374357afcd5a299323727f5c))
