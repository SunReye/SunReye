# Changelog

## [1.3.0](https://github.com/SunReye/SunReye/compare/server-v1.2.0...server-v1.3.0) (2026-08-27)


### Features

* add peak-shaving automation engine ([f0bda94](https://github.com/SunReye/SunReye/commit/f0bda944036958b20b244432298badbaf42b67c0))
* **auth:** add "keep me signed in" option on login ([d75bbb3](https://github.com/SunReye/SunReye/commit/d75bbb3c5e6446c073c00389a3e5b64afe0ca256))
* **automations:** borrow the car as a sink for negative-price windows ([98e8b47](https://github.com/SunReye/SunReye/commit/98e8b474b5013e9dd868b2b412a30dd8cd665d51))
* **automations:** charge from the grid during negative-price windows ([43b66c7](https://github.com/SunReye/SunReye/commit/43b66c7ab9f532235072bd5428eb1576ad570c85))
* **automations:** hold the battery low ahead of negative-price windows ([74f5693](https://github.com/SunReye/SunReye/commit/74f56934948f39f6010475f4063e7734140d5fd1))
* **automations:** plan projection, decision history, and charting UI for peak shaving ([162d882](https://github.com/SunReye/SunReye/commit/162d882209a07a6997a501136c99042c7b031690))
* **automations:** read live-capable status readings from the 1 Hz feeds ([261da4c](https://github.com/SunReye/SunReye/commit/261da4c1213f9d59a15d4d705a5d813a1d6d60a7))
* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **automations:** use EVCC battery boost to empty the pack ([76bf1ed](https://github.com/SunReye/SunReye/commit/76bf1ede652d50368cad513efae32b9999c2e427))
* chart zoom, an honest peak-shaving reserve, and the layout docs ([6fa4f3b](https://github.com/SunReye/SunReye/commit/6fa4f3be1783e606b2d86160750dcfe5a8312d54))
* choose the chart palette in settings ([95a5dcc](https://github.com/SunReye/SunReye/commit/95a5dcc21bb9d7ea528b85a4ae4b65f13ada33a7))
* **cost:** report the export that earned nothing under §51 ([f381172](https://github.com/SunReye/SunReye/commit/f381172db0834812ebcd31ec19a3d3ef928f53bf))
* **db:** a weight column on the hot path ([e464e3f](https://github.com/SunReye/SunReye/commit/e464e3fa7f5df41a21b865a06bc3f125e8d94605))
* **db:** add forecast-correction tables + config toggle ([6ed9d95](https://github.com/SunReye/SunReye/commit/6ed9d95cfdb71037267002853157abb377a10dfd))
* **db:** add statistics preferences schema ([57d1e52](https://github.com/SunReye/SunReye/commit/57d1e5272c520238821eea1e63b253a6e6d88239))
* **db:** freeze the minute aggregates and keep raw for five years ([554ca75](https://github.com/SunReye/SunReye/commit/554ca75cae43888ebee21bd29b88d91291e7a147))
* **db:** re-derive retention against the measured footprint ([82eeaf0](https://github.com/SunReye/SunReye/commit/82eeaf0f68bc1d8a843b3c3d81922d37b30bec4d))
* **db:** type the TimescaleDB surface — hyperfunction wrappers, declared aggregates, parity ([4c805fc](https://github.com/SunReye/SunReye/commit/4c805fc87aaa4b6ae1675218a042a7f57787d156))
* **evcc:** estimate live charge power between EVCC publishes ([d810bb7](https://github.com/SunReye/SunReye/commit/d810bb7cff76d6f92aa53f26fc595b394a2a6e6b))
* **forecast:** 15-minute solar forecast with peak-power tooltip ([fcb50aa](https://github.com/SunReye/SunReye/commit/fcb50aad899c1f2b8b362cc9217a173df55bece6))
* **forecast:** export raw + usable production forecast over MQTT and API ([574a0c5](https://github.com/SunReye/SunReye/commit/574a0c51d1f26c57e20f209770c97b43f572d68d))
* **forecast:** incidence-angle and wind-aware cell-temperature physics ([d0ed115](https://github.com/SunReye/SunReye/commit/d0ed115f949ff68e27cee142a4c8ed93cb30e378))
* **forecast:** model feed-in clipping + battery in solar forecast ([88974b2](https://github.com/SunReye/SunReye/commit/88974b229ca54846d4a1640ad374d6ed7c2fa508))
* **inverter-core:** sample computed-metric inputs in one atomic read ([fea7f48](https://github.com/SunReye/SunReye/commit/fea7f48eacd16930e488386afc20b268f058e7ab))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* make the role vocabulary fit non-Deye inverters ([39db7f8](https://github.com/SunReye/SunReye/commit/39db7f805c9ae02b774cce2fd06555417c029d57))
* measured battery capacity and state of health, and the settings move it forced ([186968e](https://github.com/SunReye/SunReye/commit/186968ec4cf7618fdc6953952c0a0dc0e0ca8a2d))
* plant time zone setting + dropdown scroll + energy/cost day alignment ([2048a31](https://github.com/SunReye/SunReye/commit/2048a31d59abe148cab95a7f4838925787431651))
* **prices:** add day-ahead spot prices with the energy-charts provider ([48b81ce](https://github.com/SunReye/SunReye/commit/48b81ce27126617514742e644fa2c0e9c0c5a310))
* **prices:** add the awattar provider ([158daa0](https://github.com/SunReye/SunReye/commit/158daa0692c5b7b748b6bd9fdcd6488314fbfdf6))
* **scripts:** the storage-wear harness, so the projections become gates ([a89bd08](https://github.com/SunReye/SunReye/commit/a89bd08f07db19aa4210b2e5b1126558775c5b69)), closes [#122](https://github.com/SunReye/SunReye/issues/122)
* serve minute buckets from raw, freeze the minute aggregates, keep raw five years ([bcfb46f](https://github.com/SunReye/SunReye/commit/bcfb46fbe9a72483e5e97360a1ed8e91cd51de6c))
* **server:** answer minute buckets from raw ([e7604e7](https://github.com/SunReye/SunReye/commit/e7604e7589587600aaeeea775b5ab84de8583ba7))
* **server:** apply §51 zero-value export to the cost series ([067ad2e](https://github.com/SunReye/SunReye/commit/067ad2e1dc10a1a2f9cc161d324ee9bca034fc20))
* **server:** change-encode the stored series, with the duration each value held ([70cc884](https://github.com/SunReye/SunReye/commit/70cc884aaf73e77f77fe324fa39c775c24099927)), closes [#117](https://github.com/SunReye/SunReye/issues/117)
* **server:** clip past forecast slots from measured day-start SOC ([d75daf0](https://github.com/SunReye/SunReye/commit/d75daf0810e8faccc90be950d68834b28add57e1))
* **server:** compress responses with @elysia/compress ([2a9f59f](https://github.com/SunReye/SunReye/commit/2a9f59f0b9fd13bd35360f9102565113c3fa473e))
* **server:** count and export the history buffer's dropped rows ([290c619](https://github.com/SunReye/SunReye/commit/290c61982fef9f7167b2a2deadf083fe29b54152)), closes [#119](https://github.com/SunReye/SunReye/issues/119)
* **server:** dedicated plant time zone for server-side bucketing ([55885f1](https://github.com/SunReye/SunReye/commit/55885f12da13941a67e9bf5a47d7e28e5528585b))
* **server:** finish the irradiance provider seam ([063086f](https://github.com/SunReye/SunReye/commit/063086fa94c53c62c67b3643941032599d6716e9))
* **server:** imply house consumption when nothing meters it ([7404790](https://github.com/SunReye/SunReye/commit/7404790920519232f9e1f5ba89a221ad52d3082d))
* **server:** learn + apply PV-forecast bias correction ([fc4260e](https://github.com/SunReye/SunReye/commit/fc4260e34cb321cc1222c502bcaf4a2923ff80d2))
* **server:** live statistics stream over websocket ([94f0d0c](https://github.com/SunReye/SunReye/commit/94f0d0c8274e6379edcfd740b80de5ba60dc2160))
* **server:** measure battery capacity and state of health ([4ac71f9](https://github.com/SunReye/SunReye/commit/4ac71f9db8b4f0cf1fac75815ebc78340211487e))
* **server:** multiplexed /ws with per-topic authorization ([f42d09a](https://github.com/SunReye/SunReye/commit/f42d09a77f483b2472520160e42337723510ce05))
* **server:** period comparison and all-time records endpoints ([8cb7abf](https://github.com/SunReye/SunReye/commit/8cb7abf38545ad4f9dc956a49273f2a8eac9fc61))
* **server:** restore request correlation lost with @logtape/elysia ([a8bafe9](https://github.com/SunReye/SunReye/commit/a8bafe9c1e6709efbdfba7474a98fa4ce2d85470))
* **server:** route config registers and absent hardware out of metrics_raw ([33760c6](https://github.com/SunReye/SunReye/commit/33760c64d2b29f99f5a92e2d1de3e9ed1c4a79a5))
* **server:** runtime-configurable and per-category log levels ([e621b2c](https://github.com/SunReye/SunReye/commit/e621b2c522e1069fb7e49ffda107aa34454bcf5f))
* **server:** serve each rollup bucket from one source, preferring the weighted one ([c4b9631](https://github.com/SunReye/SunReye/commit/c4b9631b1c8981fd851ae81d9eedfb3a070cece4)), closes [#116](https://github.com/SunReye/SunReye/issues/116)
* **server:** serve the dashboard from the compiled binary ([b52de5e](https://github.com/SunReye/SunReye/commit/b52de5ec5c578165df9781a901bc071d8f950a80))
* **server:** spot price analytics endpoint ([1bf1b38](https://github.com/SunReye/SunReye/commit/1bf1b3849472e60a802a1f549c8c6c777ac0636f))
* **server:** statistics preferences endpoints ([27156ca](https://github.com/SunReye/SunReye/commit/27156ca4bdb4b6bf4ebb15d8c5ec5f3a47474eb5))
* **server:** statistics route module with hour-weekday heatmap ([e947e0b](https://github.com/SunReye/SunReye/commit/e947e0baf44a30830080d4648e5066a5940f9869))
* **server:** track battery charged energy in rollup reads ([9902ea2](https://github.com/SunReye/SunReye/commit/9902ea2731cb08f9e41ad546f80688f9f17a04ce))
* **server:** upgrade to Elysia 2 ([d280e20](https://github.com/SunReye/SunReye/commit/d280e20b7f2edef453afeb5175457db69f97fb86))
* stream server logs to an admin Settings panel ([faeaf08](https://github.com/SunReye/SunReye/commit/faeaf0807b2a7b33fa9fca5c6706b892781f3320))
* **tariff:** price energy against the market with a marketing model ([2075caa](https://github.com/SunReye/SunReye/commit/2075caafbaa00c3b398bec1db2729369a11fd9db))
* **tooling:** extend the TDD gate to Rust before any .rs exists ([d43aa42](https://github.com/SunReye/SunReye/commit/d43aa42c8e3c152cd4f3b7799f606f17b0cebf50)), closes [#95](https://github.com/SunReye/SunReye/issues/95)
* **web:** capacity and health tiles for the measured battery ([10abc21](https://github.com/SunReye/SunReye/commit/10abc21bd31e1be194ee3dcf88876c849d1a2a15))
* **web:** categorical chart palette, and a colour per series ([884c4b6](https://github.com/SunReye/SunReye/commit/884c4b66858150770cba9ef76abb691d3af53d56))
* **web:** compare replaces add-to-chart in the card header ([55490a2](https://github.com/SunReye/SunReye/commit/55490a21fcc36d55dd11cbc83d73144224a7f98f))
* **web:** configure and observe price-aware charging ([6eb41c1](https://github.com/SunReye/SunReye/commit/6eb41c1322b73e512838ad4e2465cb1f19001711))
* **web:** draft a chart on a full-screened metric card ([a718f90](https://github.com/SunReye/SunReye/commit/a718f90a7f01744af3548a4ff342c759b7952c9f))
* **web:** mobile UX pass, standardised date navigation, and browser coverage for every page ([6646324](https://github.com/SunReye/SunReye/commit/6646324c7faf0b6cd6bc7eb68c00e89c4deb26c2))
* **web:** the battery's nominal voltage moves to the plant settings ([6714eca](https://github.com/SunReye/SunReye/commit/6714ecabe1717daf203c2bb949798f425c33e52f))
* **web:** the power-flow diagram shoots charges of energy ([a1d50dc](https://github.com/SunReye/SunReye/commit/a1d50dca274b0f69e111a5eff19bd9fd60cc1b81))


### Bug Fixes

* **addon:** derive the backup's raw-data exclusion from the live retention policy ([c6e68aa](https://github.com/SunReye/SunReye/commit/c6e68aac4a2364b9461e6389525ceac92771db4f))
* **addon:** exclude compressed chunk data from a non-full dump ([2ec3ec3](https://github.com/SunReye/SunReye/commit/2ec3ec3871ce88981c5977ae73dd2456bec5a2f9))
* **addon:** keep raw in the default backup once the minute tier is frozen ([3d159df](https://github.com/SunReye/SunReye/commit/3d159dfd0e3b1c8d88716f90f857502dc8dac944))
* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **addon:** serve the multiplexed live socket at exactly /ws ([ab06deb](https://github.com/SunReye/SunReye/commit/ab06deb285fb5bda0d08b8e84016d32cd41d07be))
* **automations:** derive EV demand when EVCC reports none ([619c4f3](https://github.com/SunReye/SunReye/commit/619c4f301845da5a33325079522f324674a97f4e))
* **automation:** the live limit readback resolves voltage like the target does ([5470d42](https://github.com/SunReye/SunReye/commit/5470d42f9d3fb81a1981d42858b4e3241cc0e573))
* **ci:** import the db by path in the weighted-rollups gate ([56dfe1f](https://github.com/SunReye/SunReye/commit/56dfe1fbf57a78d9ac37db62ef26717725ab0097))
* **ci:** materialize the weighted tiers in the restore fixture ([eeadfec](https://github.com/SunReye/SunReye/commit/eeadfec886cc115003430314e11aabdc2a0c78da))
* **ci:** pass DATABASE_URL to dump.sh in the restore test ([bd3a308](https://github.com/SunReye/SunReye/commit/bd3a308221818c2d92e6e9f62ec22d58bd4c84c1)), closes [#127](https://github.com/SunReye/SunReye/issues/127)
* **ci:** run the cutover assertion from apps/server, where its deps are declared ([78d6beb](https://github.com/SunReye/SunReye/commit/78d6beb337b42073d821d158374d83b500b119ad))
* **ci:** stop retention deleting the restore fixture mid-test ([aba10ab](https://github.com/SunReye/SunReye/commit/aba10abad32d0e62db1058a5cbf644007d33f4da)), closes [#127](https://github.com/SunReye/SunReye/issues/127)
* **db:** make the retention change reach an existing database, and prove it ([780c767](https://github.com/SunReye/SunReye/commit/780c7675f43cf8d8755aec62ece6f2907494b845))
* **energy:** pin each role's kWh derivation, and a counter-restart hole ([#115](https://github.com/SunReye/SunReye/issues/115)) ([a8b5f55](https://github.com/SunReye/SunReye/commit/a8b5f55f19d0a2f3b3b7aa02efbcc90d5c84aaa4))
* **evcc:** read the charge limit from the effective/vehicle topics ([dbfb00d](https://github.com/SunReye/SunReye/commit/dbfb00d4d6c6fbc2fa0debff9c383b0478456b83))
* **forecast:** integrate instantaneous irradiance per clock hour ([3e772de](https://github.com/SunReye/SunReye/commit/3e772de9f864d4aa9952af505acd4dccb62d0020))
* green the suite, stop the weather tile printing NaN, and enforce TDD ([37d8e9b](https://github.com/SunReye/SunReye/commit/37d8e9b9531ef15e07bcba82bd968b358b5c590f))
* plant-local time-zone bucketing ([#46](https://github.com/SunReye/SunReye/issues/46), [#52](https://github.com/SunReye/SunReye/issues/52)) + solar-forecast average power ([#47](https://github.com/SunReye/SunReye/issues/47), [#49](https://github.com/SunReye/SunReye/issues/49)) + chart-axes type ([#51](https://github.com/SunReye/SunReye/issues/51)) ([36955a5](https://github.com/SunReye/SunReye/commit/36955a5b69809c93d699c45022709cd8e0f60e55))
* restore ControlLock and make bun test load the env-gated suites ([3ab4c86](https://github.com/SunReye/SunReye/commit/3ab4c8600c6f10ccfafae1f77ef8892dfb0d145f))
* **server:** align the energy day chart extent with the cost series ([9d15260](https://github.com/SunReye/SunReye/commit/9d15260a0f1a97359c7c0fd592707cc43f10c662))
* **server:** bucket plant-local periods by a configured time zone, not the host ([6edf217](https://github.com/SunReye/SunReye/commit/6edf217a684b1116f4a944a1dd6a94f6f3c38ee9))
* **server:** carry the held value into the live backfill window ([f504120](https://github.com/SunReye/SunReye/commit/f50412036b7e70a64111089937368f4bf90d5893)), closes [#118](https://github.com/SunReye/SunReye/issues/118)
* **server:** declare openapi-types, Elysia 2's last undeclared peer ([f1583e9](https://github.com/SunReye/SunReye/commit/f1583e940f6e05aa7be477a4f747f70d444242db))
* **server:** harden forecast-correction learning ([58d33d8](https://github.com/SunReye/SunReye/commit/58d33d8ccfff9b0442317f189b641d2f4bd8ce55))
* **server:** include today's live registers in month- and year-to-date ([71561a7](https://github.com/SunReye/SunReye/commit/71561a7f2a838093d885dfa1fe0411751970cf5b))
* **server:** keep the effectiveness watchdog quiet on a near-full pack ([f80fba0](https://github.com/SunReye/SunReye/commit/f80fba072b372a1cf7716ef64c3432dd87293059))
* **server:** never bill a recording gap to the hour it ended ([32c28a8](https://github.com/SunReye/SunReye/commit/32c28a8afe2abd3b52086069c257467a99fbf38c))
* **server:** never let ambient git plumbing redirect our git calls ([db8225e](https://github.com/SunReye/SunReye/commit/db8225e9869552f6eda5a2cb565d835b757c50db))
* **server:** one market average, one definition of self-consumption ([2a6b8f9](https://github.com/SunReye/SunReye/commit/2a6b8f9fd83d4c22b71ac3723cd8846bafd565a3))
* **server:** restore HEAD on GET routes under Elysia 2 ([886ad63](https://github.com/SunReye/SunReye/commit/886ad6304b405b4bc57de06ff36d0230ed1579cd))
* **server:** round the request-log duration to two decimals ([d5a87c3](https://github.com/SunReye/SunReye/commit/d5a87c347e34320c1386359586a80882bc18cb0e))
* **server:** the recent-history read no longer 500s on every dashboard load ([5da7c40](https://github.com/SunReye/SunReye/commit/5da7c4067c72ed236c9d1d5c24bff4edc4694af8))
* **server:** validate every write in the funnel, and pre-flight presets ([15a3a77](https://github.com/SunReye/SunReye/commit/15a3a77063b59ed9c3a8129af802785b446cc38d))
* **server:** wire TypeBox statically so the compiled binary can validate ([34ef44a](https://github.com/SunReye/SunReye/commit/34ef44afb573aaf195122a47441a6f7579c87540))
* **statistics:** chart the whole calendar month, and only that month ([745fac5](https://github.com/SunReye/SunReye/commit/745fac5134fcb7f49dc05c2b81d5e9f66b920abe))
* stop the charge-current round-up eating exportable PV, and finish the card migration ([3cdadfe](https://github.com/SunReye/SunReye/commit/3cdadfec95bbaa412034355159c319ec6519bdf8))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))
* **test:** stop the suite depending on which file the runner reaches first ([487ea8c](https://github.com/SunReye/SunReye/commit/487ea8cb24f83417565dd2d3c72b9782fc091ae7))
* **web:** full-screen the document, not the card ([3f1f1b4](https://github.com/SunReye/SunReye/commit/3f1f1b4c373076a52876e0714231b03cb778d09e))
* **web:** patch layerchart's unclamped stacked-bar height ([e3c691a](https://github.com/SunReye/SunReye/commit/e3c691a2a00d4746fb38edfb6d9883d4e85ed1b0))
* **web:** report slot-average power consistently in the solar-forecast dialog ([28ec5fe](https://github.com/SunReye/SunReye/commit/28ec5fe53489a9343cc96de75cdc5d6ddfeb9ace))


### Performance Improvements

* **db:** compress after 2h, checkpoint every 2h, compress WAL with zstd ([42bac87](https://github.com/SunReye/SunReye/commit/42bac87c62ab92f3f9085d367e687e766dfc4b84))
* **e2e:** fully parallel + 4-way sharded browser suite, measurement layer removed ([0b22586](https://github.com/SunReye/SunReye/commit/0b225861700785daa92ed7c0f91ab6b8185e8951))
* **e2e:** run the browser suite fully parallel and sharded, and drop the measurement layer ([44d1e65](https://github.com/SunReye/SunReye/commit/44d1e659cf4fba46a27b5fc789ed688b5a5cd49d))
* **server,web:** bucket the sparkline backfill and resume from the gap ([d9a66b8](https://github.com/SunReye/SunReye/commit/d9a66b826c450ec6d60d66145f9e487d1778917b))
* **test:** run the suite with --parallel, and say why coverage must not ([6a5f738](https://github.com/SunReye/SunReye/commit/6a5f73838722d0bb0cee705c0458e374d0bcc749))
* **web:** make /history cheap to scroll, and give the repo a browser test layer ([c8b4281](https://github.com/SunReye/SunReye/commit/c8b4281711decf0e1e30c612f5c0c1787bd411ea))
* **web:** make /history cheap when it is doing nothing ([6f08e7a](https://github.com/SunReye/SunReye/commit/6f08e7a00eeb8a8b9d076c794f867dc22906d00e))


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
