# Changelog

## [unreleased]

Unreleased work on `dev` since 3.0.2, shipped in `beta.20260910-d7f2bb4`.


### Features

* **web:** only a state worth acting on carries a badge ([7560d18](https://github.com/SunReye/SunReye/commit/7560d18709e910b036b995cd9b0760afa65bb98e))
* **web:** an integration owns the devices it provides, and has a page of its own ([f3ac572](https://github.com/SunReye/SunReye/commit/f3ac572b99ea488f94428f8014aafa3523010dee))
* integrations are rows under their connection, and the MQTT tab is gone ([6d3c414](https://github.com/SunReye/SunReye/commit/6d3c414cbc1164e654142f5458208304211df1d1))
* **server:** a connection owns its client, so integration status is observed ([2984093](https://github.com/SunReye/SunReye/commit/2984093ed7181446ed8397ea8588a0cce7032c82))
* **web:** the add wizard can create the connection it attaches to ([fa9c896](https://github.com/SunReye/SunReye/commit/fa9c8969f972214d8fdf0188fc2dd8650885fb31))
* **web:** name the wizard's catalog fields in the viewer's language ([b304f04](https://github.com/SunReye/SunReye/commit/b304f04046c296672264cff9b2f04994836d1856))
* **web:** one Add, and it is a wizard over the server's catalog ([7f68d91](https://github.com/SunReye/SunReye/commit/7f68d916584680e3b5cb19b07d606ffbd6ca6ff5))
* **server:** integrations as rows — service, routes and the EVCC topic root ([564baf4](https://github.com/SunReye/SunReye/commit/564baf484842bfde34ed13aa066a7a138d9982f9))
* **server:** the add-device contract becomes a tier union ([79ee70c](https://github.com/SunReye/SunReye/commit/79ee70c1b63216d14d31a13e16b63f3b03734ee2))
* **web:** rename and retire a coded or virtual device row ([807d946](https://github.com/SunReye/SunReye/commit/807d94632cc20272b034a1974f83bc33a283caa6))
* **db:** an integrations table, with the mqtt and evcc settings backfilled in ([40bc74b](https://github.com/SunReye/SunReye/commit/40bc74b15a469807b91a595d555ebeef375a52ae))
* **server:** an integration catalog keyed by connection kind ([8cdd139](https://github.com/SunReye/SunReye/commit/8cdd1399050aa944e5ff153027a027f822179a64))
* **web:** the MQTT tab becomes Integrations, over broker connections ([a2fc8d1](https://github.com/SunReye/SunReye/commit/a2fc8d154f329ce1ed663c2a9a8af8900619ea91))
* **web:** connections get a kind, and loadpoints group under their broker ([c8d0598](https://github.com/SunReye/SunReye/commit/c8d059892541a2515e17685ab1737c85e4ba5a08))
* **server:** create a connection on its own ([1774605](https://github.com/SunReye/SunReye/commit/177460595eb10b067fae49ead49f535e26776259))
* **server:** the broker is a connection, and the tier is picked by kind ([cedc749](https://github.com/SunReye/SunReye/commit/cedc749f0b885247900e69d0b8e20061b0e5d2c0))
* **db:** give connections a kind and params, devices a params ([d8bb1ed](https://github.com/SunReye/SunReye/commit/d8bb1ed33a5284a1c6f386f1f04f9be4c0600a1e))
* **db:** add the connection-kind discriminated union ([599e8a7](https://github.com/SunReye/SunReye/commit/599e8a7b07b9bf98a97ef774eb5c6b210614bef3))


### Bug Fixes

* **web:** the integration smoke case proves its payload without the pill ([2939ba7](https://github.com/SunReye/SunReye/commit/2939ba7d1012ce5c3141a5bbdfd4f370511250a0))
* **web:** the readings row is only as wide as it has readings ([177b1cf](https://github.com/SunReye/SunReye/commit/177b1cf314e9e010e6cf26a84cac4d63ee2d165d))
* **web:** the wizard's Modbus step asks for a device, not a catalog form ([4d01419](https://github.com/SunReye/SunReye/commit/4d01419381a068a91c38db8401baf98cd5588278))
* **db:** keep invariant C1 absolute — integrations.plant_id RESTRICTs ([c118136](https://github.com/SunReye/SunReye/commit/c118136c40ea1555dc438fe463154cb90a0f0894))
* **server:** narrow the coded-device patch gate to topology only ([893ee8e](https://github.com/SunReye/SunReye/commit/893ee8ecdcf9757a54c2d1608d9330fc273a4595))
* **repo:** make the pre-push hook fail on its own, not on its caller's -e ([e5887a6](https://github.com/SunReye/SunReye/commit/e5887a628c92dcc10c8dbda36debb34554fb33e5))
* **repo:** a pre-push hook, so a bypassed pre-commit cannot reach the remote ([c395514](https://github.com/SunReye/SunReye/commit/c395514d2730e9de87edf2e277d1c72cd90adade))
* **ci:** shape the upgrade test from the last 1.x release, not the previous one ([de71425](https://github.com/SunReye/SunReye/commit/de7142504143436db62bdeeda64b2bdac70faa0c))
* **test:** police every mock.module target, not only the first-party ones ([53feb1e](https://github.com/SunReye/SunReye/commit/53feb1eb8f60358d44d28da0f852ae2c15e6048f))
* **server:** disarm the broker probe's watchdog when the dial settles ([3189bac](https://github.com/SunReye/SunReye/commit/3189bac1abda36a8b6119b28b54693e271866ece))
* **ci:** seed a connection by kind and params, not by a dropped column ([fd0f554](https://github.com/SunReye/SunReye/commit/fd0f5540c6c0c9cdcef216e71c29890a652f5797))
* **db:** carry a connection's kind through the archive, and mask its password ([7b42301](https://github.com/SunReye/SunReye/commit/7b42301ba15711827fd89594b3b1f23ec6c496b6))
* **server:** mask the broker password on every edge that returns a connection ([6350810](https://github.com/SunReye/SunReye/commit/6350810fa73f16ebc5dc19a3edf19fcbcfeff787))
* **web:** fetch and append the day on a custom chart too, not the RAM buffer ([5df9430](https://github.com/SunReye/SunReye/commit/5df9430760617ba7345f07a9b8b78d04835c21ce))
* **web:** show the elapsed day on /history's Day tab, not the live buffer ([a5c0a47](https://github.com/SunReye/SunReye/commit/a5c0a4750aacec6c8c652d34c06d67c9f4e68176))
* **web:** move the source switcher into the sidebar header ([ef86ea6](https://github.com/SunReye/SunReye/commit/ef86ea65db8adc3faae2b74b606065b9771e5ff9))
* **web:** make the devices panel and the settings tab strip fit a phone ([7b2d505](https://github.com/SunReye/SunReye/commit/7b2d505ec532ff9d48317d543bb261731bb912b2))
* **web:** group coded and virtual devices apart from the Modbus gateways ([059dcba](https://github.com/SunReye/SunReye/commit/059dcbaf174023e45ed6500b7f2fa8e116cf6560))
* **server:** report a device's kind and state, and refuse a Modbus patch on a coded one ([43cf521](https://github.com/SunReye/SunReye/commit/43cf521266c1362722f4ae4dfb7bbc5a0bbf7681))


### Code Refactoring

* split the two functions over the complexity ceiling ([d8f02de](https://github.com/SunReye/SunReye/commit/d8f02de3effa5e1bb2d9c027b0c083c792180caf))
* **db:** one staging-table walk, one common-field decode ([137269c](https://github.com/SunReye/SunReye/commit/137269c37a2d4214735d4db1008aa72cc9c01653))
* **scripts:** one drop-and-create for the two rehearsal scripts ([06a9a92](https://github.com/SunReye/SunReye/commit/06a9a920b546eda725f1c7aa6bc1869fe118e5c9))
* **web:** one grouped bar mark for the two statistics bar charts ([3dbdd59](https://github.com/SunReye/SunReye/commit/3dbdd59f079a700081f81d449e6f855e2cc2a0a0))
* **inverter-core:** one wall-clock reader for the server and the web app ([ed46d12](https://github.com/SunReye/SunReye/commit/ed46d12873f2454a953b519724c32f5d09857613))
* **inverter-core:** one slugify, shared by the server and the web app ([81452be](https://github.com/SunReye/SunReye/commit/81452be5bb6c8993de3f7c8d97c6e3deb2111d06))
* **server:** split the battery scoring pass into plan, walk and schedule ([101bb2d](https://github.com/SunReye/SunReye/commit/101bb2d9c33e0fb9aac6f8acab0e46fa96bea54a))


### Tests

* **server:** cover the database half of battery health ([90abec6](https://github.com/SunReye/SunReye/commit/90abec6c9a04f11d555c0971c0256290e0199650))
* **server:** cover the runtime's four uncovered failure seams ([dfa1d6f](https://github.com/SunReye/SunReye/commit/dfa1d6f3b3c6b20638a017afa5f8286f09f37d46))
* **server:** run the connection probe's real dials against a loopback socket ([33bbeae](https://github.com/SunReye/SunReye/commit/33bbeae0810b00e060baff2db14d4dfbc86da39b))
* **server:** cover the MQTT broker instance wrappers ([69a4b23](https://github.com/SunReye/SunReye/commit/69a4b23303cb46222a641cf272044dc47ad09a11))
* **db:** prove migration 0006 against a real Postgres ([159c712](https://github.com/SunReye/SunReye/commit/159c712d2a9bb67e2cdcf5071f27828eb512ab20))

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

## [3.0.2](https://github.com/SunReye/SunReye/compare/addon-v3.0.1...addon-v3.0.2) (2026-09-09)


### Bug Fixes

* **server:** chunk the battery scoring pass and index the power series ([65597a0](https://github.com/SunReye/SunReye/commit/65597a030708f1ebf616bad3f4a755eda7efb8cc))

## [3.0.1](https://github.com/SunReye/SunReye/compare/addon-v3.0.0...addon-v3.0.1) (2026-09-09)


### Bug Fixes

* **db:** never rewrite the migration record on a re-run of the blocking upgrade ([a736b12](https://github.com/SunReye/SunReye/commit/a736b125604115a826f65ef1603d3141bf3d4bca))
* **db:** never rewrite the migration record on a re-run of the blocking upgrade ([a95b59c](https://github.com/SunReye/SunReye/commit/a95b59c5333266b8646063c4b560ae69dd9c7059))

## [3.0.0](https://github.com/SunReye/SunReye/compare/addon-v2.0.0...addon-v3.0.0) (2026-09-09)


### ⚠ BREAKING CHANGES

* **release:** SunReye 2.0.0 rebuilds how readings are stored. A reading is now identified by a device and a metric rather than by a profile id and a metric name, which retires both 1.x rollup generations and resets the schema. The upgrade from 1.2.0 is in place and automatic: a sub-second catalogue step during start-up, after which live data works, followed by a resumable backfill that replays pre-upgrade history and can be deferred. Until that backfill has run, charts cover only the time since the update, and ranges reaching further back are refused with an explanation rather than answered partially. On first open the instance asks once for a plant name and an inverter name, and holds Home Assistant MQTT discovery until both are set. Home Assistant entity ids, MQTT topics and every named API contract are UNCHANGED.
* **db:** re-key the timeseries on devices and collapse to one baseline schema


### Features

* amortisation statistics from the lifetime counters ([cff531f](https://github.com/SunReye/SunReye/commit/cff531f4003cd269236d10619aed88e6e100a54d))
* amortisation statistics from the lifetime counters ([31a3bbb](https://github.com/SunReye/SunReye/commit/31a3bbbdbd87714c015a0e4440b8d6ddf726b13d))
* **automations:** charge from the grid during negative-price windows ([43b66c7](https://github.com/SunReye/SunReye/commit/43b66c7ab9f532235072bd5428eb1576ad570c85))
* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **automations:** use EVCC battery boost to empty the pack ([76bf1ed](https://github.com/SunReye/SunReye/commit/76bf1ede652d50368cad513efae32b9999c2e427))
* chart zoom, an honest peak-shaving reserve, and the layout docs ([6fa4f3b](https://github.com/SunReye/SunReye/commit/6fa4f3be1783e606b2d86160750dcfe5a8312d54))
* **charts:** let a saved chart name the device each series is read from ([50f6881](https://github.com/SunReye/SunReye/commit/50f6881e0ed9cbe4755823f5a088b1199bd02d71))
* choose the chart palette in settings ([95a5dcc](https://github.com/SunReye/SunReye/commit/95a5dcc21bb9d7ea528b85a4ae4b65f13ada33a7))
* **db:** a weight column on the hot path ([e464e3f](https://github.com/SunReye/SunReye/commit/e464e3fa7f5df41a21b865a06bc3f125e8d94605))
* **db:** add statistics preferences schema ([57d1e52](https://github.com/SunReye/SunReye/commit/57d1e5272c520238821eea1e63b253a6e6d88239))
* **db:** admit the virtual 'optimizer' role before the 2.0.0 baseline ships ([37dcc1a](https://github.com/SunReye/SunReye/commit/37dcc1ad737ac64b047ce671b971ef83b2c77d41))
* **db:** an inverter's PV arrays and panel physics live on its device row ([86cd5e8](https://github.com/SunReye/SunReye/commit/86cd5e81a64b12a71f02e59cb75fe4623fb8df0c))
* **db:** build one database image carrying timescaledb_toolkit ([acafef4](https://github.com/SunReye/SunReye/commit/acafef44e91b1771578b2acc965ba5901e26295b))
* **db:** enforce six schema invariants with CHECK constraints ([c9460d1](https://github.com/SunReye/SunReye/commit/c9460d15a7002d3e891caf97c793bbcbd5f5a666))
* **db:** freeze the minute aggregates and keep raw for five years ([554ca75](https://github.com/SunReye/SunReye/commit/554ca75cae43888ebee21bd29b88d91291e7a147))
* **db:** give a device a retirement date ([4bdb133](https://github.com/SunReye/SunReye/commit/4bdb133a2ccb1e4b2bb28929c99a965dbc4c66e6))
* **db:** portable export/import as a permanent, schema-independent feature ([166220b](https://github.com/SunReye/SunReye/commit/166220b80a529be0b992b876af5cb0e1cc4b98e7))
* **db:** provision the plant spine and move plant facts onto columns ([a5ba46a](https://github.com/SunReye/SunReye/commit/a5ba46aba8fe04df24e2754b451c7759f4d423b2))
* **db:** re-derive retention against the measured footprint ([82eeaf0](https://github.com/SunReye/SunReye/commit/82eeaf0f68bc1d8a843b3c3d81922d37b30bec4d))
* **db:** re-key the timeseries on devices and collapse to one baseline schema ([59de72d](https://github.com/SunReye/SunReye/commit/59de72d8d5912af801534f6ece143a2402744f10))
* **db:** record a metric's unit alongside its counter class ([084df8c](https://github.com/SunReye/SunReye/commit/084df8c496bb0ab7804a3baae0777970c1449d18))
* **db:** replay 1.2.0 aggregate buckets forward as metrics_raw intervals ([8dc56a0](https://github.com/SunReye/SunReye/commit/8dc56a0a042f2149cdf2c9f7f0cbdf5007cc4563))
* **db:** the in-place 1.2.0 -&gt; 2.0.0 upgrade ([dcbdb46](https://github.com/SunReye/SunReye/commit/dcbdb46ed9a6acd2c77cfaab96519e85ba8f9009))
* **db:** type the TimescaleDB surface — hyperfunction wrappers, declared aggregates, parity ([4c805fc](https://github.com/SunReye/SunReye/commit/4c805fc87aaa4b6ae1675218a042a7f57787d156))
* **db:** widen devices_role_check for virtual devices ([5c04ba1](https://github.com/SunReye/SunReye/commit/5c04ba138dec06bb0e5848329ae9a96876d5c025))
* **devices:** the connection dialog's test is a port probe, not a register read ([f4186c4](https://github.com/SunReye/SunReye/commit/f4186c467b79a0c134c13c2970a1231cf03fe755))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* make the role vocabulary fit non-Deye inverters ([39db7f8](https://github.com/SunReye/SunReye/commit/39db7f805c9ae02b774cce2fd06555417c029d57))
* measured battery capacity and state of health, and the settings move it forced ([186968e](https://github.com/SunReye/SunReye/commit/186968ec4cf7618fdc6953952c0a0dc0e0ca8a2d))
* plant time zone setting + dropdown scroll + energy/cost day alignment ([2048a31](https://github.com/SunReye/SunReye/commit/2048a31d59abe148cab95a7f4838925787431651))
* plant-level visualization and history across devices, device view on demand ([#202](https://github.com/SunReye/SunReye/issues/202)) ([a5fa786](https://github.com/SunReye/SunReye/commit/a5fa786fe3f04a404c8e421890194faa66ac35df))
* **scripts:** build a reproducible addon-1.2.0 fixture from git ([b65f4d8](https://github.com/SunReye/SunReye/commit/b65f4d890b045e02ac3fd3cb2125f6d2d6fd2256))
* **scripts:** make the parity snapshot takeable against a 1.2.0 database ([588c394](https://github.com/SunReye/SunReye/commit/588c3943eb2186684f5c715236ca8eee294a6524))
* **scripts:** the storage-wear harness, so the projections become gates ([a89bd08](https://github.com/SunReye/SunReye/commit/a89bd08f07db19aa4210b2e5b1126558775c5b69)), closes [#122](https://github.com/SunReye/SunReye/issues/122)
* serve minute buckets from raw, freeze the minute aggregates, keep raw five years ([bcfb46f](https://github.com/SunReye/SunReye/commit/bcfb46fbe9a72483e5e97360a1ed8e91cd51de6c))
* **server:** a device registry keyed by the devices table ([253ca49](https://github.com/SunReye/SunReye/commit/253ca4962b375421f08cb78cbcd05ad817461f12))
* **server:** an inverter's arrays, physics and pack are edited on its device ([5f1ef48](https://github.com/SunReye/SunReye/commit/5f1ef48ec5e6c9c976fbd814afe3e99c33fae52e))
* **server:** answer minute buckets from raw ([e7604e7](https://github.com/SunReye/SunReye/commit/e7604e7589587600aaeeea775b5ab84de8583ba7))
* **server:** apply §51 zero-value export to the cost series ([067ad2e](https://github.com/SunReye/SunReye/commit/067ad2e1dc10a1a2f9cc161d324ee9bca034fc20))
* **server:** change-encode the stored series, with the duration each value held ([70cc884](https://github.com/SunReye/SunReye/commit/70cc884aaf73e77f77fe324fa39c775c24099927)), closes [#117](https://github.com/SunReye/SunReye/issues/117)
* **server:** compress responses with @elysia/compress ([2a9f59f](https://github.com/SunReye/SunReye/commit/2a9f59f0b9fd13bd35360f9102565113c3fa473e))
* **server:** count and export the history buffer's dropped rows ([290c619](https://github.com/SunReye/SunReye/commit/290c61982fef9f7167b2a2deadf083fe29b54152)), closes [#119](https://github.com/SunReye/SunReye/issues/119)
* **server:** dedicated plant time zone for server-side bucketing ([55885f1](https://github.com/SunReye/SunReye/commit/55885f12da13941a67e9bf5a47d7e28e5528585b))
* **server:** device roster API — list, add on an existing or new gateway, rename, retire ([dcc7198](https://github.com/SunReye/SunReye/commit/dcc71987177881b8a24eac1adad7fd34cd6b2a59))
* **server:** edit and delete connections; re-point a device from its patch ([4309b5a](https://github.com/SunReye/SunReye/commit/4309b5a8cf20266c6879af9096718c60a247d383))
* **server:** expose the write seam on the runtime, and wire retire -&gt; forget ([15e9f5f](https://github.com/SunReye/SunReye/commit/15e9f5f3e597bf42459b788efa40831cbbf4637b))
* **server:** finish the irradiance provider seam ([063086f](https://github.com/SunReye/SunReye/commit/063086fa94c53c62c67b3643941032599d6716e9))
* **server:** imply house consumption when nothing meters it ([7404790](https://github.com/SunReye/SunReye/commit/7404790920519232f9e1f5ba89a221ad52d3082d))
* **server:** live statistics stream over websocket ([94f0d0c](https://github.com/SunReye/SunReye/commit/94f0d0c8274e6379edcfd740b80de5ba60dc2160))
* **server:** lock down engine reads for 2.0.0, and prove every route's gate ([46f5923](https://github.com/SunReye/SunReye/commit/46f5923db8c8a9f6f9cd00e96702708c6cad1289))
* **server:** measure battery capacity and state of health ([4ac71f9](https://github.com/SunReye/SunReye/commit/4ac71f9db8b4f0cf1fac75815ebc78340211487e))
* **server:** multiplexed /ws with per-topic authorization ([f42d09a](https://github.com/SunReye/SunReye/commit/f42d09a77f483b2472520160e42337723510ce05))
* **server:** name the MQTT bridge by the plant and device slugs ([4891a92](https://github.com/SunReye/SunReye/commit/4891a921cc527ccbe1abe2bb616bd402f5c7fa83))
* **server:** period comparison and all-time records endpoints ([8cb7abf](https://github.com/SunReye/SunReye/commit/8cb7abf38545ad4f9dc956a49273f2a8eac9fc61))
* **server:** Phase 2a — DeviceInstance registry, the write seam, and the end of the activeProfile global ([ad77dc5](https://github.com/SunReye/SunReye/commit/ad77dc561814d7e46eb5c985d3454920db8b58ad))
* **server:** Phase 3 — the profile tier serves capabilities through the DeviceInstance contract ([41d6636](https://github.com/SunReye/SunReye/commit/41d66362f00c7bf6c8083c2983333dfcb75f01e1))
* **server:** Phase 4.5 — the optimizer becomes a tier-1 device and its decisions land in metrics_raw ([778d1cd](https://github.com/SunReye/SunReye/commit/778d1cdfa618713c9b0c82d0809c356d49c085fe))
* **server:** plant and device sources on every history, energy and statistics read ([04e95d7](https://github.com/SunReye/SunReye/commit/04e95d77067f7f60ebd7248a7ff25d9b91adc347)), closes [#202](https://github.com/SunReye/SunReye/issues/202)
* **server:** promote EVCC's charge-power provenance into the sample model ([8cd6e9e](https://github.com/SunReye/SunReye/commit/8cd6e9ef18946f6e88fad195bdc73cccab2ae0c1))
* **server:** prove every route's gate, and close the last public one ([3a353a3](https://github.com/SunReye/SunReye/commit/3a353a35ffd458655cc88ed2c0e67f1a88377db4))
* **server:** re-key automation state by device, once, on read ([ace639a](https://github.com/SunReye/SunReye/commit/ace639afa5736c20405d728be4c6fe64b86120ea))
* **server:** register EVCC loadpoints as devices, with history ([1d2646a](https://github.com/SunReye/SunReye/commit/1d2646afa6565ae4764c89d019356c7eb4809000))
* **server:** restore request correlation lost with @logtape/elysia ([a8bafe9](https://github.com/SunReye/SunReye/commit/a8bafe9c1e6709efbdfba7474a98fa4ce2d85470))
* **server:** retire the profile-keyed HA announcements, once ([95376d8](https://github.com/SunReye/SunReye/commit/95376d8fd4c80e9c072a93fde3aa15973e0d3ccd))
* **server:** route config registers and absent hardware out of metrics_raw ([33760c6](https://github.com/SunReye/SunReye/commit/33760c64d2b29f99f5a92e2d1de3e9ed1c4a79a5))
* **server:** serve each rollup bucket from one source, preferring the weighted one ([c4b9631](https://github.com/SunReye/SunReye/commit/c4b9631b1c8981fd851ae81d9eedfb3a070cece4)), closes [#116](https://github.com/SunReye/SunReye/issues/116)
* **server:** serve the dashboard from the compiled binary ([b52de5e](https://github.com/SunReye/SunReye/commit/b52de5ec5c578165df9781a901bc071d8f950a80))
* **server:** serve the manifest from the device, not the profile object ([4567a8c](https://github.com/SunReye/SunReye/commit/4567a8c4b85b87cdc5fa2efdd358ebe086e8a084))
* **server:** spot price analytics endpoint ([1bf1b38](https://github.com/SunReye/SunReye/commit/1bf1b3849472e60a802a1f549c8c6c777ac0636f))
* **server:** statistics preferences endpoints ([27156ca](https://github.com/SunReye/SunReye/commit/27156ca4bdb4b6bf4ebb15d8c5ec5f3a47474eb5))
* **server:** statistics route module with hour-weekday heatmap ([e947e0b](https://github.com/SunReye/SunReye/commit/e947e0baf44a30830080d4648e5066a5940f9869))
* **server:** the forecast reads its arrays from the inverters, not the plant ([35c8f8c](https://github.com/SunReye/SunReye/commit/35c8f8cac35d2bbec724f55842ed871bedf69564))
* **server:** the live sample is stamped with the device slug, not the profile id ([932240e](https://github.com/SunReye/SunReye/commit/932240eb6f1140cb3ef7a600fcadde152b595fdc)), closes [#202](https://github.com/SunReye/SunReye/issues/202)
* **server:** the migration onboarding routes, with the slug frozen at announcement ([5633f5d](https://github.com/SunReye/SunReye/commit/5633f5d958ee739581c4039d62ea461a05c45ecc))
* **server:** the multi-device write seam, keyed by the device instance ([1a3a1f6](https://github.com/SunReye/SunReye/commit/1a3a1f6d79f4913b4260035a8963bd823576d5d6))
* **server:** the optimizer is a device, and its decisions are history ([928bc28](https://github.com/SunReye/SunReye/commit/928bc2838f19fb4c2ac55c1a78f6e942352dbf3d))
* **server:** track battery charged energy in rollup reads ([9902ea2](https://github.com/SunReye/SunReye/commit/9902ea2731cb08f9e41ad546f80688f9f17a04ce))
* **server:** upgrade to Elysia 2 ([d280e20](https://github.com/SunReye/SunReye/commit/d280e20b7f2edef453afeb5175457db69f97fb86))
* **tooling:** extend the TDD gate to Rust before any .rs exists ([d43aa42](https://github.com/SunReye/SunReye/commit/d43aa42c8e3c152cd4f3b7799f606f17b0cebf50)), closes [#95](https://github.com/SunReye/SunReye/issues/95)
* **web:** capacity and health tiles for the measured battery ([10abc21](https://github.com/SunReye/SunReye/commit/10abc21bd31e1be194ee3dcf88876c849d1a2a15))
* **web:** categorical chart palette, and a colour per series ([884c4b6](https://github.com/SunReye/SunReye/commit/884c4b66858150770cba9ef76abb691d3af53d56))
* **web:** choose the plant or one device, and every read follows ([4e2f9d3](https://github.com/SunReye/SunReye/commit/4e2f9d3f65aec4eca5134683b95d687c23fb1e0c)), closes [#202](https://github.com/SunReye/SunReye/issues/202)
* **web:** compare replaces add-to-chart in the card header ([55490a2](https://github.com/SunReye/SunReye/commit/55490a21fcc36d55dd11cbc83d73144224a7f98f))
* **web:** draft a chart on a full-screened metric card ([a718f90](https://github.com/SunReye/SunReye/commit/a718f90a7f01744af3548a4ff342c759b7952c9f))
* **web:** mobile UX pass, standardised date navigation, and browser coverage for every page ([6646324](https://github.com/SunReye/SunReye/commit/6646324c7faf0b6cd6bc7eb68c00e89c4deb26c2))
* **web:** settings devices tab ([4b450ce](https://github.com/SunReye/SunReye/commit/4b450ce589684f2ae22e624407f6942869233266))
* **web:** the battery's nominal voltage moves to the plant settings ([6714eca](https://github.com/SunReye/SunReye/commit/6714ecabe1717daf203c2bb949798f425c33e52f))
* **web:** the power-flow diagram shoots charges of energy ([a1d50dc](https://github.com/SunReye/SunReye/commit/a1d50dca274b0f69e111a5eff19bd9fd60cc1b81))
* **web:** the roof and the pack are edited on the inverter, not the plant ([70d9c3c](https://github.com/SunReye/SunReye/commit/70d9c3c545bbe4343f57544cbfbfc3016527311a))
* **inverter-core:** phase currents for load, backup and generator, backup frequency, generator total ([16f7b9b](https://github.com/SunReye/SunReye/commit/16f7b9b14c65ff748779142fc60c4a8df07b2c87))
* **web:** a battery round-trip efficiency tile ([e105692](https://github.com/SunReye/SunReye/commit/e1056925ebf3f8f179f9660e11f44cd64b93baca))
* **web:** a blank export cap starts as the inverter's sell limit ([977f82d](https://github.com/SunReye/SunReye/commit/977f82dc8611b7433148f222e07eeba8fe65cca8))
* **web:** a plant ceiling the diagram can be measured against ([9264964](https://github.com/SunReye/SunReye/commit/92649641f95ac427f3164b1b6b6eaafeb37c9719))
* **web:** add a metric to a custom chart from its own card ([696b0a1](https://github.com/SunReye/SunReye/commit/696b0a19b19bf3a29e2978d7f5c204b5f6a40469))
* **web:** canonical page shell and section primitives ([194b05e](https://github.com/SunReye/SunReye/commit/194b05e85ebe4ef3b0335bed7e28df1045a1eb97))
* **web:** compare every statistics figure with its reference window ([723b04e](https://github.com/SunReye/SunReye/commit/723b04e1ae8ed115b08f73191e10e456d7c87f67))
* **web:** delete icon on installed profiles no device uses ([6a488e0](https://github.com/SunReye/SunReye/commit/6a488e0ab42fcfef7d0a0e75272909f9a7f45a86))
* **web:** energy analytics section ([c389bbe](https://github.com/SunReye/SunReye/commit/c389bbe081fbec7fed00c6e55d7c1e965dc8ecb2))
* **web:** full screen moves to the plot's corner, away from the caret ([15723cb](https://github.com/SunReye/SunReye/commit/15723cbe1c08d5d5b78760a0483be6b8f110b0b2))
* **web:** hub and nodes answer the plant's load ([61626df](https://github.com/SunReye/SunReye/commit/61626dfedc5129e71acfc6fad08c7c083ce1be84))
* **web:** live indicator and dated section captions ([3c8ccf2](https://github.com/SunReye/SunReye/commit/3c8ccf277fe52c99bc114961ddb3da4ce96093da))
* **web:** live statistics updates over websocket ([c81b22e](https://github.com/SunReye/SunReye/commit/c81b22e49a7e5073ccda4699c996ac816db51fe0))
* **web:** merge the inverter panel into Devices — gateways as groups, dialogs to edit ([f7e8dec](https://github.com/SunReye/SunReye/commit/f7e8decbb82881d2cf8af3f85b7cde28a55f7865))
* **web:** migration onboarding page, an app-wide missing-history banner, and a loud 422 ([c7c1f84](https://github.com/SunReye/SunReye/commit/c7c1f84be186e7c265ca08a7b0f7c03c338da622))
* **web:** move /system's readings onto the power-flow nodes ([22ae4e5](https://github.com/SunReye/SunReye/commit/22ae4e529581a790778e59ea43e6d29d12c27c15))
* **web:** nameplate setting and the capacity degradation chart ([bb35d49](https://github.com/SunReye/SunReye/commit/bb35d4987846962d439df44fc47ba1daacb565b4))
* **web:** navigate history and statistics by period ([59b3852](https://github.com/SunReye/SunReye/commit/59b3852da6b9e94d0d24eb3abc4e90fad215af80))
* **web:** one interaction model and one house style for every chart ([564b9bc](https://github.com/SunReye/SunReye/commit/564b9bc13c083b1f25b6d7f823d87cf5172ff7fa))
* **web:** one leased socket with topic subscriptions ([d281575](https://github.com/SunReye/SunReye/commit/d281575929c636d489d2bacb3432f0a3ea0b8bb6))
* **web:** open each power-flow node onto its own readings, and retire /system ([dd77bcb](https://github.com/SunReye/SunReye/commit/dd77bcbca06e063750b8b40c2597b45f259124af))
* **web:** rename /costs route to /statistics with hash redirect ([7c339a6](https://github.com/SunReye/SunReye/commit/7c339a65d7ce83b595b814f36ca0b5b3a798cc36))
* **web:** render the home node from the load metric, not the UPS capability ([f076931](https://github.com/SunReye/SunReye/commit/f076931e40211ecfd3deee77dffda724f510ecf3))
* **web:** seed chart view scope from the saved preference ([055c799](https://github.com/SunReye/SunReye/commit/055c799467ba6e42506444dacee091ff5ff25783))
* **web:** Settings → Devices tab with an add-device dialog ([f02ca81](https://github.com/SunReye/SunReye/commit/f02ca81df269fed01d374fb946d8397e75fb3bc0))
* **web:** show grid imported and exported energy on /statistics ([c56b7f9](https://github.com/SunReye/SunReye/commit/c56b7f96573d04798db23fd3481f27dc5af950d7))
* **web:** spot price analytics section ([a4b85c2](https://github.com/SunReye/SunReye/commit/a4b85c2e079949f8411d8b4137ee9cd22e1bbaa7))
* **web:** take any chart to the whole screen ([be82a7a](https://github.com/SunReye/SunReye/commit/be82a7a94ba99ad87eea8fcdb0d19af3079b3afa))
* **web:** the export cap's placeholder is the inverter's sell limit ([dd898f7](https://github.com/SunReye/SunReye/commit/dd898f7ab6b1d3efda43862c258595f723d0eba6))
* **web:** the home node carries a separately metered backup output ([d066040](https://github.com/SunReye/SunReye/commit/d06604059fb50f7d5ae16a6b8f14bc080cac6efa))
* **web:** the interleaved pulse ladder ([f30c49e](https://github.com/SunReye/SunReye/commit/f30c49e6cc19e211b69d00aa3565992f7d1d6568))
* **web:** the plant's export cap shows the inverter's sell-limit register beside it ([1d5d7fa](https://github.com/SunReye/SunReye/commit/1d5d7fa9012e5b8835fb5c6cdce6fb42392cdfc4))
* **web:** two fingers zoom any chart, with nothing to arm ([65d26ba](https://github.com/SunReye/SunReye/commit/65d26ba24b2129dde64617cc0bdb558d57fa8d36))
* **web:** zoom the overlaid chart, saved or drafted ([4764645](https://github.com/SunReye/SunReye/commit/47646450ce1cda8847ab7302be11189322a5ac0c))


### Bug Fixes

* **2.0.0:** make the dimension spine the authority, not a mirror ([535a289](https://github.com/SunReye/SunReye/commit/535a28962f44d380122a003d3cb5c4ade7f6f1f6))
* **addon:** derive the backup's raw-data exclusion from the live retention policy ([c6e68aa](https://github.com/SunReye/SunReye/commit/c6e68aac4a2364b9461e6389525ceac92771db4f))
* **addon:** exclude compressed chunk data from a non-full dump ([2ec3ec3](https://github.com/SunReye/SunReye/commit/2ec3ec3871ce88981c5977ae73dd2456bec5a2f9))
* **addon:** keep raw in the default backup once the minute tier is frozen ([3d159df](https://github.com/SunReye/SunReye/commit/3d159dfd0e3b1c8d88716f90f857502dc8dac944))
* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **addon:** serve the multiplexed live socket at exactly /ws ([ab06deb](https://github.com/SunReye/SunReye/commit/ab06deb285fb5bda0d08b8e84016d32cd41d07be))
* **auth:** trust a request's own origin only when it is same-origin ([ed89a0f](https://github.com/SunReye/SunReye/commit/ed89a0f866c4a65562043412052590a714142860))
* **automations:** derive EV demand when EVCC reports none ([619c4f3](https://github.com/SunReye/SunReye/commit/619c4f301845da5a33325079522f324674a97f4e))
* **automation:** steer on the pack voltage the battery row states ([71e4b5c](https://github.com/SunReye/SunReye/commit/71e4b5c241eb7e9591079b8262b802e3c9794bfd))
* **automation:** the live limit readback resolves voltage like the target does ([5470d42](https://github.com/SunReye/SunReye/commit/5470d42f9d3fb81a1981d42858b4e3241cc0e573))
* **ci:** assert the 2.0.0 upgrade contract, not 1.x's ([46af680](https://github.com/SunReye/SunReye/commit/46af6800f092c4f9dc6ad499af1038c4633eae35))
* **ci:** create timescaledb before restoring, and publish 5432 for the shaping step ([febca3d](https://github.com/SunReye/SunReye/commit/febca3d03515b2fa9c1df7faadee7217915e883c))
* **ci:** fetch tags for the database jobs, and clear the code-health gate ([8912ae7](https://github.com/SunReye/SunReye/commit/8912ae71b7ea9d91331f7c42675d1ed5897d48bf))
* **ci:** import the db by path in the weighted-rollups gate ([56dfe1f](https://github.com/SunReye/SunReye/commit/56dfe1fbf57a78d9ac37db62ef26717725ab0097))
* **ci:** make the upgrade job's seed step survive a lost compression race ([a9a9118](https://github.com/SunReye/SunReye/commit/a9a9118b6e1c0d59f7fa05b890e4ca85bdec21bb))
* **ci:** make the upgrade job's seed step survive a lost compression race ([83a8136](https://github.com/SunReye/SunReye/commit/83a8136a9d1a82cabddbfa76696fb42d6399ddcd))
* **ci:** materialize the weighted tiers in the restore fixture ([eeadfec](https://github.com/SunReye/SunReye/commit/eeadfec886cc115003430314e11aabdc2a0c78da))
* **ci:** pass DATABASE_URL to dump.sh in the restore test ([bd3a308](https://github.com/SunReye/SunReye/commit/bd3a308221818c2d92e6e9f62ec22d58bd4c84c1)), closes [#127](https://github.com/SunReye/SunReye/issues/127)
* **ci:** retry the upgrade seed's aggregate refresh when a policy holds it ([60996a8](https://github.com/SunReye/SunReye/commit/60996a80d44a3ebee90c6fdb05eb4bdfe1ef456a))
* **ci:** retry the upgrade seed's aggregate refresh when a policy holds it ([2943d3d](https://github.com/SunReye/SunReye/commit/2943d3d0e41388ad57a935606fb3863ba0c8bb03))
* **ci:** run the cutover assertion from apps/server, where its deps are declared ([78d6beb](https://github.com/SunReye/SunReye/commit/78d6beb337b42073d821d158374d83b500b119ad))
* **ci:** stop re-arming a live minute policy, and count the journal by hash ([cdb0663](https://github.com/SunReye/SunReye/commit/cdb066310fc109d8a3ab0629a7b0f40bd50ec7fe))
* **ci:** stop retention deleting the restore fixture mid-test ([aba10ab](https://github.com/SunReye/SunReye/commit/aba10abad32d0e62db1058a5cbf644007d33f4da)), closes [#127](https://github.com/SunReye/SunReye/issues/127)
* **ci:** upgrade from the newest release older than the one under test ([7996531](https://github.com/SunReye/SunReye/commit/799653116ce39d5a29d8e9d19bf7e1d7c921c09b))
* **ci:** upgrade from the newest release OLDER than the one under test ([9aacc9b](https://github.com/SunReye/SunReye/commit/9aacc9b11781ceef4b2f28e959f3b1d232a52590))
* **db-tests:** give the archive layer a database of its own ([b2f65b8](https://github.com/SunReye/SunReye/commit/b2f65b84840164ac61f6604b86044c591f731e25))
* **db-tests:** load the server env in the harness, not by import luck ([26ee8d3](https://github.com/SunReye/SunReye/commit/26ee8d3e9f4ad576b96ede01b5cd23f6190eab45))
* **db:** carry a device's retirement through export and import ([dc69c19](https://github.com/SunReye/SunReye/commit/dc69c19862701f04ccf57e5757ff09f7bc7c2a98))
* **db:** make the retention change reach an existing database, and prove it ([780c767](https://github.com/SunReye/SunReye/commit/780c7675f43cf8d8755aec62ece6f2907494b845))
* **db:** merge a refresh window shorter than one bucket into its predecessor ([4f4da0b](https://github.com/SunReye/SunReye/commit/4f4da0b84ffd535903e71283a481568414278bab))
* **db:** name config-log identities in the archive manifest ([338f86d](https://github.com/SunReye/SunReye/commit/338f86d5900a1c377a6b096cb1de09e6e50d4a25))
* **db:** refuse to stamp a baseline over a database that never got it ([940ebdd](https://github.com/SunReye/SunReye/commit/940ebdd4d8bd4e9f72252ed8f9da9b052615f801))
* **db:** replay every legacy source id, and align refresh windows to buckets ([fee93b7](https://github.com/SunReye/SunReye/commit/fee93b7dc7218f04c0d80e79584dae7612d41d7d))
* **devices:** unit id 0 is a valid address, and the picker is a select ([2997982](https://github.com/SunReye/SunReye/commit/29979823cf695c06195ea8a9c5fc632a53e5958f))
* **energy:** pin each role's kWh derivation, and a counter-restart hole ([#115](https://github.com/SunReye/SunReye/issues/115)) ([a8b5f55](https://github.com/SunReye/SunReye/commit/a8b5f55f19d0a2f3b3b7aa02efbcc90d5c84aaa4))
* green the suite, stop the weather tile printing NaN, and enforce TDD ([37d8e9b](https://github.com/SunReye/SunReye/commit/37d8e9b9531ef15e07bcba82bd968b358b5c590f))
* plant-local time-zone bucketing ([#46](https://github.com/SunReye/SunReye/issues/46), [#52](https://github.com/SunReye/SunReye/issues/52)) + solar-forecast average power ([#47](https://github.com/SunReye/SunReye/issues/47), [#49](https://github.com/SunReye/SunReye/issues/49)) + chart-axes type ([#51](https://github.com/SunReye/SunReye/issues/51)) ([36955a5](https://github.com/SunReye/SunReye/commit/36955a5b69809c93d699c45022709cd8e0f60e55))
* **scripts:** make the anonymous sweep actually ask the write surface's gates ([096cfa5](https://github.com/SunReye/SunReye/commit/096cfa5719e4b53c5027544511024bcb31f6940a))
* **scripts:** rehearse against the profile the target has installed ([93d8584](https://github.com/SunReye/SunReye/commit/93d85848bb16f863ac2e9862ea825ccc5a2ea71c))
* **server,web:** the live fold finds a member by the profile id the driver stamps ([6897f80](https://github.com/SunReye/SunReye/commit/6897f806f16d645a4d6e889fd4a0f485042170bf)), closes [#202](https://github.com/SunReye/SunReye/issues/202)
* **server:** a profile shared by two devices resolves to neither device ([f95a142](https://github.com/SunReye/SunReye/commit/f95a142cd5c09fd0ae17be3f3869025ad7abede2)), closes [#202](https://github.com/SunReye/SunReye/issues/202)
* **server:** align the energy day chart extent with the cost series ([9d15260](https://github.com/SunReye/SunReye/commit/9d15260a0f1a97359c7c0fd592707cc43f10c662))
* **server:** allow PATCH through CORS ([76d65d7](https://github.com/SunReye/SunReye/commit/76d65d74d15e174c2458af456cdbc2bebf375726))
* **server:** bucket plant-local periods by a configured time zone, not the host ([6edf217](https://github.com/SunReye/SunReye/commit/6edf217a684b1116f4a944a1dd6a94f6f3c38ee9))
* **server:** carry the held value into the live backfill window ([f504120](https://github.com/SunReye/SunReye/commit/f50412036b7e70a64111089937368f4bf90d5893)), closes [#118](https://github.com/SunReye/SunReye/issues/118)
* **server:** declare openapi-types, Elysia 2's last undeclared peer ([f1583e9](https://github.com/SunReye/SunReye/commit/f1583e940f6e05aa7be477a4f747f70d444242db))
* **server:** drop the plant facts cache on device writes ([589fe1b](https://github.com/SunReye/SunReye/commit/589fe1bcf852725eb5cd8281cd95253f79caed6e))
* **server:** gate the optimizer registrar's retry on a THROW too ([4efc874](https://github.com/SunReye/SunReye/commit/4efc874af7e17a9a40b62ea5e130aa59d61611df))
* **server:** include today's live registers in month- and year-to-date ([71561a7](https://github.com/SunReye/SunReye/commit/71561a7f2a838093d885dfa1fe0411751970cf5b))
* **server:** keep a device's storage policy across a reload that changes nothing ([b530750](https://github.com/SunReye/SunReye/commit/b5307509fa035de0356d64c36493a468ff14192d))
* **server:** key Home Assistant identity on the frozen slugs, not the profile ([0804685](https://github.com/SunReye/SunReye/commit/08046851e12fd51da18b295ffc0cb750cf209648))
* **server:** never bill a recording gap to the hour it ended ([32c28a8](https://github.com/SunReye/SunReye/commit/32c28a8afe2abd3b52086069c257467a99fbf38c))
* **server:** never drop a sample silently, and re-read a roster that failed ([1b0a7ee](https://github.com/SunReye/SunReye/commit/1b0a7ee4bf27956f5cd43237856f8ae7ef69040e))
* **server:** never let ambient git plumbing redirect our git calls ([db8225e](https://github.com/SunReye/SunReye/commit/db8225e9869552f6eda5a2cb565d835b757c50db))
* **server:** one market average, one definition of self-consumption ([2a6b8f9](https://github.com/SunReye/SunReye/commit/2a6b8f9fd83d4c22b71ac3723cd8846bafd565a3))
* **server:** poll from connections + devices, not from app_settings ([b54364c](https://github.com/SunReye/SunReye/commit/b54364c237c9eeb469488bf86047a20e6a636bc3))
* **server:** remember an EVCC registration attempt that threw ([feab8f2](https://github.com/SunReye/SunReye/commit/feab8f2ead251c6df5bb07a9d64db3244dbf3f70))
* **server:** restore HEAD on GET routes under Elysia 2 ([886ad63](https://github.com/SunReye/SunReye/commit/886ad6304b405b4bc57de06ff36d0230ed1579cd))
* **server:** round the request-log duration to two decimals ([d5a87c3](https://github.com/SunReye/SunReye/commit/d5a87c347e34320c1386359586a80882bc18cb0e))
* **server:** stop reading the legacy schema on an install that never had one ([baecc39](https://github.com/SunReye/SunReye/commit/baecc39883af0ca663d3e63c413a3e6ed288afca))
* **server:** stop reading the legacy schema on an install that never had one ([c349c2d](https://github.com/SunReye/SunReye/commit/c349c2d267be4963a1eada283c38fda6326b73eb))
* **server:** stop the EVCC registrar's permanent ensure+reload loop ([d01e185](https://github.com/SunReye/SunReye/commit/d01e185efb991e5ea94e42d011e7f1b911310952))
* **server:** the recent-history read no longer 500s on every dashboard load ([5da7c40](https://github.com/SunReye/SunReye/commit/5da7c4067c72ed236c9d1d5c24bff4edc4694af8))
* **server:** today's money follows the live day registers ([08dd482](https://github.com/SunReye/SunReye/commit/08dd4825121b7ad407c6147d3a70ffe800b3c9b8))
* **server:** validate every write in the funnel, and pre-flight presets ([15a3a77](https://github.com/SunReye/SunReye/commit/15a3a77063b59ed9c3a8129af802785b446cc38d))
* **server:** wire TypeBox statically so the compiled binary can validate ([34ef44a](https://github.com/SunReye/SunReye/commit/34ef44afb573aaf195122a47441a6f7579c87540))
* **settings:** log and quarantine a rejected setting instead of resetting it silently ([d83b471](https://github.com/SunReye/SunReye/commit/d83b471df51db8333e3c19493b59ff4a128618f8))
* **settings:** readSetting logs and quarantines instead of silently resetting ([cf213c1](https://github.com/SunReye/SunReye/commit/cf213c1084f577bf8736dba296c853b90bf7bc76))
* **statistics:** chart the whole calendar month, and only that month ([745fac5](https://github.com/SunReye/SunReye/commit/745fac5134fcb7f49dc05c2b81d5e9f66b920abe))
* stop the charge-current round-up eating exportable PV, and finish the card migration ([3cdadfe](https://github.com/SunReye/SunReye/commit/3cdadfec95bbaa412034355159c319ec6519bdf8))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))
* **test:** stop the suite depending on which file the runner reaches first ([487ea8c](https://github.com/SunReye/SunReye/commit/487ea8cb24f83417565dd2d3c72b9782fc091ae7))
* **test:** treat an empty DB_TEST_URL as unset so the layer skips ([17bcb46](https://github.com/SunReye/SunReye/commit/17bcb464f07f3843b931b3a61a5a4a864f4fdec7))
* **web:** full-screen the document, not the card ([3f1f1b4](https://github.com/SunReye/SunReye/commit/3f1f1b4c373076a52876e0714231b03cb778d09e))
* **web:** patch layerchart's unclamped stacked-bar height ([e3c691a](https://github.com/SunReye/SunReye/commit/e3c691a2a00d4746fb38edfb6d9883d4e85ed1b0))
* **web:** report slot-average power consistently in the solar-forecast dialog ([28ec5fe](https://github.com/SunReye/SunReye/commit/28ec5fe53489a9343cc96de75cdc5d6ddfeb9ace))
* **web:** a charge's glow stops being cut off at the safe box ([0d2c783](https://github.com/SunReye/SunReye/commit/0d2c783fa7050d2222e7f53b0aa382cb217bf7d6))
* **web:** a rail's charge keeps its place when its speed steps ([ee5bd13](https://github.com/SunReye/SunReye/commit/ee5bd131797e5505118126a36f734f073fcf8cf5))
* **web:** a rising plant stops writing storage at the feed's cadence ([952ee98](https://github.com/SunReye/SunReye/commit/952ee9897596e3a82af05c0a5047753372972686))
* **web:** accent stops being an alias of primary, which made selects unreadable ([b90af82](https://github.com/SunReye/SunReye/commit/b90af82dcbd10382faf0dbfb812052bd59f24f79))
* **web:** build inclusive day ranges from date parts, not +86_400_000 ([ed8a520](https://github.com/SunReye/SunReye/commit/ed8a5209b2ee0e5de6eb73c6726a8bc70673a6c7))
* **web:** cap the select dropdown height so long lists scroll ([1718f01](https://github.com/SunReye/SunReye/commit/1718f01aed7248473d0fe50a3916bdfd5fba85c1))
* **web:** carry the pack voltage forward instead of explaining where it went ([0235af8](https://github.com/SunReye/SunReye/commit/0235af8b8b4c390c60ff50600bed385d9451da96))
* **web:** close the gaps an adversarial review found in the palette work ([c8cc39b](https://github.com/SunReye/SunReye/commit/c8cc39ba8618893c412c71174cf382583c0c6607))
* **web:** drop empty segments from the cost bar stack ([028eaf7](https://github.com/SunReye/SunReye/commit/028eaf776c289c52b747d7deee7685805822ae66))
* **web:** format statistics dates and figures in the UI locale ([3900cb7](https://github.com/SunReye/SunReye/commit/3900cb75b714f8ce9b4821c3b9499734179604d6))
* **web:** give the live sparkline's measuring box a height ([65582be](https://github.com/SunReye/SunReye/commit/65582bed3d39a8e85f1fbba8bc300cab9176c2b9))
* **web:** hit-test the heatmap per cell and wash the hovered one ([48ed60a](https://github.com/SunReye/SunReye/commit/48ed60abc6060c1462d12048d4c1f4850b73f47c))
* **web:** keep the heatmap panel when a metric has nothing to show ([40d3e6c](https://github.com/SunReye/SunReye/commit/40d3e6cb6c40883ea4cc5db26d42f3ab7170252f))
* **web:** label energy periods with the bucket they were fetched at ([20c30df](https://github.com/SunReye/SunReye/commit/20c30df53db39541eea952000bb133b90af89196))
* **web:** let an expanded chart escape a transformed ancestor ([4b1c066](https://github.com/SunReye/SunReye/commit/4b1c066492126a0efab2ce5a814d36873b7e653c))
* **web:** let Escape close the layer on top, not the card under it ([f88a48d](https://github.com/SunReye/SunReye/commit/f88a48d2e3ccaa01283580a4c7a61046b070b3a5))
* **web:** make the negative price windows visible and consistent ([3313220](https://github.com/SunReye/SunReye/commit/3313220c6b40a9dd4fee1f47ccb524395c6aef61))
* **web:** narrow the last seven chart gutters on a phone ([5d2d2fa](https://github.com/SunReye/SunReye/commit/5d2d2fa026a5544b92c1f2ffb8f89966304feb5f))
* **web:** never render a tile against an empty response body ([6c40a8b](https://github.com/SunReye/SunReye/commit/6c40a8bb6302c2f911de9d895ff52a8a977ba4ba))
* **web:** one place for a panel's controls, and one width for the navigator ([c6e1a4c](https://github.com/SunReye/SunReye/commit/c6e1a4cfa355a1343bb42ddccce6e6ecf2d2954f))
* **web:** paint fixed meanings from the semantic set, not the palette ([8061145](https://github.com/SunReye/SunReye/commit/8061145f70b59731e245cc3be8811e9c61c6a349))
* **web:** pluralize price copy and cap runaway deltas ([42c978d](https://github.com/SunReye/SunReye/commit/42c978dd44c85950a3d9786c821c5ad5482c48e6))
* **web:** read the buffers untracked when sizing the backfill ([419c1a2](https://github.com/SunReye/SunReye/commit/419c1a27d024d9a85f851f249b62ee46a669484a))
* **web:** render canvas chart marks and labels correctly ([1057920](https://github.com/SunReye/SunReye/commit/1057920793624326db33d2bf934abda07af585c2))
* **web:** stat tiles stop drawing a second box on a phone ([2e22f51](https://github.com/SunReye/SunReye/commit/2e22f514b28bdd529dec347b62651d67bf33137b))
* **web:** statistics layout at narrow widths and in sparse windows ([5121ce6](https://github.com/SunReye/SunReye/commit/5121ce67aa1a1f15bcdf4dbacd98201d44e1bc72))
* **web:** stop the automations card overflowing a phone ([1237d38](https://github.com/SunReye/SunReye/commit/1237d385eeeb4628942358adc5d5b74ddd2caefb))
* **web:** stop the calendar's today marker reading as a selected day ([22d9aa1](https://github.com/SunReye/SunReye/commit/22d9aa107b4c60007498fac99b2dd2948dd57fcf))
* **web:** stop the forecast dialog reporting unmeasured slots as zero production ([5e05163](https://github.com/SunReye/SunReye/commit/5e051634e59865f631ccfd47bf103d439c90bb42))
* **web:** stub the battery-health read in the browser layer ([dcdf2d0](https://github.com/SunReye/SunReye/commit/dcdf2d0568bf69cf3710977abb2882cf8714a0e3))
* **web:** the ceiling stops invalidating the effect that folds it ([a930f00](https://github.com/SunReye/SunReye/commit/a930f00e130ce9506e97b83432e92da3cf0c2bd4))
* **web:** the desktop toolbar is one line of controls, one height ([4dd2ed1](https://github.com/SunReye/SunReye/commit/4dd2ed107a670d452ca8d8f13bb43b279eb819e0))
* **web:** the device probes show the captured snapshot again ([802ad7f](https://github.com/SunReye/SunReye/commit/802ad7f8be22075d4b7f7675acd6fb13622e4268))
* **web:** tolerate a manifest with no storage, and teach the e2e fixture the field ([a388f9e](https://github.com/SunReye/SunReye/commit/a388f9ebbac42177870413038449c30cf7970dbe)), closes [#125](https://github.com/SunReye/SunReye/issues/125)
* **web:** type the chart-axes gap fixture so svelte-check passes ([a9e1d3b](https://github.com/SunReye/SunReye/commit/a9e1d3b8db15c396ec1c1f376b7646d0982faa64))
* **web:** type the node-trigger helper for a pattern, not just a string ([9a83369](https://github.com/SunReye/SunReye/commit/9a83369697efe812bc719236067f6097d7e80d13))


### Performance Improvements

* **addon:** size PostgreSQL memory for a small box ([4435796](https://github.com/SunReye/SunReye/commit/443579645fc7dccaa9576805913a1e97f37c3fe1))
* **db:** compress after 2h, checkpoint every 2h, compress WAL with zstd ([42bac87](https://github.com/SunReye/SunReye/commit/42bac87c62ab92f3f9085d367e687e766dfc4b84))
* **e2e:** fully parallel + 4-way sharded browser suite, measurement layer removed ([0b22586](https://github.com/SunReye/SunReye/commit/0b225861700785daa92ed7c0f91ab6b8185e8951))
* **e2e:** run the browser suite fully parallel and sharded, and drop the measurement layer ([44d1e65](https://github.com/SunReye/SunReye/commit/44d1e659cf4fba46a27b5fc789ed688b5a5cd49d))
* **server,web:** bucket the sparkline backfill and resume from the gap ([d9a66b8](https://github.com/SunReye/SunReye/commit/d9a66b826c450ec6d60d66145f9e487d1778917b))
* **test:** run the suite with --parallel, and say why coverage must not ([6a5f738](https://github.com/SunReye/SunReye/commit/6a5f73838722d0bb0cee705c0458e374d0bcc749))
* **web:** make /history cheap to scroll, and give the repo a browser test layer ([c8b4281](https://github.com/SunReye/SunReye/commit/c8b4281711decf0e1e30c612f5c0c1787bd411ea))
* **web:** make /history cheap when it is doing nothing ([6f08e7a](https://github.com/SunReye/SunReye/commit/6f08e7a00eeb8a8b9d076c794f867dc22906d00e))
* **web:** build a chart when the reader stops, not when they scroll past ([c077445](https://github.com/SunReye/SunReye/commit/c0774452f2e89c5aebff5eaa1113b616da79ae7a))
* **web:** build each chart once, at a width it can actually use ([db697a8](https://github.com/SunReye/SunReye/commit/db697a84bb03e0f55dae223edbf71b16e5d60988))
* **web:** stop the live charts repainting on every frame ([82399f5](https://github.com/SunReye/SunReye/commit/82399f5777f8174f11be68804f00d801772d6503))


### Documentation

* **release:** 2.0.0 release notes, upgrade guide, and schema doc corrections ([e79e8ea](https://github.com/SunReye/SunReye/commit/e79e8ea9940861773102b1348b90f1fbe4b57a50))


### Dependencies

* The following workspace dependencies were updated

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
