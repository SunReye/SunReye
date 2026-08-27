# Changelog

## [unreleased]

Unreleased work on `dev` since 1.2.0, shipped in `beta.20260827-b87b0d1`.


### Features

* **server:** compress responses with @elysia/compress ([2a9f59f](https://github.com/SunReye/SunReye/commit/2a9f59f0b9fd13bd35360f9102565113c3fa473e))
* **server:** restore request correlation lost with @logtape/elysia ([a8bafe9](https://github.com/SunReye/SunReye/commit/a8bafe9c1e6709efbdfba7474a98fa4ce2d85470))
* **server:** upgrade to Elysia 2 ([d280e20](https://github.com/SunReye/SunReye/commit/d280e20b7f2edef453afeb5175457db69f97fb86))
* **db:** type the TimescaleDB surface — hyperfunction wrappers, declared aggregates, parity ([4c805fc](https://github.com/SunReye/SunReye/commit/4c805fc87aaa4b6ae1675218a042a7f57787d156))
* **server:** serve the dashboard from the compiled binary ([b52de5e](https://github.com/SunReye/SunReye/commit/b52de5ec5c578165df9781a901bc071d8f950a80))
* **web:** the home node carries a separately metered backup output ([d066040](https://github.com/SunReye/SunReye/commit/d06604059fb50f7d5ae16a6b8f14bc080cac6efa))
* **web:** open each power-flow node onto its own readings, and retire /system ([dd77bcb](https://github.com/SunReye/SunReye/commit/dd77bcbca06e063750b8b40c2597b45f259124af))
* **web:** the battery's nominal voltage moves to the plant settings ([6714eca](https://github.com/SunReye/SunReye/commit/6714ecabe1717daf203c2bb949798f425c33e52f))
* **web:** nameplate setting and the capacity degradation chart ([bb35d49](https://github.com/SunReye/SunReye/commit/bb35d4987846962d439df44fc47ba1daacb565b4))
* **web:** capacity and health tiles for the measured battery ([10abc21](https://github.com/SunReye/SunReye/commit/10abc21bd31e1be194ee3dcf88876c849d1a2a15))
* **server:** measure battery capacity and state of health ([4ac71f9](https://github.com/SunReye/SunReye/commit/4ac71f9db8b4f0cf1fac75815ebc78340211487e))
* **web:** a battery round-trip efficiency tile ([e105692](https://github.com/SunReye/SunReye/commit/e1056925ebf3f8f179f9660e11f44cd64b93baca))
* **inverter-core:** add per-string yield and grid frequency roles ([452d165](https://github.com/SunReye/SunReye/commit/452d16537b3077db83a5bc5e4ae9790e8ee9b8b2))
* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **server:** imply house consumption when nothing meters it ([7404790](https://github.com/SunReye/SunReye/commit/7404790920519232f9e1f5ba89a221ad52d3082d))
* **web:** render the home node from the load metric, not the UPS capability ([f076931](https://github.com/SunReye/SunReye/commit/f076931e40211ecfd3deee77dffda724f510ecf3))
* **inverter-core:** separate the backup output from house load ([4ae4d04](https://github.com/SunReye/SunReye/commit/4ae4d044b060c8a8299141b197948062486e12d6))
* **db:** freeze the minute aggregates and keep raw for five years ([554ca75](https://github.com/SunReye/SunReye/commit/554ca75cae43888ebee21bd29b88d91291e7a147))
* **server:** answer minute buckets from raw ([e7604e7](https://github.com/SunReye/SunReye/commit/e7604e7589587600aaeeea775b5ab84de8583ba7))
* **db:** re-derive retention against the measured footprint ([82eeaf0](https://github.com/SunReye/SunReye/commit/82eeaf0f68bc1d8a843b3c3d81922d37b30bec4d))
* **server:** serve each rollup bucket from one source, preferring the weighted one ([c4b9631](https://github.com/SunReye/SunReye/commit/c4b9631b1c8981fd851ae81d9eedfb3a070cece4))
* **db:** time-weighted rollups, and the compression every tier was missing ([8d61780](https://github.com/SunReye/SunReye/commit/8d6178018345b94fd60b2a859323897fb50b75de))
* **db:** a weight column on the hot path ([e464e3f](https://github.com/SunReye/SunReye/commit/e464e3fa7f5df41a21b865a06bc3f125e8d94605))
* **server:** count and export the history buffer's dropped rows ([290c619](https://github.com/SunReye/SunReye/commit/290c61982fef9f7167b2a2deadf083fe29b54152))
* **scripts:** the storage-wear harness, so the projections become gates ([a89bd08](https://github.com/SunReye/SunReye/commit/a89bd08f07db19aa4210b2e5b1126558775c5b69))
* **server:** change-encode the stored series, with the duration each value held ([70cc884](https://github.com/SunReye/SunReye/commit/70cc884aaf73e77f77fe324fa39c775c24099927))
* **server:** route config registers and absent hardware out of metrics_raw ([33760c6](https://github.com/SunReye/SunReye/commit/33760c64d2b29f99f5a92e2d1de3e9ed1c4a79a5))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* **profile-sdk:** author a real meter against the http arm ([76c57b5](https://github.com/SunReye/SunReye/commit/76c57b52570952c966ce5bf2b6e1c145e7e6eb50))
* **inverter-core:** an HTTP transport behind the same seam ([048dcb6](https://github.com/SunReye/SunReye/commit/048dcb6628ee430e695f224b4cae03b93436aa11))
* **inverter-core:** an http arm on the binding union ([5f3f051](https://github.com/SunReye/SunReye/commit/5f3f0516b0071a92e50d22ddf71b8a1e022b7e08))
* **inverter-core:** say when a sample was not read all at once ([b607cc0](https://github.com/SunReye/SunReye/commit/b607cc0ae37fa9730741dbf21395f8f67aca126e))
* **tooling:** extend the TDD gate to Rust before any .rs exists ([d43aa42](https://github.com/SunReye/SunReye/commit/d43aa42c8e3c152cd4f3b7799f606f17b0cebf50))
* **profile-sdk:** six plausibility lints and a required-role build floor ([0b34134](https://github.com/SunReye/SunReye/commit/0b34134fe636018cd73c11666b8dd5eaf3a9e7e2))
* **profile-sdk:** add `profile replay` — golden register captures ([915ad49](https://github.com/SunReye/SunReye/commit/915ad497d2a990eb27ab8442633dabb28aefeb76))
* **profile-sdk:** lint the silent resolveKind fallback ([383c9c0](https://github.com/SunReye/SunReye/commit/383c9c08843a36c7f421911d236f6f558dd052ad))
* **web:** two fingers zoom any chart, with nothing to arm ([65d26ba](https://github.com/SunReye/SunReye/commit/65d26ba24b2129dde64617cc0bdb558d57fa8d36))
* **web:** full screen moves to the plot's corner, away from the caret ([15723cb](https://github.com/SunReye/SunReye/commit/15723cbe1c08d5d5b78760a0483be6b8f110b0b2))
* **web:** one interaction model and one house style for every chart ([564b9bc](https://github.com/SunReye/SunReye/commit/564b9bc13c083b1f25b6d7f823d87cf5172ff7fa))
* **web:** navigate history and statistics by period ([59b3852](https://github.com/SunReye/SunReye/commit/59b3852da6b9e94d0d24eb3abc4e90fad215af80))
* **web:** show grid imported and exported energy on /statistics ([c56b7f9](https://github.com/SunReye/SunReye/commit/c56b7f96573d04798db23fd3481f27dc5af950d7))
* **web:** hub and nodes answer the plant's load ([61626df](https://github.com/SunReye/SunReye/commit/61626dfedc5129e71acfc6fad08c7c083ce1be84))
* **web:** the interleaved pulse ladder ([f30c49e](https://github.com/SunReye/SunReye/commit/f30c49e6cc19e211b69d00aa3565992f7d1d6568))
* **web:** a plant ceiling the diagram can be measured against ([9264964](https://github.com/SunReye/SunReye/commit/92649641f95ac427f3164b1b6b6eaafeb37c9719))
* choose the chart palette in settings ([95a5dcc](https://github.com/SunReye/SunReye/commit/95a5dcc21bb9d7ea528b85a4ae4b65f13ada33a7))
* **web:** categorical chart palette, and a colour per series ([884c4b6](https://github.com/SunReye/SunReye/commit/884c4b66858150770cba9ef76abb691d3af53d56))
* **web:** zoom the overlaid chart, saved or drafted ([4764645](https://github.com/SunReye/SunReye/commit/47646450ce1cda8847ab7302be11189322a5ac0c))
* **web:** compare replaces add-to-chart in the card header ([55490a2](https://github.com/SunReye/SunReye/commit/55490a21fcc36d55dd11cbc83d73144224a7f98f))
* **web:** draft a chart on a full-screened metric card ([a718f90](https://github.com/SunReye/SunReye/commit/a718f90a7f01744af3548a4ff342c759b7952c9f))
* **web:** add a metric to a custom chart from its own card ([696b0a1](https://github.com/SunReye/SunReye/commit/696b0a19b19bf3a29e2978d7f5c204b5f6a40469))
* **web:** take any chart to the whole screen ([be82a7a](https://github.com/SunReye/SunReye/commit/be82a7a94ba99ad87eea8fcdb0d19af3079b3afa))
* chart zoom, an honest peak-shaving reserve, and the layout docs ([6fa4f3b](https://github.com/SunReye/SunReye/commit/6fa4f3be1783e606b2d86160750dcfe5a8312d54))
* **web:** canonical page shell and section primitives ([194b05e](https://github.com/SunReye/SunReye/commit/194b05e85ebe4ef3b0335bed7e28df1045a1eb97))
* **web:** one leased socket with topic subscriptions ([d281575](https://github.com/SunReye/SunReye/commit/d281575929c636d489d2bacb3432f0a3ea0b8bb6))
* **server:** multiplexed /ws with per-topic authorization ([f42d09a](https://github.com/SunReye/SunReye/commit/f42d09a77f483b2472520160e42337723510ce05))
* **server:** dedicated plant time zone for server-side bucketing ([55885f1](https://github.com/SunReye/SunReye/commit/55885f12da13941a67e9bf5a47d7e28e5528585b))
* **server:** finish the irradiance provider seam ([063086f](https://github.com/SunReye/SunReye/commit/063086fa94c53c62c67b3643941032599d6716e9))
* **web:** live indicator and dated section captions ([3c8ccf2](https://github.com/SunReye/SunReye/commit/3c8ccf277fe52c99bc114961ddb3da4ce96093da))
* **web:** compare every statistics figure with its reference window ([723b04e](https://github.com/SunReye/SunReye/commit/723b04e1ae8ed115b08f73191e10e456d7c87f67))
* **web:** seed chart view scope from the saved preference ([055c799](https://github.com/SunReye/SunReye/commit/055c799467ba6e42506444dacee091ff5ff25783))
* **web:** spot price analytics section ([a4b85c2](https://github.com/SunReye/SunReye/commit/a4b85c2e079949f8411d8b4137ee9cd22e1bbaa7))
* **web:** live statistics updates over websocket ([c81b22e](https://github.com/SunReye/SunReye/commit/c81b22e49a7e5073ccda4699c996ac816db51fe0))
* **web:** energy analytics section ([c389bbe](https://github.com/SunReye/SunReye/commit/c389bbe081fbec7fed00c6e55d7c1e965dc8ecb2))
* **server:** live statistics stream over websocket ([94f0d0c](https://github.com/SunReye/SunReye/commit/94f0d0c8274e6379edcfd740b80de5ba60dc2160))
* **server:** apply §51 zero-value export to the cost series ([067ad2e](https://github.com/SunReye/SunReye/commit/067ad2e1dc10a1a2f9cc161d324ee9bca034fc20))
* **server:** spot price analytics endpoint ([1bf1b38](https://github.com/SunReye/SunReye/commit/1bf1b3849472e60a802a1f549c8c6c777ac0636f))
* **server:** period comparison and all-time records endpoints ([8cb7abf](https://github.com/SunReye/SunReye/commit/8cb7abf38545ad4f9dc956a49273f2a8eac9fc61))
* **web:** rename /costs route to /statistics with hash redirect ([7c339a6](https://github.com/SunReye/SunReye/commit/7c339a65d7ce83b595b814f36ca0b5b3a798cc36))
* **server:** statistics route module with hour-weekday heatmap ([e947e0b](https://github.com/SunReye/SunReye/commit/e947e0baf44a30830080d4648e5066a5940f9869))
* **server:** track battery charged energy in rollup reads ([9902ea2](https://github.com/SunReye/SunReye/commit/9902ea2731cb08f9e41ad546f80688f9f17a04ce))
* **server:** statistics preferences endpoints ([27156ca](https://github.com/SunReye/SunReye/commit/27156ca4bdb4b6bf4ebb15d8c5ec5f3a47474eb5))
* **db:** add statistics preferences schema ([57d1e52](https://github.com/SunReye/SunReye/commit/57d1e5272c520238821eea1e63b253a6e6d88239))
* **automations:** use EVCC battery boost to empty the pack ([76bf1ed](https://github.com/SunReye/SunReye/commit/76bf1ede652d50368cad513efae32b9999c2e427))
* **automations:** charge from the grid during negative-price windows ([43b66c7](https://github.com/SunReye/SunReye/commit/43b66c7ab9f532235072bd5428eb1576ad570c85))
* **prices:** add the awattar provider ([158daa0](https://github.com/SunReye/SunReye/commit/158daa0692c5b7b748b6bd9fdcd6488314fbfdf6))
* **cost:** report the export that earned nothing under §51 ([f381172](https://github.com/SunReye/SunReye/commit/f381172db0834812ebcd31ec19a3d3ef928f53bf))
* **automations:** borrow the car as a sink for negative-price windows ([98e8b47](https://github.com/SunReye/SunReye/commit/98e8b474b5013e9dd868b2b412a30dd8cd665d51))
* **web:** configure and observe price-aware charging ([6eb41c1](https://github.com/SunReye/SunReye/commit/6eb41c1322b73e512838ad4e2465cb1f19001711))
* **automations:** hold the battery low ahead of negative-price windows ([74f5693](https://github.com/SunReye/SunReye/commit/74f56934948f39f6010475f4063e7734140d5fd1))
* **web:** edit the market-linked half of the tariff ([e50a4ce](https://github.com/SunReye/SunReye/commit/e50a4ce4936cc622de330eada0c5c124b4d3b82d))
* **tariff:** price energy against the market with a marketing model ([2075caa](https://github.com/SunReye/SunReye/commit/2075caafbaa00c3b398bec1db2729369a11fd9db))
* **web:** show day-ahead prices and negative windows ([1fedb57](https://github.com/SunReye/SunReye/commit/1fedb57b0c3e57bd28bdb74ea75de94411eb9d3b))
* **prices:** add day-ahead spot prices with the energy-charts provider ([48b81ce](https://github.com/SunReye/SunReye/commit/48b81ce27126617514742e644fa2c0e9c0c5a310))
* **automations:** read live-capable status readings from the 1 Hz feeds ([261da4c](https://github.com/SunReye/SunReye/commit/261da4c1213f9d59a15d4d705a5d813a1d6d60a7))
* **automations:** plan projection, decision history, and charting UI for peak shaving ([162d882](https://github.com/SunReye/SunReye/commit/162d882209a07a6997a501136c99042c7b031690))
* add peak-shaving automation engine ([f0bda94](https://github.com/SunReye/SunReye/commit/f0bda944036958b20b244432298badbaf42b67c0))
* **web:** show uncapped PV potential as split bar on forecast chart ([20845b8](https://github.com/SunReye/SunReye/commit/20845b803594cebc79ed9a486137e20952c5fce1))
* **server:** clip past forecast slots from measured day-start SOC ([d75daf0](https://github.com/SunReye/SunReye/commit/d75daf0810e8faccc90be950d68834b28add57e1))
* **evcc:** estimate live charge power between EVCC publishes ([d810bb7](https://github.com/SunReye/SunReye/commit/d810bb7cff76d6f92aa53f26fc595b394a2a6e6b))
* **auth:** add "keep me signed in" option on login ([d75bbb3](https://github.com/SunReye/SunReye/commit/d75bbb3c5e6446c073c00389a3e5b64afe0ca256))
* **web:** make app top header sticky ([f56ed2e](https://github.com/SunReye/SunReye/commit/f56ed2ef70d51bbfe8753bf132e4f5bca574d0e0))
* **web:** forecast-correction settings panel ([219f145](https://github.com/SunReye/SunReye/commit/219f1451c305e8ef1be15d6ffa4088c06f25dc90))
* **server:** learn + apply PV-forecast bias correction ([fc4260e](https://github.com/SunReye/SunReye/commit/fc4260e34cb321cc1222c502bcaf4a2923ff80d2))
* **db:** add forecast-correction tables + config toggle ([6ed9d95](https://github.com/SunReye/SunReye/commit/6ed9d95cfdb71037267002853157abb377a10dfd))
* **web:** log viewer level/source filters and server-level control ([b0f3ed0](https://github.com/SunReye/SunReye/commit/b0f3ed0b6384cbcb5d906c9121a4531c4eb24e50))
* **server:** runtime-configurable and per-category log levels ([e621b2c](https://github.com/SunReye/SunReye/commit/e621b2c522e1069fb7e49ffda107aa34454bcf5f))
* **inverter-core:** sample computed-metric inputs in one atomic read ([fea7f48](https://github.com/SunReye/SunReye/commit/fea7f48eacd16930e488386afc20b268f058e7ab))
* **web:** glide live chart cursor across the feed's sample spacing ([5a17341](https://github.com/SunReye/SunReye/commit/5a1734149441a6fb70cdebcb2ca0bab9474fbc9c))
* **web:** glide animated numbers across the feed's real cadence ([5b8b424](https://github.com/SunReye/SunReye/commit/5b8b424e1c99389795e466305e1f00ef52c08152))
* **forecast:** export raw + usable production forecast over MQTT and API ([574a0c5](https://github.com/SunReye/SunReye/commit/574a0c51d1f26c57e20f209770c97b43f572d68d))
* **web:** lead EV charger card with session kWh + SoC meter ([c990e1e](https://github.com/SunReye/SunReye/commit/c990e1ea40c8d3cb154b2a0d2930861160231602))
* **forecast:** 15-minute solar forecast with peak-power tooltip ([fcb50aa](https://github.com/SunReye/SunReye/commit/fcb50aad899c1f2b8b362cc9217a173df55bece6))
* **forecast:** incidence-angle and wind-aware cell-temperature physics ([d0ed115](https://github.com/SunReye/SunReye/commit/d0ed115f949ff68e27cee142a4c8ed93cb30e378))
* **forecast:** model feed-in clipping + battery in solar forecast ([88974b2](https://github.com/SunReye/SunReye/commit/88974b229ca54846d4a1640ad374d6ed7c2fa508))
* stream server logs to an admin Settings panel ([faeaf08](https://github.com/SunReye/SunReye/commit/faeaf0807b2a7b33fa9fca5c6706b892781f3320))


### Bug Fixes

* **server:** declare openapi-types, Elysia 2's last undeclared peer ([f1583e9](https://github.com/SunReye/SunReye/commit/f1583e940f6e05aa7be477a4f747f70d444242db))
* **server:** wire TypeBox statically so the compiled binary can validate ([34ef44a](https://github.com/SunReye/SunReye/commit/34ef44afb573aaf195122a47441a6f7579c87540))
* **server:** round the request-log duration to two decimals ([d5a87c3](https://github.com/SunReye/SunReye/commit/d5a87c347e34320c1386359586a80882bc18cb0e))
* **server:** restore HEAD on GET routes under Elysia 2 ([886ad63](https://github.com/SunReye/SunReye/commit/886ad6304b405b4bc57de06ff36d0230ed1579cd))
* **server:** the recent-history read no longer 500s on every dashboard load ([5da7c40](https://github.com/SunReye/SunReye/commit/5da7c4067c72ed236c9d1d5c24bff4edc4694af8))
* **automation:** the live limit readback resolves voltage like the target does ([5470d42](https://github.com/SunReye/SunReye/commit/5470d42f9d3fb81a1981d42858b4e3241cc0e573))
* **web:** type the node-trigger helper for a pattern, not just a string ([9a83369](https://github.com/SunReye/SunReye/commit/9a83369697efe812bc719236067f6097d7e80d13))
* **web:** stub the battery-health read in the browser layer ([dcdf2d0](https://github.com/SunReye/SunReye/commit/dcdf2d0568bf69cf3710977abb2882cf8714a0e3))
* **web:** accent stops being an alias of primary, which made selects unreadable ([b90af82](https://github.com/SunReye/SunReye/commit/b90af82dcbd10382faf0dbfb812052bd59f24f79))
* **web:** carry the pack voltage forward instead of explaining where it went ([0235af8](https://github.com/SunReye/SunReye/commit/0235af8b8b4c390c60ff50600bed385d9451da96))
* **addon:** keep raw in the default backup once the minute tier is frozen ([3d159df](https://github.com/SunReye/SunReye/commit/3d159dfd0e3b1c8d88716f90f857502dc8dac944))
* **web:** tolerate a manifest with no storage, and teach the e2e fixture the field ([a388f9e](https://github.com/SunReye/SunReye/commit/a388f9ebbac42177870413038449c30cf7970dbe))
* **ci:** run the cutover assertion from apps/server, where its deps are declared ([78d6beb](https://github.com/SunReye/SunReye/commit/78d6beb337b42073d821d158374d83b500b119ad))
* **ci:** materialize the weighted tiers in the restore fixture ([eeadfec](https://github.com/SunReye/SunReye/commit/eeadfec886cc115003430314e11aabdc2a0c78da))
* **ci:** import the db by path in the weighted-rollups gate ([56dfe1f](https://github.com/SunReye/SunReye/commit/56dfe1fbf57a78d9ac37db62ef26717725ab0097))
* **db:** make the retention change reach an existing database, and prove it ([780c767](https://github.com/SunReye/SunReye/commit/780c7675f43cf8d8755aec62ece6f2907494b845))
* **server:** carry the held value into the live backfill window ([f504120](https://github.com/SunReye/SunReye/commit/f50412036b7e70a64111089937368f4bf90d5893))
* **addon:** derive the backup's raw-data exclusion from the live retention policy ([c6e68aa](https://github.com/SunReye/SunReye/commit/c6e68aac4a2364b9461e6389525ceac92771db4f))
* **energy:** pin each role's kWh derivation, and a counter-restart hole (#115) ([a8b5f55](https://github.com/SunReye/SunReye/commit/a8b5f55f19d0a2f3b3b7aa02efbcc90d5c84aaa4))
* **inverter-core:** three holes an adversarial pass found in the http arm ([9cad2d8](https://github.com/SunReye/SunReye/commit/9cad2d85c53fe2dde8d93b66f26f42ad7a63b113))
* **addon:** exclude compressed chunk data from a non-full dump ([2ec3ec3](https://github.com/SunReye/SunReye/commit/2ec3ec3871ce88981c5977ae73dd2456bec5a2f9))
* **ci:** stop retention deleting the restore fixture mid-test ([aba10ab](https://github.com/SunReye/SunReye/commit/aba10abad32d0e62db1058a5cbf644007d33f4da))
* **ci:** pass DATABASE_URL to dump.sh in the restore test ([bd3a308](https://github.com/SunReye/SunReye/commit/bd3a308221818c2d92e6e9f62ec22d58bd4c84c1))
* **server:** validate every write in the funnel, and pre-flight presets ([15a3a77](https://github.com/SunReye/SunReye/commit/15a3a77063b59ed9c3a8129af802785b446cc38d))
* **inverter-core:** never fabricate a reading, never wrap a write ([7f0586b](https://github.com/SunReye/SunReye/commit/7f0586beeec74471bf6c85deafa762632ecd576b))
* **web:** the desktop toolbar is one line of controls, one height ([4dd2ed1](https://github.com/SunReye/SunReye/commit/4dd2ed107a670d452ca8d8f13bb43b279eb819e0))
* **web:** one place for a panel's controls, and one width for the navigator ([c6e1a4c](https://github.com/SunReye/SunReye/commit/c6e1a4cfa355a1343bb42ddccce6e6ecf2d2954f))
* **web:** stat tiles stop drawing a second box on a phone ([2e22f51](https://github.com/SunReye/SunReye/commit/2e22f514b28bdd529dec347b62651d67bf33137b))
* **web:** stop the calendar's today marker reading as a selected day ([22d9aa1](https://github.com/SunReye/SunReye/commit/22d9aa107b4c60007498fac99b2dd2948dd57fcf))
* **web:** build inclusive day ranges from date parts, not +86_400_000 ([ed8a520](https://github.com/SunReye/SunReye/commit/ed8a5209b2ee0e5de6eb73c6726a8bc70673a6c7))
* **web:** read the buffers untracked when sizing the backfill ([419c1a2](https://github.com/SunReye/SunReye/commit/419c1a27d024d9a85f851f249b62ee46a669484a))
* **web:** a charge's glow stops being cut off at the safe box ([0d2c783](https://github.com/SunReye/SunReye/commit/0d2c783fa7050d2222e7f53b0aa382cb217bf7d6))
* **web:** a rising plant stops writing storage at the feed's cadence ([952ee98](https://github.com/SunReye/SunReye/commit/952ee9897596e3a82af05c0a5047753372972686))
* **web:** the ceiling stops invalidating the effect that folds it ([a930f00](https://github.com/SunReye/SunReye/commit/a930f00e130ce9506e97b83432e92da3cf0c2bd4))
* **addon:** serve the multiplexed live socket at exactly /ws ([ab06deb](https://github.com/SunReye/SunReye/commit/ab06deb285fb5bda0d08b8e84016d32cd41d07be))
* **web:** close the gaps an adversarial review found in the palette work ([c8cc39b](https://github.com/SunReye/SunReye/commit/c8cc39ba8618893c412c71174cf382583c0c6607))
* **web:** paint fixed meanings from the semantic set, not the palette ([8061145](https://github.com/SunReye/SunReye/commit/8061145f70b59731e245cc3be8811e9c61c6a349))
* **web:** let an expanded chart escape a transformed ancestor ([4b1c066](https://github.com/SunReye/SunReye/commit/4b1c066492126a0efab2ce5a814d36873b7e653c))
* **web:** let Escape close the layer on top, not the card under it ([f88a48d](https://github.com/SunReye/SunReye/commit/f88a48d2e3ccaa01283580a4c7a61046b070b3a5))
* **web:** full-screen the document, not the card ([3f1f1b4](https://github.com/SunReye/SunReye/commit/3f1f1b4c373076a52876e0714231b03cb778d09e))
* **web:** give the live sparkline's measuring box a height ([65582be](https://github.com/SunReye/SunReye/commit/65582bed3d39a8e85f1fbba8bc300cab9176c2b9))
* **web:** narrow the last seven chart gutters on a phone ([5d2d2fa](https://github.com/SunReye/SunReye/commit/5d2d2fa026a5544b92c1f2ffb8f89966304feb5f))
* stop the charge-current round-up eating exportable PV, and finish the card migration ([3cdadfe](https://github.com/SunReye/SunReye/commit/3cdadfec95bbaa412034355159c319ec6519bdf8))
* **web:** stop the automations card overflowing a phone ([1237d38](https://github.com/SunReye/SunReye/commit/1237d385eeeb4628942358adc5d5b74ddd2caefb))
* **server:** align the energy day chart extent with the cost series ([9d15260](https://github.com/SunReye/SunReye/commit/9d15260a0f1a97359c7c0fd592707cc43f10c662))
* **web:** cap the select dropdown height so long lists scroll ([1718f01](https://github.com/SunReye/SunReye/commit/1718f01aed7248473d0fe50a3916bdfd5fba85c1))
* **web:** type the chart-axes gap fixture so svelte-check passes ([a9e1d3b](https://github.com/SunReye/SunReye/commit/a9e1d3b8db15c396ec1c1f376b7646d0982faa64))
* **web:** report slot-average power consistently in the solar-forecast dialog ([28ec5fe](https://github.com/SunReye/SunReye/commit/28ec5fe53489a9343cc96de75cdc5d6ddfeb9ace))
* **server:** bucket plant-local periods by a configured time zone, not the host ([6edf217](https://github.com/SunReye/SunReye/commit/6edf217a684b1116f4a944a1dd6a94f6f3c38ee9))
* **web:** stop the forecast dialog reporting unmeasured slots as zero production ([5e05163](https://github.com/SunReye/SunReye/commit/5e051634e59865f631ccfd47bf103d439c90bb42))
* **test:** stop the suite depending on which file the runner reaches first ([487ea8c](https://github.com/SunReye/SunReye/commit/487ea8cb24f83417565dd2d3c72b9782fc091ae7))
* **server:** never let ambient git plumbing redirect our git calls ([db8225e](https://github.com/SunReye/SunReye/commit/db8225e9869552f6eda5a2cb565d835b757c50db))
* **web:** never render a tile against an empty response body ([6c40a8b](https://github.com/SunReye/SunReye/commit/6c40a8bb6302c2f911de9d895ff52a8a977ba4ba))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))
* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **web:** keep the heatmap panel when a metric has nothing to show ([40d3e6c](https://github.com/SunReye/SunReye/commit/40d3e6cb6c40883ea4cc5db26d42f3ab7170252f))
* **statistics:** chart the whole calendar month, and only that month ([745fac5](https://github.com/SunReye/SunReye/commit/745fac5134fcb7f49dc05c2b81d5e9f66b920abe))
* **web:** hit-test the heatmap per cell and wash the hovered one ([48ed60a](https://github.com/SunReye/SunReye/commit/48ed60abc6060c1462d12048d4c1f4850b73f47c))
* **web:** label energy periods with the bucket they were fetched at ([20c30df](https://github.com/SunReye/SunReye/commit/20c30df53db39541eea952000bb133b90af89196))
* **web:** patch layerchart's unclamped stacked-bar height ([e3c691a](https://github.com/SunReye/SunReye/commit/e3c691a2a00d4746fb38edfb6d9883d4e85ed1b0))
* **server:** include today's live registers in month- and year-to-date ([71561a7](https://github.com/SunReye/SunReye/commit/71561a7f2a838093d885dfa1fe0411751970cf5b))
* **server:** never bill a recording gap to the hour it ended ([32c28a8](https://github.com/SunReye/SunReye/commit/32c28a8afe2abd3b52086069c257467a99fbf38c))
* **web:** make the negative price windows visible and consistent ([3313220](https://github.com/SunReye/SunReye/commit/3313220c6b40a9dd4fee1f47ccb524395c6aef61))
* **web:** statistics layout at narrow widths and in sparse windows ([5121ce6](https://github.com/SunReye/SunReye/commit/5121ce67aa1a1f15bcdf4dbacd98201d44e1bc72))
* **server:** one market average, one definition of self-consumption ([2a6b8f9](https://github.com/SunReye/SunReye/commit/2a6b8f9fd83d4c22b71ac3723cd8846bafd565a3))
* **web:** pluralize price copy and cap runaway deltas ([42c978d](https://github.com/SunReye/SunReye/commit/42c978dd44c85950a3d9786c821c5ad5482c48e6))
* **web:** format statistics dates and figures in the UI locale ([3900cb7](https://github.com/SunReye/SunReye/commit/3900cb75b714f8ce9b4821c3b9499734179604d6))
* **web:** drop empty segments from the cost bar stack ([028eaf7](https://github.com/SunReye/SunReye/commit/028eaf776c289c52b747d7deee7685805822ae66))
* **web:** render canvas chart marks and labels correctly ([1057920](https://github.com/SunReye/SunReye/commit/1057920793624326db33d2bf934abda07af585c2))
* **automations:** derive EV demand when EVCC reports none ([619c4f3](https://github.com/SunReye/SunReye/commit/619c4f301845da5a33325079522f324674a97f4e))
* **server:** keep the effectiveness watchdog quiet on a near-full pack ([f80fba0](https://github.com/SunReye/SunReye/commit/f80fba072b372a1cf7716ef64c3432dd87293059))
* **web:** anchor the decision countdown on frame arrival, not server time ([2307cee](https://github.com/SunReye/SunReye/commit/2307cee9ff59e716dcc69a33b9a88c81aff3faf3))
* **web:** glide the custom live chart across the feed's sample spacing ([e086da1](https://github.com/SunReye/SunReye/commit/e086da1109a73439b87d29fd1fcfa15f39aa3223))
* **web:** let live EVCC state reclaim the limit slider after a commit ([57fc330](https://github.com/SunReye/SunReye/commit/57fc330c3f41b937a1de37d78c07928114f1a1d3))
* **evcc:** read the charge limit from the effective/vehicle topics ([dbfb00d](https://github.com/SunReye/SunReye/commit/dbfb00d4d6c6fbc2fa0debff9c383b0478456b83))
* restore ControlLock and make bun test load the env-gated suites ([3ab4c86](https://github.com/SunReye/SunReye/commit/3ab4c8600c6f10ccfafae1f77ef8892dfb0d145f))
* **docs:** give the astro link-rewrite suppression a reason ([70e96b1](https://github.com/SunReye/SunReye/commit/70e96b145e229f92f9e312d463735ce0e1d49a1a))
* **inverter-core:** close dead-code findings on the authoring surface ([adcdc0c](https://github.com/SunReye/SunReye/commit/adcdc0c82eaabbd9c6b28cb942b3134314bbceba))
* **web:** export leaked types and give a suppression its reason ([0bd66d9](https://github.com/SunReye/SunReye/commit/0bd66d9c128c02d527b1e88396bf37beb65295c8))
* **server:** harden forecast-correction learning ([58d33d8](https://github.com/SunReye/SunReye/commit/58d33d8ccfff9b0442317f189b641d2f4bd8ce55))
* **web:** correct Array.from type arguments in solar-forecast dialog ([a34d777](https://github.com/SunReye/SunReye/commit/a34d777464bd64ce8200a1279cef5f3196e69652))
* **forecast:** integrate instantaneous irradiance per clock hour ([3e772de](https://github.com/SunReye/SunReye/commit/3e772de9f864d4aa9952af505acd4dccb62d0020))


### Performance Improvements

* **e2e:** run the browser suite fully parallel and sharded, and drop the measurement layer ([44d1e65](https://github.com/SunReye/SunReye/commit/44d1e659cf4fba46a27b5fc789ed688b5a5cd49d))
* **test:** run the suite with --parallel, and say why coverage must not ([6a5f738](https://github.com/SunReye/SunReye/commit/6a5f73838722d0bb0cee705c0458e374d0bcc749))
* **db:** compress after 2h, checkpoint every 2h, compress WAL with zstd ([42bac87](https://github.com/SunReye/SunReye/commit/42bac87c62ab92f3f9085d367e687e766dfc4b84))
* **web:** build each chart once, at a width it can actually use ([db697a8](https://github.com/SunReye/SunReye/commit/db697a84bb03e0f55dae223edbf71b16e5d60988))
* **web:** build a chart when the reader stops, not when they scroll past ([c077445](https://github.com/SunReye/SunReye/commit/c0774452f2e89c5aebff5eaa1113b616da79ae7a))
* **server,web:** bucket the sparkline backfill and resume from the gap ([d9a66b8](https://github.com/SunReye/SunReye/commit/d9a66b826c450ec6d60d66145f9e487d1778917b))
* **web:** stop the live charts repainting on every frame ([82399f5](https://github.com/SunReye/SunReye/commit/82399f5777f8174f11be68804f00d801772d6503))


### Documentation

* match the re-derived retention shape ([c5eed53](https://github.com/SunReye/SunReye/commit/c5eed53d14421500d55653df64b46c44d85b22ac))
* **profiles:** document the storage class and the deadband ([d6c76ce](https://github.com/SunReye/SunReye/commit/d6c76ce88cd5f3cf6d51f4170c1337b2ffad415a))
* rewrite the storage section around change-only storage ([bc476ca](https://github.com/SunReye/SunReye/commit/bc476caceaa9b0bd7f30cd0eaf69aec8f3d941b8))
* **plans:** record the power-flow energy pulses design ([0b4f1b5](https://github.com/SunReye/SunReye/commit/0b4f1b5d940407cce4ee8d9dc2478e89a057bc0f))
* **web:** motion carve-out for the power-flow diagram ([968b29c](https://github.com/SunReye/SunReye/commit/968b29ce9c76c041936ef2163f32dd994476e4a9))
* **web:** write down the full-screen vocabulary ([697b882](https://github.com/SunReye/SunReye/commit/697b882e1e3c92dcaaee726c228f8fdce1fa5e8a))
* **web:** write down the gesture contract and the testing lesson ([6aac5ca](https://github.com/SunReye/SunReye/commit/6aac5cab864908534bed8a45edb4009806a32dec))
* add a contributor guide covering the release flow ([02e8aeb](https://github.com/SunReye/SunReye/commit/02e8aeb6c58e4c0a80221ca8ce8dc13aa7e1ddda))
* document the dev branch and the beta addon channel ([e7a6194](https://github.com/SunReye/SunReye/commit/e7a6194e2176751c892c6dfd7590d57c567f6599))
* update costs page docs for the statistics rename ([aedbd9f](https://github.com/SunReye/SunReye/commit/aedbd9f6d56d86caea2c103f3fa3cb6bad69ecd1))
* **evcc:** describe the three-layer charge limit ([a1f59b9](https://github.com/SunReye/SunReye/commit/a1f59b960afabfbd84daab74d6b9c0fb12f82caf))
* **plans:** mark phase 6 fallow ratchets and CI gate done ([992df93](https://github.com/SunReye/SunReye/commit/992df93db71bea0822635bb472943386858ad38b))
* **plans:** correct status and record the CI wiring research ([1e43b14](https://github.com/SunReye/SunReye/commit/1e43b140d659087b8087ad3852d8c78acf7f2b67))
* **plans:** record the completed strict-fallow burn-down ([d38865c](https://github.com/SunReye/SunReye/commit/d38865c8f55406a46794b85564e9236dd816ae16))
* **plans:** correct the effective CRAP ceiling to cyclomatic 4 ([09e87ef](https://github.com/SunReye/SunReye/commit/09e87ef5907e884675736c49d4ba2329753d3561))
* **plans:** record the rejected coverage spike and CI gap ([9033c7d](https://github.com/SunReye/SunReye/commit/9033c7d92b4d63fa12bb26d847505b5b49500bce))
* note past-hour clipping reconstruction in forecast settings ([77b7020](https://github.com/SunReye/SunReye/commit/77b70204f07e226865166c49c87a7993e431e972))
* document Weather & Forecast settings + learned correction ([0bfc727](https://github.com/SunReye/SunReye/commit/0bfc72719a31e39b02e77906c67dc732358ad175))
* **plans:** add multi-brand modbus engine plan (register spaces, word order, sunspec SF) ([77d49f6](https://github.com/SunReye/SunReye/commit/77d49f66a89da40b66009308980ce6fba6e53704))
* document atomic reads, log levels, and the Logs settings tab ([3dcfa6f](https://github.com/SunReye/SunReye/commit/3dcfa6fd9f6f7ebe3ccbda5636ef1450277d037f))


### Code Refactoring

* **server:** embed the web build with --asset ([63f8133](https://github.com/SunReye/SunReye/commit/63f81331b406bdd5670b4234f377f5c598e38393))
* **web:** settings fields explain themselves in a popover ([ed1ebb1](https://github.com/SunReye/SunReye/commit/ed1ebb166115ff9b323276db3654d88668989cc1))
* **web:** move the plant's own settings off the weather page ([3b405e7](https://github.com/SunReye/SunReye/commit/3b405e7024015c329cc95fcde7efad06a12569a6))
* **server:** the history buffer commits through an injected callback ([fd38239](https://github.com/SunReye/SunReye/commit/fd38239ad50a1bd0c4fb45d2b4c588797a5e0a14))
* **inverter-core:** split decode into addressing and scaling ([cad040e](https://github.com/SunReye/SunReye/commit/cad040ed7ef72292b2375a9cf37cc632e528676a))
* **inverter-core:** tagged Binding union and a transport seam ([0c3a239](https://github.com/SunReye/SunReye/commit/0c3a23909ab73816fb5c2f90a6ffc1988c1f38bf))
* **profile-sdk:** split replay by concern to clear the health gate ([a0fbf1c](https://github.com/SunReye/SunReye/commit/a0fbf1c17dd99cd0067727f608410e3ed2bd49a5))
* **web:** one header grid and one readout row per chart card ([14dad81](https://github.com/SunReye/SunReye/commit/14dad8144e4dd0d9c4dbaa3defa42e5f70eb9ab0))
* **web:** a charge is a bead chain, and its speed is the reading ([1ffd393](https://github.com/SunReye/SunReye/commit/1ffd3934288b64eebfbc0ed3ec416bdee7c1a9c5))
* **web:** rails shoot pulses instead of dashes ([fb29f34](https://github.com/SunReye/SunReye/commit/fb29f34490fd813935e719f9e7c37e21d9207cbe))
* **web:** direction and judgement colours become tokens ([e488ae9](https://github.com/SunReye/SunReye/commit/e488ae9d64505df0e6948cddacf1ea8d991b29dc))
* **web:** draft controls are icons, without the caption ([6e44599](https://github.com/SunReye/SunReye/commit/6e44599329814bfeec6b52d6104eb04b535aff7d))
* **web:** one renderer for an overlaid chart ([e2cd65b](https://github.com/SunReye/SunReye/commit/e2cd65baaf2344b370a3455256ffef51b6a6c8bd))
* **server:** retire the five legacy websocket routes ([33ec667](https://github.com/SunReye/SunReye/commit/33ec6678d46c76b8ae34b83bc0fb27a4c5dfdca6))
* **server:** one source for the physical export cap ([fba3e4c](https://github.com/SunReye/SunReye/commit/fba3e4c8fc05549fa6ac191eb74cd4a9c828ba43))
* **web:** put the whole app on the layout system, and open it up on a phone ([828f720](https://github.com/SunReye/SunReye/commit/828f720ba90e046a493a1d08340f6c6c018d77fa))
* **web:** one owner per live value ([be34538](https://github.com/SunReye/SunReye/commit/be34538daaaff82ca91d8437c4edcafa1c6fc1e0))
* **web:** every live store reads from the bus ([fe26b17](https://github.com/SunReye/SunReye/commit/fe26b17d0869a6e32bdabb00378007fe09b5debf))
* **server:** extract the runtime control writer as an injected collaborator ([e314497](https://github.com/SunReye/SunReye/commit/e314497e64a4de9f36aaedf99d63900790429a0f))
* **server:** extract the runtime job scheduler as an injected collaborator ([5056585](https://github.com/SunReye/SunReye/commit/505658569d9dd303fe3f44dccf9025e4e0854cb7))
* **server:** extract the runtime history buffer as an injected collaborator ([d700bb6](https://github.com/SunReye/SunReye/commit/d700bb65579ce570b35bf31bc754d4bddd93fb57))
* **contracts:** move automation wire types out of server ([21a0129](https://github.com/SunReye/SunReye/commit/21a0129e9a548abe0c8bdc23baf2b22889207c84))
* **contracts:** move evcc and log wire types out of server ([28f5463](https://github.com/SunReye/SunReye/commit/28f5463063654c5a064d9d2a1eb99463d26b062a))
* **contracts:** move spot-price wire types out of server ([c67d510](https://github.com/SunReye/SunReye/commit/c67d5101eecbc2823b2b03d37e9a294acdf92f43))
* **contracts:** move statistics wire types out of server ([16e6e4f](https://github.com/SunReye/SunReye/commit/16e6e4fc8b8a62a1a6d0a7e3d15e767cb028a0ec))
* **contracts:** move energy wire types out of server ([78280a3](https://github.com/SunReye/SunReye/commit/78280a3a22617bf1a9567305ce05141189bb2cd7))
* **inverter-core:** make capability derivation table-driven ([8350b92](https://github.com/SunReye/SunReye/commit/8350b92d7781006e22171eba5b44b18c54bb1d3b))
* **server:** make the runtime a factory ([1adf9ce](https://github.com/SunReye/SunReye/commit/1adf9ce178812554fd8f68c17396be371bd3c4a0))
* **server:** unify the read-side stream sinks ([4da084b](https://github.com/SunReye/SunReye/commit/4da084b76a91a22d1eebc74e19bf00f4c3afca8a))
* **server:** group src into feature folders ([0bd68b5](https://github.com/SunReye/SunReye/commit/0bd68b5327774e069e7b733eca280ef5c675e20b))
* **web:** per-chart view scope for statistics ranges ([e775066](https://github.com/SunReye/SunReye/commit/e775066aea8ab914f202c1e3ff9f4dc4d2f9b221))
* **web:** registry-driven statistics tiles and section shells ([7be1575](https://github.com/SunReye/SunReye/commit/7be157560e9a4adfeabe5db16f7beb9a98b724dc))
* **web:** extract cost formatters to $lib/cost/format.ts ([1ef1f96](https://github.com/SunReye/SunReye/commit/1ef1f9602f14dc0f7902466697a49a4c8d91b2b4))
* **server:** take the feed-in ceiling as a parameter, not off the inputs ([537b3f1](https://github.com/SunReye/SunReye/commit/537b3f15091811faf82fca5b4580720c4845f21f))
* **server:** give forecast slot geometry its own module ([ff3ec41](https://github.com/SunReye/SunReye/commit/ff3ec41cf7dc6a3506358f13d30ec7aac69e4f39))
* **evcc:** converge the limit slider on EVCC's republish ([e19142e](https://github.com/SunReye/SunReye/commit/e19142e60ec869a81d4be9320c9fa465cb834c5e))
* **server:** extract cache lookup and build from fetchSolarForecast ([da96ee7](https://github.com/SunReye/SunReye/commit/da96ee70512ff5500debca753574bcaeb824bb56))
* **server:** extract per-source browse into syncSourceProfiles ([16c981b](https://github.com/SunReye/SunReye/commit/16c981bb87ac6b1ff5d2d8b3debf7708afe134cf))
* **server:** extract slot-width math from surplusAboveKwh ([dfc33a2](https://github.com/SunReye/SunReye/commit/dfc33a2a74df48c1a7cf59285a11e4383ce40733))
* **server:** split snapshotToggle into engage/release helpers ([5448da9](https://github.com/SunReye/SunReye/commit/5448da9834c7d6f54d7d3056f12c1fac5cad5128))
* **profile-sdk:** separate CLI reporting from command orchestration ([cf8d421](https://github.com/SunReye/SunReye/commit/cf8d4211b48123fd8198f29c44d66044e9dbf28f))
* **server:** flatten renderMessage into a per-value helper ([55a291a](https://github.com/SunReye/SunReye/commit/55a291af79c7da8d57df6927cea951b45093c999))
* **auth:** un-export createAuth in favour of the auth singleton ([2dcdeaa](https://github.com/SunReye/SunReye/commit/2dcdeaa206b36c10babc6190420c5055e01d508f))
* **db:** shrink the config modules' export surface ([7813337](https://github.com/SunReye/SunReye/commit/78133379d95a6d4063f5c9c1464975d3d8007136))
* **inverter-core:** split overlay resolution out of deriveMetrics ([7892f62](https://github.com/SunReye/SunReye/commit/7892f623ecce842032424e87d9a0260f26cce5b3))
* **server:** rename CostRange to CostRangeKey ([b3c1ed6](https://github.com/SunReye/SunReye/commit/b3c1ed6e200a4420296a12556f161efadef731f1))
* **web:** split the TOU timeline into its visual parts ([a2bf573](https://github.com/SunReye/SunReye/commit/a2bf573005d1ef75a76900aecd80c25f410c2ba7))
* **web:** give the custom-chart section one job per piece ([79bdc6f](https://github.com/SunReye/SunReye/commit/79bdc6f0285446dc18ab291d1bd66d887d422ad0))
* **web:** split the EV charger tile by role ([36c055d](https://github.com/SunReye/SunReye/commit/36c055d2f38c995b23ec1b9414cde053ff2220a6))
* **web:** collapse the TOU table's four editable columns into one cell ([d2c6021](https://github.com/SunReye/SunReye/commit/d2c60214f3704aaaf1e9b2f78b72ebbe554f5faf))
* **web:** drop the now-unused Button import in users-form ([339f75e](https://github.com/SunReye/SunReye/commit/339f75ec6150b9592d926f41f33e30f10aa378b0))
* **server:** flatten the remaining complexity hotspots ([cf2b1f9](https://github.com/SunReye/SunReye/commit/cf2b1f95bcbaa460d06a3ecb8518b193402eb6e8))
* **web:** move the settings nav out of the layout ([5eb8f29](https://github.com/SunReye/SunReye/commit/5eb8f29523ab7cc1221339948285cccf7fe2cd24))
* **server:** share the open-meteo request plumbing ([59c1059](https://github.com/SunReye/SunReye/commit/59c10591eae82e995325af140ba8d4022866ee6f))
* **server:** share one helper for admin config writes ([6bad84c](https://github.com/SunReye/SunReye/commit/6bad84c8a8e6166de24d26cef47ddd48a26616c3))
* **web:** extract the metric picker and the TOU slot field ([5ca867a](https://github.com/SunReye/SunReye/commit/5ca867afdba307f5a95728156eccaafe446cdb2f))
* **web:** normalize the tariff response in named steps ([a91d2f5](https://github.com/SunReye/SunReye/commit/a91d2f56c225ae31aee1be91b52de0a7080808af))
* **web:** give the chart cards one placeholder and one plot ([41850f7](https://github.com/SunReye/SunReye/commit/41850f74cb5ebed5cfa23f904f8c6819e4eb8d8e))
* **web:** extract PV array and sensor group rows ([3cb2d13](https://github.com/SunReye/SunReye/commit/3cb2d13ac807979017d6300ba033dc822a9940c9))
* **web:** split the MQTT panel's EVCC section and status badge ([d7ecd15](https://github.com/SunReye/SunReye/commit/d7ecd155dee790c21b1922bed85575393a10bc88))
* **web:** split the power-flow rails and hub pill into components ([f164e79](https://github.com/SunReye/SunReye/commit/f164e794ba51abaa6d8f88091de42fbf13689e86))
* **server:** split pure logic out of the big server modules ([23e4c68](https://github.com/SunReye/SunReye/commit/23e4c68a3a88672b8733c31fc6a0a95bf9d4266f))
* **web:** split the inverter panel into fields and status badge ([ba07c19](https://github.com/SunReye/SunReye/commit/ba07c19c1039e0c9eeff12a4e32301ae915b874c))
* **web:** table-drive cost presets, flatten format and sidebar branches ([7d6c7ee](https://github.com/SunReye/SunReye/commit/7d6c7ee29730138f54ec16a61531c122cde028b5))
* **web:** extract the history page's metric group ([f2a2e14](https://github.com/SunReye/SunReye/commit/f2a2e1405e85264aa4788880d151a6a731afbf4b))
* **web:** split the live-metrics store's sample handling ([214de3c](https://github.com/SunReye/SunReye/commit/214de3ce2df7348236cfae2b36015cb26d40e550))
* **web:** make the weather tile's shared body a component ([43e6f0f](https://github.com/SunReye/SunReye/commit/43e6f0fedde059873f4c7e592d3b3f9a24d03446))
* **web:** split the log panel into toolbar and body ([abaa99d](https://github.com/SunReye/SunReye/commit/abaa99da23edfa4f8ad7a033f06c7b85bfa6f5ac))
* **web:** make the energy cards table-driven ([ea49b22](https://github.com/SunReye/SunReye/commit/ea49b22c4cd3e3de03d9a26c7bc50f6adac7352b))
* **web:** split the weather form's parse and load steps ([c28d350](https://github.com/SunReye/SunReye/commit/c28d350695d9ed3e47a63d74587e12cc9f65b63c))
* **web:** name the TOU timeline layout steps ([9b651d0](https://github.com/SunReye/SunReye/commit/9b651d0cbb17ef3d56ea2b54f71529267cdc7618))
* **web:** flatten the auth form and controls page conditionals ([5d33f9e](https://github.com/SunReye/SunReye/commit/5d33f9ed3e930975615cddb1460ecf52404cecd5))
* **inverter-core:** extract the register-width lint from superRefine ([a055af7](https://github.com/SunReye/SunReye/commit/a055af71f5d7c630adff72b25155dddba8d7f8e7))
* **inverter-core:** split genericSimulate into per-subsystem stages ([fd91b8d](https://github.com/SunReye/SunReye/commit/fd91b8d151dd73ae7741d87e9ca11849158eb720))
* **inverter-core:** split the atomic read planner into its three phases ([a303973](https://github.com/SunReye/SunReye/commit/a303973da4105ed59c4832b0d3d7407690acbcd0))
* **inverter-core:** separate raw register decoding from scaling ([8e93edc](https://github.com/SunReye/SunReye/commit/8e93edc3adf87d8d13884b34ea1e5ba322f69de2))
* **inverter-core:** split pruneComputeExpr per expression kind ([844d405](https://github.com/SunReye/SunReye/commit/844d4056d3c7ffd6f432a8c69d4f88d5877a0e65))
* **web:** extract the setup wizard progress rail ([9f09352](https://github.com/SunReye/SunReye/commit/9f09352c4e7ae03bcc22236756846e8e129c0fbd))
* **web:** extract the app shell's access state machine ([e33e2ba](https://github.com/SunReye/SunReye/commit/e33e2ba64ddfee649c9d7a6701f1639f7198d429))
* **web:** split the profile browser lists into row components ([5d94005](https://github.com/SunReye/SunReye/commit/5d9400585c99c19303c0084c80e9c17efa21aaa8))
* **web:** split the two measured-production paths in the forecast dialog ([427b14e](https://github.com/SunReye/SunReye/commit/427b14e939780a19a7f7d211452155821917ab37))
* **web:** split per-state widgets out of node and control rows ([d850e70](https://github.com/SunReye/SunReye/commit/d850e70381f9b4f6b99acc9f425b569a24f56132))
* **web:** split the costs page into tiles and band sections ([5185563](https://github.com/SunReye/SunReye/commit/5185563ea2433927975899d3947e58a47ccc77df))
* **web:** extract the shared profile list row ([1929ab7](https://github.com/SunReye/SunReye/commit/1929ab7fae0de5e3d29876217b160516fd6f6bc9))
* **inverter-core:** share MetricBase between MetricDef and MetricDataDef ([66f4c39](https://github.com/SunReye/SunReye/commit/66f4c39fc8dea50b13e675308a0c388651d2d765))
* **web:** lift conditional values out of chart tile markup ([112ad65](https://github.com/SunReye/SunReye/commit/112ad656fc09e0970c1d8fdc9247b9c3de4dd1f4))
* **web:** make the system page's subsystem grid data-driven ([ceb4bb5](https://github.com/SunReye/SunReye/commit/ceb4bb51b5971985140643ebec22bb3d06d7ee59))
* **web:** extract shared settings table and create-row form ([07c9f81](https://github.com/SunReye/SunReye/commit/07c9f81e516b228448cd1f84648786222d6c8a5d))
* **web:** derive settings action bar labels in script ([720ef92](https://github.com/SunReye/SunReye/commit/720ef9279c18d73cb5b1304db959743dfb85ad16))
* **db:** extract shared created_at/updated_at column builders ([4b68991](https://github.com/SunReye/SunReye/commit/4b68991306c05ae0e27c5c26252c65f15e4dfb81))
* **web:** share the settings API error text helper ([51ce9cf](https://github.com/SunReye/SunReye/commit/51ce9cf182af2d4e1b3fd40a05ed590ff6dee645))
* **web:** extract shared dashboard chart helpers ([7bf17da](https://github.com/SunReye/SunReye/commit/7bf17daf4ea0b0cb1e8a6e0883690a947d095335))
* **web:** decompose buildPowerGraph into graph parts ([91786ac](https://github.com/SunReye/SunReye/commit/91786ac6421dba47dae1ac952fc2d149129789f2))
* **web:** use shared parseNum in weather form ([ef8639c](https://github.com/SunReye/SunReye/commit/ef8639c9fd412f3810c8bd8c8e7500a0ca4220b1))
* **web:** extract shared reconnecting-socket helper ([de63784](https://github.com/SunReye/SunReye/commit/de637847b60b5a26f5f6f84629f3d69fbeb3b722))
* **web:** rename settings tab to "Weather & Forecast" ([c96346a](https://github.com/SunReye/SunReye/commit/c96346ae584086f058311403b910a6efca95f406))
* **web:** square power-flow diagram to match boxy UI ([f335ca5](https://github.com/SunReye/SunReye/commit/f335ca5faf27cae25e0e346032458a229afc7078))


### Tests

* **server:** build the test database once per process ([c5ce219](https://github.com/SunReye/SunReye/commit/c5ce219b9500d49505df1cf08f101e0843a7a1a5))
* **server:** add a database-backed query test layer ([8755b0d](https://github.com/SunReye/SunReye/commit/8755b0d7f0ffdb19a38e517d8324b3994dd1f538))
* **ci:** the database workflows assert the frozen minute tier, not the old one ([87fa788](https://github.com/SunReye/SunReye/commit/87fa7881e3d79d1d711dae6507383de74242e94e))
* **server:** teach the runtime's buffer doubles the dropped-row counter ([6730706](https://github.com/SunReye/SunReye/commit/6730706118ab5d755219dbf2df2658892e416549))
* **db:** a real-database gate for the weighted rollups ([5a7cec5](https://github.com/SunReye/SunReye/commit/5a7cec51ba8cecca224c4f9e42e0289921a5cf01))
* **db:** actually restore a dump in CI and assert parity ([54cd5c5](https://github.com/SunReye/SunReye/commit/54cd5c551057b0be8952cd8f56578614a542e37d))
* **web:** measure a chart's mount cost, not the scroll around it ([de4cd42](https://github.com/SunReye/SunReye/commit/de4cd4246a506fb7d20867322a191619f628d123))
* **web:** cover every route in the browser layer ([d555e9d](https://github.com/SunReye/SunReye/commit/d555e9d878e6d4d2ed36b321206a886c4a464e56))
* **web:** add a browser test layer, and stop proving things with regexes ([d4ed34b](https://github.com/SunReye/SunReye/commit/d4ed34bcc0e6bee3ea09b14ee2f6159fa23f21c7))
* **web:** pin the ring's swing to zero at an idle plant ([9e23125](https://github.com/SunReye/SunReye/commit/9e231252a3354c50fa1cab4ebd54cd52f6714484))
* cross the client/server seam the deleted REST primes relied on ([a368585](https://github.com/SunReye/SunReye/commit/a3685856301aea4f14f89ecce60428e11fe3ff4d))
* **server:** inject the evcc load-sample hook instead of module-mocking it ([c20771a](https://github.com/SunReye/SunReye/commit/c20771ac1ab66fb052fee6dda782b96aee24562a))
* **ci:** make first-party mocks hand themselves back, and gate it ([58d8c41](https://github.com/SunReye/SunReye/commit/58d8c41183b7478649f2973d8845b132fdf19390))
* take the suite from 80 % to 100 % line coverage ([44e5ba1](https://github.com/SunReye/SunReye/commit/44e5ba1f8da82f0d8364911b0640c5d0477dea89))
* **web:** hand the base locale back after the format tests ([a57ddd1](https://github.com/SunReye/SunReye/commit/a57ddd1e8e6a8c3a34283982e8d52bf9fc82b9ae))


### Build System

* **docker:** ship one image, a musl binary on scratch ([ac61240](https://github.com/SunReye/SunReye/commit/ac61240c62b8d986ab6b76a46fd6bb45554646d1))
* make the single-binary compile a turbo task ([b42839d](https://github.com/SunReye/SunReye/commit/b42839d780e0eeeaa7ffe534e0bdf19d1502c0fe))


### Continuous Integration

* compress only the chunks the upgrade seed has not compressed ([dc37a42](https://github.com/SunReye/SunReye/commit/dc37a4240759b3759f0be488c4db4b73c9ef5126))
* give the coverage ratchet room for a version skew, not for regressions ([43c0cc8](https://github.com/SunReye/SunReye/commit/43c0cc836d84b3f437cecfa765f777e651f5d70d))
* make TDD enforceable, not just intended ([782110a](https://github.com/SunReye/SunReye/commit/782110a3952237640027918c43fdc35599596fd6))
* close the beta channel's four DX gaps ([2dc4add](https://github.com/SunReye/SunReye/commit/2dc4addfc55c5ee0f3953a0430fc99129a2c6d44))
* give the beta addon a changelog ([edd9a49](https://github.com/SunReye/SunReye/commit/edd9a494d0a58a73e0abd14601ddb19edf94bcba))
* version betas by date and commit, and prune old beta tags ([1b74ef9](https://github.com/SunReye/SunReye/commit/1b74ef945c63f9a85b0ea4f30077da2a177cc267))
* run checks on the dev integration branch ([9fccca4](https://github.com/SunReye/SunReye/commit/9fccca451447743e460a25a3fc9218489ba6655b))
* build a beta addon image from the dev branch ([d87d12e](https://github.com/SunReye/SunReye/commit/d87d12e4f081740b4c51feb8acbafc39795b65c1))
* gate pull requests on fallow code health ([9b15b62](https://github.com/SunReye/SunReye/commit/9b15b629d372717176832569550bf923d74325e4))


### Miscellaneous Chores

* **ci:** pin the weighted-rollups gate to bun 1.4.0 ([0cb8712](https://github.com/SunReye/SunReye/commit/0cb87122eda470354b6dc5342c4961257b59fa40))
* bun 1.3.13 -> 1.4.0 ([c7ecf18](https://github.com/SunReye/SunReye/commit/c7ecf186f9d9aa4b597443b4a3bc168eb1b96925))
* **db:** move the schema suites out of the drizzle schema directory ([c0cabba](https://github.com/SunReye/SunReye/commit/c0cabba8876d89dcdd273c3969e150bafceae60d))
* **web:** let the e2e port be overridden ([8f71ccc](https://github.com/SunReye/SunReye/commit/8f71ccc21f9f2010abb12aeede4ee23e88d10a79))
* **web:** bump layerchart to 2.2.0 ([a345fa1](https://github.com/SunReye/SunReye/commit/a345fa1cef37d5bef7b2dedf7ee9f0ffff3f3c89))
* **fallow:** close the web -> server boundary ([44f62ba](https://github.com/SunReye/SunReye/commit/44f62ba92a1a14c35e9e2fe8c3692ef1dc0a4b6b))
* ignore agent worktrees ([1158899](https://github.com/SunReye/SunReye/commit/11588996953d351374e0a6b8f032e4cbf3afce17))
* **web:** tidy up after the statistics rename ([12bc1dc](https://github.com/SunReye/SunReye/commit/12bc1dc8338eed0ceb38063c0ad2535946b0acfc))
* clear inherited fallow findings ([8d19fef](https://github.com/SunReye/SunReye/commit/8d19fefbb7e5d1f2706782b2e54280fb8aad5687))
* **server:** emit declarations only from tsc -b ([fce15d2](https://github.com/SunReye/SunReye/commit/fce15d21fef01805b43d2aa58622892a922798eb))
* **env:** suppress the unused-export finding on the web env placeholder ([6155c31](https://github.com/SunReye/SunReye/commit/6155c313459ea046843b0d21b2887294cbb7a8c2))
* land phase 6 fallow ratchets ([98b034f](https://github.com/SunReye/SunReye/commit/98b034f72e40368cd4fc56f70aa748358eeb3f19))
* enforce strict fallow config for production ([7a26302](https://github.com/SunReye/SunReye/commit/7a2630251cc60e02320daf72873aa5e004113aed))

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
