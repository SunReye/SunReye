# Changelog

## [2.0.0](https://github.com/SunReye/SunReye/compare/server-v1.2.0...server-v2.0.0) (2026-08-30)


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

* **auth:** add "keep me signed in" option on login ([d75bbb3](https://github.com/SunReye/SunReye/commit/d75bbb3c5e6446c073c00389a3e5b64afe0ca256))
* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **automations:** borrow the car as a sink for negative-price windows ([98e8b47](https://github.com/SunReye/SunReye/commit/98e8b474b5013e9dd868b2b412a30dd8cd665d51))
* **automations:** charge from the grid during negative-price windows ([43b66c7](https://github.com/SunReye/SunReye/commit/43b66c7ab9f532235072bd5428eb1576ad570c85))
* **automations:** hold the battery low ahead of negative-price windows ([74f5693](https://github.com/SunReye/SunReye/commit/74f56934948f39f6010475f4063e7734140d5fd1))
* **automations:** plan projection, decision history, and charting UI for peak shaving ([162d882](https://github.com/SunReye/SunReye/commit/162d882209a07a6997a501136c99042c7b031690))
* **automations:** read live-capable status readings from the 1 Hz feeds ([261da4c](https://github.com/SunReye/SunReye/commit/261da4c1213f9d59a15d4d705a5d813a1d6d60a7))
* **automations:** use EVCC battery boost to empty the pack ([76bf1ed](https://github.com/SunReye/SunReye/commit/76bf1ede652d50368cad513efae32b9999c2e427))
* **charts:** let a saved chart name the device each series is read from ([50f6881](https://github.com/SunReye/SunReye/commit/50f6881e0ed9cbe4755823f5a088b1199bd02d71))
* **cost:** report the export that earned nothing under §51 ([f381172](https://github.com/SunReye/SunReye/commit/f381172db0834812ebcd31ec19a3d3ef928f53bf))
* **db:** a weight column on the hot path ([e464e3f](https://github.com/SunReye/SunReye/commit/e464e3fa7f5df41a21b865a06bc3f125e8d94605))
* **db:** add forecast-correction tables + config toggle ([6ed9d95](https://github.com/SunReye/SunReye/commit/6ed9d95cfdb71037267002853157abb377a10dfd))
* **db:** add statistics preferences schema ([57d1e52](https://github.com/SunReye/SunReye/commit/57d1e5272c520238821eea1e63b253a6e6d88239))
* **db:** admit the virtual 'optimizer' role before the 2.0.0 baseline ships ([37dcc1a](https://github.com/SunReye/SunReye/commit/37dcc1ad737ac64b047ce671b971ef83b2c77d41))
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
* **db:** the in-place 1.2.0 -> 2.0.0 upgrade ([dcbdb46](https://github.com/SunReye/SunReye/commit/dcbdb46ed9a6acd2c77cfaab96519e85ba8f9009))
* **db:** time-weighted rollups, and the compression every tier was missing ([8d61780](https://github.com/SunReye/SunReye/commit/8d6178018345b94fd60b2a859323897fb50b75de))
* **db:** type the TimescaleDB surface — hyperfunction wrappers, declared aggregates, parity ([4c805fc](https://github.com/SunReye/SunReye/commit/4c805fc87aaa4b6ae1675218a042a7f57787d156))
* **evcc:** estimate live charge power between EVCC publishes ([d810bb7](https://github.com/SunReye/SunReye/commit/d810bb7cff76d6f92aa53f26fc595b394a2a6e6b))
* **forecast:** 15-minute solar forecast with peak-power tooltip ([fcb50aa](https://github.com/SunReye/SunReye/commit/fcb50aad899c1f2b8b362cc9217a173df55bece6))
* **forecast:** export raw + usable production forecast over MQTT and API ([574a0c5](https://github.com/SunReye/SunReye/commit/574a0c51d1f26c57e20f209770c97b43f572d68d))
* **forecast:** give each PV array its own physics ([80e7a87](https://github.com/SunReye/SunReye/commit/80e7a87c8e271c818199eaaa9685f602ae984afd))
* **forecast:** incidence-angle and wind-aware cell-temperature physics ([d0ed115](https://github.com/SunReye/SunReye/commit/d0ed115f949ff68e27cee142a4c8ed93cb30e378))
* **forecast:** model feed-in clipping + battery in solar forecast ([88974b2](https://github.com/SunReye/SunReye/commit/88974b229ca54846d4a1640ad374d6ed7c2fa508))
* **inverter-core:** sample computed-metric inputs in one atomic read ([fea7f48](https://github.com/SunReye/SunReye/commit/fea7f48eacd16930e488386afc20b268f058e7ab))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* **prices:** add day-ahead spot prices with the energy-charts provider ([48b81ce](https://github.com/SunReye/SunReye/commit/48b81ce27126617514742e644fa2c0e9c0c5a310))
* **prices:** add the awattar provider ([158daa0](https://github.com/SunReye/SunReye/commit/158daa0692c5b7b748b6bd9fdcd6488314fbfdf6))
* **scripts:** build a reproducible addon-1.2.0 fixture from git ([b65f4d8](https://github.com/SunReye/SunReye/commit/b65f4d890b045e02ac3fd3cb2125f6d2d6fd2256))
* **scripts:** make the parity snapshot takeable against a 1.2.0 database ([588c394](https://github.com/SunReye/SunReye/commit/588c3943eb2186684f5c715236ca8eee294a6524))
* **scripts:** the storage-wear harness, so the projections become gates ([a89bd08](https://github.com/SunReye/SunReye/commit/a89bd08f07db19aa4210b2e5b1126558775c5b69))
* **server:** a device registry keyed by the devices table ([253ca49](https://github.com/SunReye/SunReye/commit/253ca4962b375421f08cb78cbcd05ad817461f12))
* **server:** answer minute buckets from raw ([e7604e7](https://github.com/SunReye/SunReye/commit/e7604e7589587600aaeeea775b5ab84de8583ba7))
* **server:** apply §51 zero-value export to the cost series ([067ad2e](https://github.com/SunReye/SunReye/commit/067ad2e1dc10a1a2f9cc161d324ee9bca034fc20))
* **server:** change-encode the stored series, with the duration each value held ([70cc884](https://github.com/SunReye/SunReye/commit/70cc884aaf73e77f77fe324fa39c775c24099927))
* **server:** clip past forecast slots from measured day-start SOC ([d75daf0](https://github.com/SunReye/SunReye/commit/d75daf0810e8faccc90be950d68834b28add57e1))
* **server:** compress responses with @elysia/compress ([2a9f59f](https://github.com/SunReye/SunReye/commit/2a9f59f0b9fd13bd35360f9102565113c3fa473e))
* **server:** count and export the history buffer's dropped rows ([290c619](https://github.com/SunReye/SunReye/commit/290c61982fef9f7167b2a2deadf083fe29b54152))
* **server:** dedicated plant time zone for server-side bucketing ([55885f1](https://github.com/SunReye/SunReye/commit/55885f12da13941a67e9bf5a47d7e28e5528585b))
* **server:** expose the write seam on the runtime, and wire retire -> forget ([15e9f5f](https://github.com/SunReye/SunReye/commit/15e9f5f3e597bf42459b788efa40831cbbf4637b))
* **server:** finish the irradiance provider seam ([063086f](https://github.com/SunReye/SunReye/commit/063086fa94c53c62c67b3643941032599d6716e9))
* **server:** imply house consumption when nothing meters it ([7404790](https://github.com/SunReye/SunReye/commit/7404790920519232f9e1f5ba89a221ad52d3082d))
* **server:** learn + apply PV-forecast bias correction ([fc4260e](https://github.com/SunReye/SunReye/commit/fc4260e34cb321cc1222c502bcaf4a2923ff80d2))
* **server:** live statistics stream over websocket ([94f0d0c](https://github.com/SunReye/SunReye/commit/94f0d0c8274e6379edcfd740b80de5ba60dc2160))
* **server:** measure battery capacity and state of health ([4ac71f9](https://github.com/SunReye/SunReye/commit/4ac71f9db8b4f0cf1fac75815ebc78340211487e))
* **server:** multiplexed /ws with per-topic authorization ([f42d09a](https://github.com/SunReye/SunReye/commit/f42d09a77f483b2472520160e42337723510ce05))
* **server:** name the MQTT bridge by the plant and device slugs ([4891a92](https://github.com/SunReye/SunReye/commit/4891a921cc527ccbe1abe2bb616bd402f5c7fa83))
* **server:** period comparison and all-time records endpoints ([8cb7abf](https://github.com/SunReye/SunReye/commit/8cb7abf38545ad4f9dc956a49273f2a8eac9fc61))
* **server:** promote EVCC's charge-power provenance into the sample model ([8cd6e9e](https://github.com/SunReye/SunReye/commit/8cd6e9ef18946f6e88fad195bdc73cccab2ae0c1))
* **server:** prove every route's gate, and close the last public one ([3a353a3](https://github.com/SunReye/SunReye/commit/3a353a35ffd458655cc88ed2c0e67f1a88377db4))
* **server:** re-key automation state by device, once, on read ([ace639a](https://github.com/SunReye/SunReye/commit/ace639afa5736c20405d728be4c6fe64b86120ea))
* **server:** register EVCC loadpoints as devices, with history ([1d2646a](https://github.com/SunReye/SunReye/commit/1d2646afa6565ae4764c89d019356c7eb4809000))
* **server:** restore request correlation lost with @logtape/elysia ([a8bafe9](https://github.com/SunReye/SunReye/commit/a8bafe9c1e6709efbdfba7474a98fa4ce2d85470))
* **server:** retire the profile-keyed HA announcements, once ([95376d8](https://github.com/SunReye/SunReye/commit/95376d8fd4c80e9c072a93fde3aa15973e0d3ccd))
* **server:** route config registers and absent hardware out of metrics_raw ([33760c6](https://github.com/SunReye/SunReye/commit/33760c64d2b29f99f5a92e2d1de3e9ed1c4a79a5))
* **server:** runtime-configurable and per-category log levels ([e621b2c](https://github.com/SunReye/SunReye/commit/e621b2c522e1069fb7e49ffda107aa34454bcf5f))
* **server:** serve each rollup bucket from one source, preferring the weighted one ([c4b9631](https://github.com/SunReye/SunReye/commit/c4b9631b1c8981fd851ae81d9eedfb3a070cece4))
* **server:** serve the dashboard from the compiled binary ([b52de5e](https://github.com/SunReye/SunReye/commit/b52de5ec5c578165df9781a901bc071d8f950a80))
* **server:** serve the manifest from the device, not the profile object ([4567a8c](https://github.com/SunReye/SunReye/commit/4567a8c4b85b87cdc5fa2efdd358ebe086e8a084))
* **server:** spot price analytics endpoint ([1bf1b38](https://github.com/SunReye/SunReye/commit/1bf1b3849472e60a802a1f549c8c6c777ac0636f))
* **server:** statistics preferences endpoints ([27156ca](https://github.com/SunReye/SunReye/commit/27156ca4bdb4b6bf4ebb15d8c5ec5f3a47474eb5))
* **server:** statistics route module with hour-weekday heatmap ([e947e0b](https://github.com/SunReye/SunReye/commit/e947e0baf44a30830080d4648e5066a5940f9869))
* **server:** the migration onboarding routes, with the slug frozen at announcement ([5633f5d](https://github.com/SunReye/SunReye/commit/5633f5d958ee739581c4039d62ea461a05c45ecc))
* **server:** the multi-device write seam, keyed by the device instance ([1a3a1f6](https://github.com/SunReye/SunReye/commit/1a3a1f6d79f4913b4260035a8963bd823576d5d6))
* **server:** the optimizer is a device, and its decisions are history ([928bc28](https://github.com/SunReye/SunReye/commit/928bc2838f19fb4c2ac55c1a78f6e942352dbf3d))
* **server:** track battery charged energy in rollup reads ([9902ea2](https://github.com/SunReye/SunReye/commit/9902ea2731cb08f9e41ad546f80688f9f17a04ce))
* **server:** upgrade to Elysia 2 ([d280e20](https://github.com/SunReye/SunReye/commit/d280e20b7f2edef453afeb5175457db69f97fb86))
* **tariff:** price energy against the market with a marketing model ([2075caa](https://github.com/SunReye/SunReye/commit/2075caafbaa00c3b398bec1db2729369a11fd9db))
* **tooling:** extend the TDD gate to Rust before any .rs exists ([d43aa42](https://github.com/SunReye/SunReye/commit/d43aa42c8e3c152cd4f3b7799f606f17b0cebf50))
* **web:** capacity and health tiles for the measured battery ([10abc21](https://github.com/SunReye/SunReye/commit/10abc21bd31e1be194ee3dcf88876c849d1a2a15))
* **web:** categorical chart palette, and a colour per series ([884c4b6](https://github.com/SunReye/SunReye/commit/884c4b66858150770cba9ef76abb691d3af53d56))
* **web:** compare replaces add-to-chart in the card header ([55490a2](https://github.com/SunReye/SunReye/commit/55490a21fcc36d55dd11cbc83d73144224a7f98f))
* **web:** configure and observe price-aware charging ([6eb41c1](https://github.com/SunReye/SunReye/commit/6eb41c1322b73e512838ad4e2465cb1f19001711))
* **web:** draft a chart on a full-screened metric card ([a718f90](https://github.com/SunReye/SunReye/commit/a718f90a7f01744af3548a4ff342c759b7952c9f))
* **web:** the battery's nominal voltage moves to the plant settings ([6714eca](https://github.com/SunReye/SunReye/commit/6714ecabe1717daf203c2bb949798f425c33e52f))
* add peak-shaving automation engine ([f0bda94](https://github.com/SunReye/SunReye/commit/f0bda944036958b20b244432298badbaf42b67c0))
* chart zoom, an honest peak-shaving reserve, and the layout docs ([6fa4f3b](https://github.com/SunReye/SunReye/commit/6fa4f3be1783e606b2d86160750dcfe5a8312d54))
* choose the chart palette in settings ([95a5dcc](https://github.com/SunReye/SunReye/commit/95a5dcc21bb9d7ea528b85a4ae4b65f13ada33a7))
* stream server logs to an admin Settings panel ([faeaf08](https://github.com/SunReye/SunReye/commit/faeaf0807b2a7b33fa9fca5c6706b892781f3320))


### Bug Fixes

* **addon:** derive the backup's raw-data exclusion from the live retention policy ([c6e68aa](https://github.com/SunReye/SunReye/commit/c6e68aac4a2364b9461e6389525ceac92771db4f))
* **addon:** exclude compressed chunk data from a non-full dump ([2ec3ec3](https://github.com/SunReye/SunReye/commit/2ec3ec3871ce88981c5977ae73dd2456bec5a2f9))
* **addon:** keep raw in the default backup once the minute tier is frozen ([3d159df](https://github.com/SunReye/SunReye/commit/3d159dfd0e3b1c8d88716f90f857502dc8dac944))
* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **addon:** serve the multiplexed live socket at exactly /ws ([ab06deb](https://github.com/SunReye/SunReye/commit/ab06deb285fb5bda0d08b8e84016d32cd41d07be))
* **auth:** trust a request's own origin only when it is same-origin ([ed89a0f](https://github.com/SunReye/SunReye/commit/ed89a0f866c4a65562043412052590a714142860))
* **automation:** steer on the pack voltage the battery row states ([71e4b5c](https://github.com/SunReye/SunReye/commit/71e4b5c241eb7e9591079b8262b802e3c9794bfd))
* **automation:** the live limit readback resolves voltage like the target does ([5470d42](https://github.com/SunReye/SunReye/commit/5470d42f9d3fb81a1981d42858b4e3241cc0e573))
* **automations:** derive EV demand when EVCC reports none ([619c4f3](https://github.com/SunReye/SunReye/commit/619c4f301845da5a33325079522f324674a97f4e))
* **ci:** assert the 2.0.0 upgrade contract, not 1.x's ([46af680](https://github.com/SunReye/SunReye/commit/46af6800f092c4f9dc6ad499af1038c4633eae35))
* **ci:** create timescaledb before restoring, and publish 5432 for the shaping step ([febca3d](https://github.com/SunReye/SunReye/commit/febca3d03515b2fa9c1df7faadee7217915e883c))
* **ci:** fetch tags for the database jobs, and clear the code-health gate ([8912ae7](https://github.com/SunReye/SunReye/commit/8912ae71b7ea9d91331f7c42675d1ed5897d48bf))
* **ci:** import the db by path in the weighted-rollups gate ([56dfe1f](https://github.com/SunReye/SunReye/commit/56dfe1fbf57a78d9ac37db62ef26717725ab0097))
* **ci:** materialize the weighted tiers in the restore fixture ([eeadfec](https://github.com/SunReye/SunReye/commit/eeadfec886cc115003430314e11aabdc2a0c78da))
* **ci:** pass DATABASE_URL to dump.sh in the restore test ([bd3a308](https://github.com/SunReye/SunReye/commit/bd3a308221818c2d92e6e9f62ec22d58bd4c84c1))
* **ci:** run the cutover assertion from apps/server, where its deps are declared ([78d6beb](https://github.com/SunReye/SunReye/commit/78d6beb337b42073d821d158374d83b500b119ad))
* **ci:** stop re-arming a live minute policy, and count the journal by hash ([cdb0663](https://github.com/SunReye/SunReye/commit/cdb066310fc109d8a3ab0629a7b0f40bd50ec7fe))
* **ci:** stop retention deleting the restore fixture mid-test ([aba10ab](https://github.com/SunReye/SunReye/commit/aba10abad32d0e62db1058a5cbf644007d33f4da))
* **db-tests:** give the archive layer a database of its own ([b2f65b8](https://github.com/SunReye/SunReye/commit/b2f65b84840164ac61f6604b86044c591f731e25))
* **db-tests:** load the server env in the harness, not by import luck ([26ee8d3](https://github.com/SunReye/SunReye/commit/26ee8d3e9f4ad576b96ede01b5cd23f6190eab45))
* **db:** carry a device's retirement through export and import ([dc69c19](https://github.com/SunReye/SunReye/commit/dc69c19862701f04ccf57e5757ff09f7bc7c2a98))
* **db:** make the retention change reach an existing database, and prove it ([780c767](https://github.com/SunReye/SunReye/commit/780c7675f43cf8d8755aec62ece6f2907494b845))
* **db:** merge a refresh window shorter than one bucket into its predecessor ([4f4da0b](https://github.com/SunReye/SunReye/commit/4f4da0b84ffd535903e71283a481568414278bab))
* **db:** name config-log identities in the archive manifest ([338f86d](https://github.com/SunReye/SunReye/commit/338f86d5900a1c377a6b096cb1de09e6e50d4a25))
* **db:** refuse to stamp a baseline over a database that never got it ([940ebdd](https://github.com/SunReye/SunReye/commit/940ebdd4d8bd4e9f72252ed8f9da9b052615f801))
* **db:** replay every legacy source id, and align refresh windows to buckets ([fee93b7](https://github.com/SunReye/SunReye/commit/fee93b7dc7218f04c0d80e79584dae7612d41d7d))
* **energy:** pin each role's kWh derivation, and a counter-restart hole (#115) ([a8b5f55](https://github.com/SunReye/SunReye/commit/a8b5f55f19d0a2f3b3b7aa02efbcc90d5c84aaa4))
* **evcc:** read the charge limit from the effective/vehicle topics ([dbfb00d](https://github.com/SunReye/SunReye/commit/dbfb00d4d6c6fbc2fa0debff9c383b0478456b83))
* **forecast:** integrate instantaneous irradiance per clock hour ([3e772de](https://github.com/SunReye/SunReye/commit/3e772de9f864d4aa9952af505acd4dccb62d0020))
* **scripts:** make the anonymous sweep actually ask the write surface's gates ([096cfa5](https://github.com/SunReye/SunReye/commit/096cfa5719e4b53c5027544511024bcb31f6940a))
* **scripts:** rehearse against the profile the target has installed ([93d8584](https://github.com/SunReye/SunReye/commit/93d85848bb16f863ac2e9862ea825ccc5a2ea71c))
* **server:** align the energy day chart extent with the cost series ([9d15260](https://github.com/SunReye/SunReye/commit/9d15260a0f1a97359c7c0fd592707cc43f10c662))
* **server:** bucket plant-local periods by a configured time zone, not the host ([6edf217](https://github.com/SunReye/SunReye/commit/6edf217a684b1116f4a944a1dd6a94f6f3c38ee9))
* **server:** carry the held value into the live backfill window ([f504120](https://github.com/SunReye/SunReye/commit/f50412036b7e70a64111089937368f4bf90d5893))
* **server:** declare openapi-types, Elysia 2's last undeclared peer ([f1583e9](https://github.com/SunReye/SunReye/commit/f1583e940f6e05aa7be477a4f747f70d444242db))
* **server:** gate the optimizer registrar's retry on a THROW too ([4efc874](https://github.com/SunReye/SunReye/commit/4efc874af7e17a9a40b62ea5e130aa59d61611df))
* **server:** harden forecast-correction learning ([58d33d8](https://github.com/SunReye/SunReye/commit/58d33d8ccfff9b0442317f189b641d2f4bd8ce55))
* **server:** include today's live registers in month- and year-to-date ([71561a7](https://github.com/SunReye/SunReye/commit/71561a7f2a838093d885dfa1fe0411751970cf5b))
* **server:** keep a device's storage policy across a reload that changes nothing ([b530750](https://github.com/SunReye/SunReye/commit/b5307509fa035de0356d64c36493a468ff14192d))
* **server:** keep the effectiveness watchdog quiet on a near-full pack ([f80fba0](https://github.com/SunReye/SunReye/commit/f80fba072b372a1cf7716ef64c3432dd87293059))
* **server:** key Home Assistant identity on the frozen slugs, not the profile ([0804685](https://github.com/SunReye/SunReye/commit/08046851e12fd51da18b295ffc0cb750cf209648))
* **server:** never bill a recording gap to the hour it ended ([32c28a8](https://github.com/SunReye/SunReye/commit/32c28a8afe2abd3b52086069c257467a99fbf38c))
* **server:** never drop a sample silently, and re-read a roster that failed ([1b0a7ee](https://github.com/SunReye/SunReye/commit/1b0a7ee4bf27956f5cd43237856f8ae7ef69040e))
* **server:** never let ambient git plumbing redirect our git calls ([db8225e](https://github.com/SunReye/SunReye/commit/db8225e9869552f6eda5a2cb565d835b757c50db))
* **server:** one market average, one definition of self-consumption ([2a6b8f9](https://github.com/SunReye/SunReye/commit/2a6b8f9fd83d4c22b71ac3723cd8846bafd565a3))
* **server:** poll from connections + devices, not from app_settings ([b54364c](https://github.com/SunReye/SunReye/commit/b54364c237c9eeb469488bf86047a20e6a636bc3))
* **server:** remember an EVCC registration attempt that threw ([feab8f2](https://github.com/SunReye/SunReye/commit/feab8f2ead251c6df5bb07a9d64db3244dbf3f70))
* **server:** restore HEAD on GET routes under Elysia 2 ([886ad63](https://github.com/SunReye/SunReye/commit/886ad6304b405b4bc57de06ff36d0230ed1579cd))
* **server:** round the request-log duration to two decimals ([d5a87c3](https://github.com/SunReye/SunReye/commit/d5a87c347e34320c1386359586a80882bc18cb0e))
* **server:** stop the EVCC registrar's permanent ensure+reload loop ([d01e185](https://github.com/SunReye/SunReye/commit/d01e185efb991e5ea94e42d011e7f1b911310952))
* **server:** the recent-history read no longer 500s on every dashboard load ([5da7c40](https://github.com/SunReye/SunReye/commit/5da7c4067c72ed236c9d1d5c24bff4edc4694af8))
* **server:** validate every write in the funnel, and pre-flight presets ([15a3a77](https://github.com/SunReye/SunReye/commit/15a3a77063b59ed9c3a8129af802785b446cc38d))
* **server:** wire TypeBox statically so the compiled binary can validate ([34ef44a](https://github.com/SunReye/SunReye/commit/34ef44afb573aaf195122a47441a6f7579c87540))
* **settings:** log and quarantine a rejected setting instead of resetting it silently ([d83b471](https://github.com/SunReye/SunReye/commit/d83b471df51db8333e3c19493b59ff4a128618f8))
* **statistics:** chart the whole calendar month, and only that month ([745fac5](https://github.com/SunReye/SunReye/commit/745fac5134fcb7f49dc05c2b81d5e9f66b920abe))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))
* **test:** stop the suite depending on which file the runner reaches first ([487ea8c](https://github.com/SunReye/SunReye/commit/487ea8cb24f83417565dd2d3c72b9782fc091ae7))
* **test:** treat an empty DB_TEST_URL as unset so the layer skips ([17bcb46](https://github.com/SunReye/SunReye/commit/17bcb464f07f3843b931b3a61a5a4a864f4fdec7))
* **web:** full-screen the document, not the card ([3f1f1b4](https://github.com/SunReye/SunReye/commit/3f1f1b4c373076a52876e0714231b03cb778d09e))
* **web:** patch layerchart's unclamped stacked-bar height ([e3c691a](https://github.com/SunReye/SunReye/commit/e3c691a2a00d4746fb38edfb6d9883d4e85ed1b0))
* **web:** report slot-average power consistently in the solar-forecast dialog ([28ec5fe](https://github.com/SunReye/SunReye/commit/28ec5fe53489a9343cc96de75cdc5d6ddfeb9ace))
* restore ControlLock and make bun test load the env-gated suites ([3ab4c86](https://github.com/SunReye/SunReye/commit/3ab4c8600c6f10ccfafae1f77ef8892dfb0d145f))
* stop the charge-current round-up eating exportable PV, and finish the card migration ([3cdadfe](https://github.com/SunReye/SunReye/commit/3cdadfec95bbaa412034355159c319ec6519bdf8))


### Performance Improvements

* **addon:** size PostgreSQL memory for a small box ([4435796](https://github.com/SunReye/SunReye/commit/443579645fc7dccaa9576805913a1e97f37c3fe1))
* **db:** compress after 2h, checkpoint every 2h, compress WAL with zstd ([42bac87](https://github.com/SunReye/SunReye/commit/42bac87c62ab92f3f9085d367e687e766dfc4b84))
* **e2e:** run the browser suite fully parallel and sharded, and drop the measurement layer ([44d1e65](https://github.com/SunReye/SunReye/commit/44d1e659cf4fba46a27b5fc789ed688b5a5cd49d))
* **server,web:** bucket the sparkline backfill and resume from the gap ([d9a66b8](https://github.com/SunReye/SunReye/commit/d9a66b826c450ec6d60d66145f9e487d1778917b))
* **test:** run the suite with --parallel, and say why coverage must not ([6a5f738](https://github.com/SunReye/SunReye/commit/6a5f73838722d0bb0cee705c0458e374d0bcc749))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @SunReye/inverter-core bumped to 1.1.0

## [1.2.0](https://github.com/SunReye/SunReye/compare/server-v1.1.1...server-v1.2.0) (2026-07-19)


### Features

* **db:** add evcc integration config schema ([5848e77](https://github.com/SunReye/SunReye/commit/5848e774df7857a37149fbd4c7747ed691afd6b8))
* **evcc:** optional residual-home split (Home = load − EV) ([0e0327f](https://github.com/SunReye/SunReye/commit/0e0327f3c6404afd026d38e3fd70f33ec9ec6702))
* **evcc:** stream loadpoint state to the dashboard over WebSocket ([67aad79](https://github.com/SunReye/SunReye/commit/67aad79a30002269fa21d22f4acbcf28cca009d8))
* **server:** evcc mqtt ingest, control relay, and routes ([98413b7](https://github.com/SunReye/SunReye/commit/98413b7a0394c6d8ef905334b0852d402167ff4a))


### Bug Fixes

* **server:** keep solar forecast remaining-today fresh under cache ([23d07f9](https://github.com/SunReye/SunReye/commit/23d07f997792d0e8e027f2e93c839021b27e097c))

## [1.1.1](https://github.com/SunReye/SunReye/compare/server-v1.1.0...server-v1.1.1) (2026-07-18)


### Miscellaneous Chores

* **server:** Synchronize sunreye-stack versions

## [1.1.0](https://github.com/SunReye/SunReye/compare/server-v1.0.1...server-v1.1.0) (2026-07-18)


### Features

* **server:** add battery/solar/grid 3-way consumption split to energy series ([a543e00](https://github.com/SunReye/SunReye/commit/a543e006f5daf6dc588d8c9b8dcaa1362d2499a4))


### Bug Fixes

* **server:** use *.today registers for current-day energy split and cost KPIs ([d7f61b4](https://github.com/SunReye/SunReye/commit/d7f61b46266bc0194cb1ffd36e53ed022a28d54e))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @SunReye/inverter-core bumped to 1.0.0

## [1.0.1](https://github.com/SunReye/SunReye/compare/server-v1.0.0...server-v1.0.1) (2026-07-18)


### Miscellaneous Chores

* **server:** Synchronize sunreye-stack versions

## [1.0.0](https://github.com/SunReye/SunReye/compare/server-v0.7.1...server-v1.0.0) (2026-07-18)


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


### Bug Fixes

* Home Assistant discovery, number ranges, settings tabs, chart dot ([a5beaf6](https://github.com/SunReye/SunReye/commit/a5beaf6f1fceebaee23942dffa94ada44d2ef61e))
* **inverter-core:** clamp range-annotated computed metrics ([f5d9132](https://github.com/SunReye/SunReye/commit/f5d9132cabcd51829623415e8f083f9125f2ba0e))
* **server:** boot onboarding-only when saved profile is missing ([1f77599](https://github.com/SunReye/SunReye/commit/1f775996db6bd625bb81a0dde2fed5a03527022e))
* **server:** serialize profile-repo syncs to avoid git lock races ([b5e408c](https://github.com/SunReye/SunReye/commit/b5e408c8f4742500bb679b4aba2a9a346f4c4747))
* **test:** load web test-setup and exclude paraglide from root coverage run ([24a7169](https://github.com/SunReye/SunReye/commit/24a716953404b56d92de716a8d0386c7d9fca5bc))

## [0.7.1](https://github.com/SunReye/SunReye/compare/server-v0.7.0...server-v0.7.1) (2026-07-13)


### Bug Fixes

* **profiles:** register downloaded profiles immediately, no restart ([7bca64e](https://github.com/SunReye/SunReye/commit/7bca64e994e04de6cd96554fe2623f6645268f60))

## [0.7.0](https://github.com/SunReye/SunReye/compare/server-v0.6.0...server-v0.7.0) (2026-07-13)


### Features

* **db:** add custom charts schema and migration ([855f9a9](https://github.com/SunReye/SunReye/commit/855f9a9a6517be2892037059746a9deba1a47289))
* **inverter-core:** add semver parse/compare/bump utilities ([0bbdfe7](https://github.com/SunReye/SunReye/commit/0bbdfe760a314d546a229cdb278edce1f1d943cf))
* **server:** add background profile update checker ([58883cb](https://github.com/SunReye/SunReye/commit/58883cbb78cf447676c9e42d09f9411d9836aee8))
* **server:** add custom charts API routes ([350cd8c](https://github.com/SunReye/SunReye/commit/350cd8c16b8c0e54b850714a746d68110f48e2d5))
* **web:** add instance-wide date & time display preferences ([4d5e130](https://github.com/SunReye/SunReye/commit/4d5e1307f90d2920b248b69054366c295219a0a4))


### Bug Fixes

* **addon:** carry merged changelog and defer version bump until images are pushed ([ea9a58a](https://github.com/SunReye/SunReye/commit/ea9a58a748fb66e3e9652deb893e374f9e9ee438))
* **server:** natural-sort browsed profiles by manufacturer and model ([551e228](https://github.com/SunReye/SunReye/commit/551e22884311e12eca214e050208c5dd94d0b853))


### Performance Improvements

* **deploy:** tune bundled postgres for write endurance ([2138bfb](https://github.com/SunReye/SunReye/commit/2138bfb21ababdb3fde2875a6132e8a33acf7ec1))
* **server:** batch history writes to cut SSD write wear ([30c30e3](https://github.com/SunReye/SunReye/commit/30c30e358d34375c1c9685f52c3ee5438c77202e))

## [0.6.0](https://github.com/SunReye/SunReye/compare/server-v0.5.0...server-v0.6.0) (2026-07-13)


### Features

* **inverter-core:** add sumOf deferred aggregates + prune dangling overlay refs ([41b413e](https://github.com/SunReye/SunReye/commit/41b413e4c6381a05ed204e4f8a84ef5fb7de4e20))

## [0.5.0](https://github.com/SunReye/SunReye/compare/server-v0.4.0...server-v0.5.0) (2026-07-12)


### Features

* **profiles:** add profile families & per-model variants ([ee0879d](https://github.com/SunReye/SunReye/commit/ee0879dd9dace727780dfa3b4bb596a37d21c06b))


### Reverts

* **docs:** publish the docs site under /SunReye again ([bee80d8](https://github.com/SunReye/SunReye/commit/bee80d8b863fcce2f8e3234b1cc0f431a84631c8))

## [0.4.0](https://github.com/SunReye/SunReye/compare/server-v0.3.0...server-v0.4.0) (2026-07-12)


### Features

* **docs:** publish the docs site at the organization root ([710a5ea](https://github.com/SunReye/SunReye/commit/710a5eabf8185c8551130c7457c05a373bba7612))

## [0.3.0](https://github.com/ediiiz/SunReye/compare/server-v0.2.2...server-v0.3.0) (2026-07-12)


### Features

* **addon:** ship server and migrate as one compiled binary ([68fd0db](https://github.com/ediiiz/SunReye/commit/68fd0db4db22a42f6253032363eb4ba3f9940bba))
* **web:** add adapter-static build mode for prefix-agnostic deployments ([727fa3c](https://github.com/ediiiz/SunReye/commit/727fa3c6924c8878d88f60171915139233feca0f))

## [0.2.2](https://github.com/ediiiz/SunReye/compare/server-v0.2.1...server-v0.2.2) (2026-07-12)


### Bug Fixes

* **auth:** resolve rate-limit client IP from x-forwarded-for ([f16c1b1](https://github.com/ediiiz/SunReye/commit/f16c1b1e7299b0b6a6147dd668e410a8c0fddb78))

## [0.2.1](https://github.com/ediiiz/SunReye/compare/server-v0.2.0...server-v0.2.1) (2026-07-12)


### Miscellaneous Chores

* **server:** Synchronize sunreye-stack versions

## [0.2.0](https://github.com/ediiiz/SunReye/compare/server-v0.1.0...server-v0.2.0) (2026-07-12)


### Features

* **addon:** home assistant addon with embedded timescaledb ([f22b52a](https://github.com/ediiiz/SunReye/commit/f22b52a039adbb10374357afcd5a299323727f5c))
* **db:** journaled migrations with baseline stamping and downgrade guard ([3514089](https://github.com/ediiiz/SunReye/commit/3514089b3c741daeee86670411d6487f9711e67a))
* **server:** same-origin auth model, /healthz, and host binding ([3d9e9b1](https://github.com/ediiiz/SunReye/commit/3d9e9b1e95fecc0c863f1f783ea8048542df802b))
* **web:** runtime API base and hash routing for reverse-proxy prefixes ([1aa8661](https://github.com/ediiiz/SunReye/commit/1aa8661b1b5ca0fac7932d12a92c419941c53b1e))


### Bug Fixes

* **server:** exclude serialport from compiled binary, pin bun builders ([1115a38](https://github.com/ediiiz/SunReye/commit/1115a386ff4b10f45d2ee2f1c442f87400cb3171))

## [0.1.0](https://github.com/ediiiz/SunReye/compare/server-v0.0.1...server-v0.1.0) (2026-07-11)


### Features

* **brand:** unify logo across docs and web, align docs theme with app ([81dbad0](https://github.com/ediiiz/SunReye/commit/81dbad07494e2a02df6f66643f6d952acdceb40e))
* **costs:** range picker with contextual net-cost bar charts ([425a134](https://github.com/ediiiz/SunReye/commit/425a1344cc43e0faad0c068a67ab01e738806d6b))
* **costs:** range-driven energy split + solar self-consumption savings ([d1c5b17](https://github.com/ediiiz/SunReye/commit/d1c5b1775d76d29c14e1493d0e102d38e03763be))
* **costs:** total-cost series, cleaner layout, fade transitions ([4016f4f](https://github.com/ediiiz/SunReye/commit/4016f4ff312aec2a00908d6fcfb3bfccda83eb15))
* **docker:** auto-apply schema via one-shot migrate service ([259cbaf](https://github.com/ediiiz/SunReye/commit/259cbafc012918a533f335cbb0afc08f591d0ec6))
* **inverter:** add computed self-consumption and efficiency metrics ([73e0043](https://github.com/ediiiz/SunReye/commit/73e00431efa69f177e7cc978f125f637b791cc7e))
* **inverter:** drive time-of-use target by battery mode ([e3b1188](https://github.com/ediiiz/SunReye/commit/e3b1188c4c791a4f6e5287628e94130a93fdff63))
* **settings:** add admin danger-zone data reset ([c0e03db](https://github.com/ediiiz/SunReye/commit/c0e03db0224a766078867cccddfa07f3d1d783ab))
* wire Deye real-time inverter dashboard scaffold ([dc1afce](https://github.com/ediiiz/SunReye/commit/dc1afcecac6097fbdf6793e7e17397fb0c6e22a7))


### Bug Fixes

* **cost:** price counters by cross-bucket delta, not intra-bucket max−min ([8fdd54c](https://github.com/ediiiz/SunReye/commit/8fdd54c3309add5343e3e5813c18d38c7276f71c))
* **env:** change defaults and make boot more reliable ([97b8c25](https://github.com/ediiiz/SunReye/commit/97b8c2518b325efddc79e8b501d31cdbf1ab4234))
* **inverter-core:** serialize modbus client and write via FC16 ([2cd1b2c](https://github.com/ediiiz/SunReye/commit/2cd1b2cfff9c51dd968f75396972e016d149a0db))
* **inverter:** make saved host optional for unconfigured installs ([12a82dc](https://github.com/ediiiz/SunReye/commit/12a82dc519e1582caa4d157fd7d58cf52f6b389a))
* **server:** surface inverter write failures as 502 with logged cause ([b95f63b](https://github.com/ediiiz/SunReye/commit/b95f63b622cb3acdac06ec0713c98df868f30706))
