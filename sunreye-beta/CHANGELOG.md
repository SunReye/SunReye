# Changelog

## [unreleased]

Unreleased work on `dev` since 1.2.0, shipped in `beta.20260814-3b95b3a`.


### Features

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


### Documentation

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

* **web:** hand the base locale back after the format tests ([a57ddd1](https://github.com/SunReye/SunReye/commit/a57ddd1e8e6a8c3a34283982e8d52bf9fc82b9ae))


### Continuous Integration

* version betas by date and commit, and prune old beta tags ([1b74ef9](https://github.com/SunReye/SunReye/commit/1b74ef945c63f9a85b0ea4f30077da2a177cc267))
* run checks on the dev integration branch ([9fccca4](https://github.com/SunReye/SunReye/commit/9fccca451447743e460a25a3fc9218489ba6655b))
* build a beta addon image from the dev branch ([d87d12e](https://github.com/SunReye/SunReye/commit/d87d12e4f081740b4c51feb8acbafc39795b65c1))
* gate pull requests on fallow code health ([9b15b62](https://github.com/SunReye/SunReye/commit/9b15b629d372717176832569550bf923d74325e4))


### Miscellaneous Chores

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
