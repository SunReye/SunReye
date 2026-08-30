# Changelog

## [2.0.0](https://github.com/SunReye/SunReye/compare/web-v1.2.0...web-v2.0.0) (2026-08-30)


### ⚠ BREAKING CHANGES

* **db:** a reading is identified by a device and a metric instead of a profile id and a metric name. The v2 schema replaces both 1.x rollup generations with one. The upgrade from 1.2.0 is in place and automatic — a sub-second catalogue step during start-up, after which live data works — followed by a separate, resumable backfill that replays your pre-update history and can be deferred. Until that backfill has run, charts cover only the time since the update, and a range reaching further back is refused with an explanation rather than answered partially. ([59de72d](https://github.com/SunReye/SunReye/commit/59de72d8d5912af801534f6ece143a2402744f10))
* **mqtt:** Home Assistant identity moves off the inverter profile id and onto your plant and device names, so every SunReye entity id, `unique_id`, MQTT topic and Home Assistant device is renamed once. Dashboards, automations, scripts and template sensors naming a `sensor.sunreye_*` entity have to be re-pointed one time; the retained announcements made under the old scheme are cleared for you, once, right after the new ones are announced. Read "Read this before updating to 2.0.0" at the top of the addon changelog before updating. ([0804685](https://github.com/SunReye/SunReye/commit/08046851e12fd51da18b295ffc0cb750cf209648))
* **server:** on first open after the update the instance asks once for a plant name and an inverter name, and holds Home Assistant MQTT discovery until both are set, so nothing is ever announced under a placeholder. ([5633f5d](https://github.com/SunReye/SunReye/commit/5633f5d958ee739581c4039d62ea461a05c45ecc))
* **server:** the `activeProfile` global is gone. Devices are read from the `devices` table as `DeviceInstance` values whose capabilities are derived from their roles, so the runtime, the MQTT bridge, the automation engine and the write path address a device rather than the one active profile. ([8add910](https://github.com/SunReye/SunReye/commit/8add910ae79e6265864aaa2e2fdcdf30ac014494))
* **auth:** configuration reads are admin-gated. `GET /api/profiles/updates` shipped ungated and is now `requireAdmin`, so a client polling a configuration endpoint without admin credentials is now refused. ([3a353a3](https://github.com/SunReye/SunReye/commit/3a353a35ffd458655cc88ed2c0e67f1a88377db4))
* **ws:** the five legacy per-topic WebSocket routes are gone. Everything runs over the multiplexed `/ws`, authorization is decided per subscribe frame rather than at the upgrade, and the envelope publishes on the plain topic name — the `mux:` prefix is gone. ([33ec667](https://github.com/SunReye/SunReye/commit/33ec6678d46c76b8ae34b83bc0fb27a4c5dfdca6))
* **server:** `GET /api/automations/history` is removed, along with the in-memory decision ring behind it and the `DecisionPoint` wire type. The optimizer is a device now, so its decisions are rows in `metrics_raw` read through `/api/history` and `/api/history/rollup` under the `optimizer` slug. The `automations` topic stays; its `history` and `point` fields do not. ([4ce8057](https://github.com/SunReye/SunReye/commit/4ce8057111828ec8d3877940b2eaa11f53340924))
* **web:** the `/system` page is retired — each power-flow node now opens onto its own readings. ([dd77bcb](https://github.com/SunReye/SunReye/commit/dd77bcbca06e063750b8b40c2597b45f259124af))

### Features

* **auth:** add "keep me signed in" option on login ([d75bbb3](https://github.com/SunReye/SunReye/commit/d75bbb3c5e6446c073c00389a3e5b64afe0ca256))
* **automations:** borrow the car as a sink for negative-price windows ([98e8b47](https://github.com/SunReye/SunReye/commit/98e8b474b5013e9dd868b2b412a30dd8cd665d51))
* **automations:** charge from the grid during negative-price windows ([43b66c7](https://github.com/SunReye/SunReye/commit/43b66c7ab9f532235072bd5428eb1576ad570c85))
* **automations:** hold the battery low ahead of negative-price windows ([74f5693](https://github.com/SunReye/SunReye/commit/74f56934948f39f6010475f4063e7734140d5fd1))
* **automations:** plan projection, decision history, and charting UI for peak shaving ([162d882](https://github.com/SunReye/SunReye/commit/162d882209a07a6997a501136c99042c7b031690))
* **automations:** read live-capable status readings from the 1 Hz feeds ([261da4c](https://github.com/SunReye/SunReye/commit/261da4c1213f9d59a15d4d705a5d813a1d6d60a7))
* **automations:** use EVCC battery boost to empty the pack ([76bf1ed](https://github.com/SunReye/SunReye/commit/76bf1ede652d50368cad513efae32b9999c2e427))
* **charts:** let a saved chart name the device each series is read from ([50f6881](https://github.com/SunReye/SunReye/commit/50f6881e0ed9cbe4755823f5a088b1199bd02d71))
* **cost:** report the export that earned nothing under §51 ([f381172](https://github.com/SunReye/SunReye/commit/f381172db0834812ebcd31ec19a3d3ef928f53bf))
* **db:** portable export/import as a permanent, schema-independent feature ([166220b](https://github.com/SunReye/SunReye/commit/166220b80a529be0b992b876af5cb0e1cc4b98e7))
* **db:** provision the plant spine and move plant facts onto columns ([a5ba46a](https://github.com/SunReye/SunReye/commit/a5ba46aba8fe04df24e2754b451c7759f4d423b2))
* **evcc:** estimate live charge power between EVCC publishes ([d810bb7](https://github.com/SunReye/SunReye/commit/d810bb7cff76d6f92aa53f26fc595b394a2a6e6b))
* **forecast:** 15-minute solar forecast with peak-power tooltip ([fcb50aa](https://github.com/SunReye/SunReye/commit/fcb50aad899c1f2b8b362cc9217a173df55bece6))
* **forecast:** give each PV array its own physics ([80e7a87](https://github.com/SunReye/SunReye/commit/80e7a87c8e271c818199eaaa9685f602ae984afd))
* **forecast:** model feed-in clipping + battery in solar forecast ([88974b2](https://github.com/SunReye/SunReye/commit/88974b229ca54846d4a1640ad374d6ed7c2fa508))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* **server:** dedicated plant time zone for server-side bucketing ([55885f1](https://github.com/SunReye/SunReye/commit/55885f12da13941a67e9bf5a47d7e28e5528585b))
* **server:** finish the irradiance provider seam ([063086f](https://github.com/SunReye/SunReye/commit/063086fa94c53c62c67b3643941032599d6716e9))
* **server:** prove every route's gate, and close the last public one ([3a353a3](https://github.com/SunReye/SunReye/commit/3a353a35ffd458655cc88ed2c0e67f1a88377db4))
* **server:** serve the dashboard from the compiled binary ([b52de5e](https://github.com/SunReye/SunReye/commit/b52de5ec5c578165df9781a901bc071d8f950a80))
* **server:** upgrade to Elysia 2 ([d280e20](https://github.com/SunReye/SunReye/commit/d280e20b7f2edef453afeb5175457db69f97fb86))
* **tariff:** price energy against the market with a marketing model ([2075caa](https://github.com/SunReye/SunReye/commit/2075caafbaa00c3b398bec1db2729369a11fd9db))
* **web:** a battery round-trip efficiency tile ([e105692](https://github.com/SunReye/SunReye/commit/e1056925ebf3f8f179f9660e11f44cd64b93baca))
* **web:** a plant ceiling the diagram can be measured against ([9264964](https://github.com/SunReye/SunReye/commit/92649641f95ac427f3164b1b6b6eaafeb37c9719))
* **web:** add a metric to a custom chart from its own card ([696b0a1](https://github.com/SunReye/SunReye/commit/696b0a19b19bf3a29e2978d7f5c204b5f6a40469))
* **web:** canonical page shell and section primitives ([194b05e](https://github.com/SunReye/SunReye/commit/194b05e85ebe4ef3b0335bed7e28df1045a1eb97))
* **web:** capacity and health tiles for the measured battery ([10abc21](https://github.com/SunReye/SunReye/commit/10abc21bd31e1be194ee3dcf88876c849d1a2a15))
* **web:** categorical chart palette, and a colour per series ([884c4b6](https://github.com/SunReye/SunReye/commit/884c4b66858150770cba9ef76abb691d3af53d56))
* **web:** compare every statistics figure with its reference window ([723b04e](https://github.com/SunReye/SunReye/commit/723b04e1ae8ed115b08f73191e10e456d7c87f67))
* **web:** compare replaces add-to-chart in the card header ([55490a2](https://github.com/SunReye/SunReye/commit/55490a21fcc36d55dd11cbc83d73144224a7f98f))
* **web:** configure and observe price-aware charging ([6eb41c1](https://github.com/SunReye/SunReye/commit/6eb41c1322b73e512838ad4e2465cb1f19001711))
* **web:** draft a chart on a full-screened metric card ([a718f90](https://github.com/SunReye/SunReye/commit/a718f90a7f01744af3548a4ff342c759b7952c9f))
* **web:** edit the market-linked half of the tariff ([e50a4ce](https://github.com/SunReye/SunReye/commit/e50a4ce4936cc622de330eada0c5c124b4d3b82d))
* **web:** energy analytics section ([c389bbe](https://github.com/SunReye/SunReye/commit/c389bbe081fbec7fed00c6e55d7c1e965dc8ecb2))
* **web:** forecast-correction settings panel ([219f145](https://github.com/SunReye/SunReye/commit/219f1451c305e8ef1be15d6ffa4088c06f25dc90))
* **web:** full screen moves to the plot's corner, away from the caret ([15723cb](https://github.com/SunReye/SunReye/commit/15723cbe1c08d5d5b78760a0483be6b8f110b0b2))
* **web:** glide animated numbers across the feed's real cadence ([5b8b424](https://github.com/SunReye/SunReye/commit/5b8b424e1c99389795e466305e1f00ef52c08152))
* **web:** glide live chart cursor across the feed's sample spacing ([5a17341](https://github.com/SunReye/SunReye/commit/5a1734149441a6fb70cdebcb2ca0bab9474fbc9c))
* **web:** hub and nodes answer the plant's load ([61626df](https://github.com/SunReye/SunReye/commit/61626dfedc5129e71acfc6fad08c7c083ce1be84))
* **web:** lead EV charger card with session kWh + SoC meter ([c990e1e](https://github.com/SunReye/SunReye/commit/c990e1ea40c8d3cb154b2a0d2930861160231602))
* **web:** live indicator and dated section captions ([3c8ccf2](https://github.com/SunReye/SunReye/commit/3c8ccf277fe52c99bc114961ddb3da4ce96093da))
* **web:** live statistics updates over websocket ([c81b22e](https://github.com/SunReye/SunReye/commit/c81b22e49a7e5073ccda4699c996ac816db51fe0))
* **web:** log viewer level/source filters and server-level control ([b0f3ed0](https://github.com/SunReye/SunReye/commit/b0f3ed0b6384cbcb5d906c9121a4531c4eb24e50))
* **web:** make app top header sticky ([f56ed2e](https://github.com/SunReye/SunReye/commit/f56ed2ef70d51bbfe8753bf132e4f5bca574d0e0))
* **web:** migration onboarding page, an app-wide missing-history banner, and a loud 422 ([c7c1f84](https://github.com/SunReye/SunReye/commit/c7c1f84be186e7c265ca08a7b0f7c03c338da622))
* **web:** nameplate setting and the capacity degradation chart ([bb35d49](https://github.com/SunReye/SunReye/commit/bb35d4987846962d439df44fc47ba1daacb565b4))
* **web:** navigate history and statistics by period ([59b3852](https://github.com/SunReye/SunReye/commit/59b3852da6b9e94d0d24eb3abc4e90fad215af80))
* **web:** one interaction model and one house style for every chart ([564b9bc](https://github.com/SunReye/SunReye/commit/564b9bc13c083b1f25b6d7f823d87cf5172ff7fa))
* **web:** one leased socket with topic subscriptions ([d281575](https://github.com/SunReye/SunReye/commit/d281575929c636d489d2bacb3432f0a3ea0b8bb6))
* **web:** open each power-flow node onto its own readings, and retire /system ([dd77bcb](https://github.com/SunReye/SunReye/commit/dd77bcbca06e063750b8b40c2597b45f259124af))
* **web:** rename /costs route to /statistics with hash redirect ([7c339a6](https://github.com/SunReye/SunReye/commit/7c339a65d7ce83b595b814f36ca0b5b3a798cc36))
* **web:** render the home node from the load metric, not the UPS capability ([f076931](https://github.com/SunReye/SunReye/commit/f076931e40211ecfd3deee77dffda724f510ecf3))
* **web:** seed chart view scope from the saved preference ([055c799](https://github.com/SunReye/SunReye/commit/055c799467ba6e42506444dacee091ff5ff25783))
* **web:** show day-ahead prices and negative windows ([1fedb57](https://github.com/SunReye/SunReye/commit/1fedb57b0c3e57bd28bdb74ea75de94411eb9d3b))
* **web:** show grid imported and exported energy on /statistics ([c56b7f9](https://github.com/SunReye/SunReye/commit/c56b7f96573d04798db23fd3481f27dc5af950d7))
* **web:** show uncapped PV potential as split bar on forecast chart ([20845b8](https://github.com/SunReye/SunReye/commit/20845b803594cebc79ed9a486137e20952c5fce1))
* **web:** spot price analytics section ([a4b85c2](https://github.com/SunReye/SunReye/commit/a4b85c2e079949f8411d8b4137ee9cd22e1bbaa7))
* **web:** take any chart to the whole screen ([be82a7a](https://github.com/SunReye/SunReye/commit/be82a7a94ba99ad87eea8fcdb0d19af3079b3afa))
* **web:** the battery's nominal voltage moves to the plant settings ([6714eca](https://github.com/SunReye/SunReye/commit/6714ecabe1717daf203c2bb949798f425c33e52f))
* **web:** the home node carries a separately metered backup output ([d066040](https://github.com/SunReye/SunReye/commit/d06604059fb50f7d5ae16a6b8f14bc080cac6efa))
* **web:** the interleaved pulse ladder ([f30c49e](https://github.com/SunReye/SunReye/commit/f30c49e6cc19e211b69d00aa3565992f7d1d6568))
* **web:** two fingers zoom any chart, with nothing to arm ([65d26ba](https://github.com/SunReye/SunReye/commit/65d26ba24b2129dde64617cc0bdb558d57fa8d36))
* **web:** zoom the overlaid chart, saved or drafted ([4764645](https://github.com/SunReye/SunReye/commit/47646450ce1cda8847ab7302be11189322a5ac0c))
* add peak-shaving automation engine ([f0bda94](https://github.com/SunReye/SunReye/commit/f0bda944036958b20b244432298badbaf42b67c0))
* chart zoom, an honest peak-shaving reserve, and the layout docs ([6fa4f3b](https://github.com/SunReye/SunReye/commit/6fa4f3be1783e606b2d86160750dcfe5a8312d54))
* choose the chart palette in settings ([95a5dcc](https://github.com/SunReye/SunReye/commit/95a5dcc21bb9d7ea528b85a4ae4b65f13ada33a7))
* stream server logs to an admin Settings panel ([faeaf08](https://github.com/SunReye/SunReye/commit/faeaf0807b2a7b33fa9fca5c6706b892781f3320))


### Bug Fixes

* **addon:** restart only the server, and never lose the onboarding connection ([5a26509](https://github.com/SunReye/SunReye/commit/5a26509781a97d2d88c6576308b79ac3384dc201))
* **energy:** pin each role's kWh derivation, and a counter-restart hole (#115) ([a8b5f55](https://github.com/SunReye/SunReye/commit/a8b5f55f19d0a2f3b3b7aa02efbcc90d5c84aaa4))
* **evcc:** read the charge limit from the effective/vehicle topics ([dbfb00d](https://github.com/SunReye/SunReye/commit/dbfb00d4d6c6fbc2fa0debff9c383b0478456b83))
* **scripts:** make the anonymous sweep actually ask the write surface's gates ([096cfa5](https://github.com/SunReye/SunReye/commit/096cfa5719e4b53c5027544511024bcb31f6940a))
* **server:** one market average, one definition of self-consumption ([2a6b8f9](https://github.com/SunReye/SunReye/commit/2a6b8f9fd83d4c22b71ac3723cd8846bafd565a3))
* **statistics:** chart the whole calendar month, and only that month ([745fac5](https://github.com/SunReye/SunReye/commit/745fac5134fcb7f49dc05c2b81d5e9f66b920abe))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))
* **web:** a charge's glow stops being cut off at the safe box ([0d2c783](https://github.com/SunReye/SunReye/commit/0d2c783fa7050d2222e7f53b0aa382cb217bf7d6))
* **web:** a rising plant stops writing storage at the feed's cadence ([952ee98](https://github.com/SunReye/SunReye/commit/952ee9897596e3a82af05c0a5047753372972686))
* **web:** accent stops being an alias of primary, which made selects unreadable ([b90af82](https://github.com/SunReye/SunReye/commit/b90af82dcbd10382faf0dbfb812052bd59f24f79))
* **web:** anchor the decision countdown on frame arrival, not server time ([2307cee](https://github.com/SunReye/SunReye/commit/2307cee9ff59e716dcc69a33b9a88c81aff3faf3))
* **web:** build inclusive day ranges from date parts, not +86_400_000 ([ed8a520](https://github.com/SunReye/SunReye/commit/ed8a5209b2ee0e5de6eb73c6726a8bc70673a6c7))
* **web:** cap the select dropdown height so long lists scroll ([1718f01](https://github.com/SunReye/SunReye/commit/1718f01aed7248473d0fe50a3916bdfd5fba85c1))
* **web:** carry the pack voltage forward instead of explaining where it went ([0235af8](https://github.com/SunReye/SunReye/commit/0235af8b8b4c390c60ff50600bed385d9451da96))
* **web:** close the gaps an adversarial review found in the palette work ([c8cc39b](https://github.com/SunReye/SunReye/commit/c8cc39ba8618893c412c71174cf382583c0c6607))
* **web:** correct Array.from type arguments in solar-forecast dialog ([a34d777](https://github.com/SunReye/SunReye/commit/a34d777464bd64ce8200a1279cef5f3196e69652))
* **web:** drop empty segments from the cost bar stack ([028eaf7](https://github.com/SunReye/SunReye/commit/028eaf776c289c52b747d7deee7685805822ae66))
* **web:** export leaked types and give a suppression its reason ([0bd66d9](https://github.com/SunReye/SunReye/commit/0bd66d9c128c02d527b1e88396bf37beb65295c8))
* **web:** format statistics dates and figures in the UI locale ([3900cb7](https://github.com/SunReye/SunReye/commit/3900cb75b714f8ce9b4821c3b9499734179604d6))
* **web:** full-screen the document, not the card ([3f1f1b4](https://github.com/SunReye/SunReye/commit/3f1f1b4c373076a52876e0714231b03cb778d09e))
* **web:** give the live sparkline's measuring box a height ([65582be](https://github.com/SunReye/SunReye/commit/65582bed3d39a8e85f1fbba8bc300cab9176c2b9))
* **web:** glide the custom live chart across the feed's sample spacing ([e086da1](https://github.com/SunReye/SunReye/commit/e086da1109a73439b87d29fd1fcfa15f39aa3223))
* **web:** hit-test the heatmap per cell and wash the hovered one ([48ed60a](https://github.com/SunReye/SunReye/commit/48ed60abc6060c1462d12048d4c1f4850b73f47c))
* **web:** keep the heatmap panel when a metric has nothing to show ([40d3e6c](https://github.com/SunReye/SunReye/commit/40d3e6cb6c40883ea4cc5db26d42f3ab7170252f))
* **web:** label energy periods with the bucket they were fetched at ([20c30df](https://github.com/SunReye/SunReye/commit/20c30df53db39541eea952000bb133b90af89196))
* **web:** let Escape close the layer on top, not the card under it ([f88a48d](https://github.com/SunReye/SunReye/commit/f88a48d2e3ccaa01283580a4c7a61046b070b3a5))
* **web:** let an expanded chart escape a transformed ancestor ([4b1c066](https://github.com/SunReye/SunReye/commit/4b1c066492126a0efab2ce5a814d36873b7e653c))
* **web:** let live EVCC state reclaim the limit slider after a commit ([57fc330](https://github.com/SunReye/SunReye/commit/57fc330c3f41b937a1de37d78c07928114f1a1d3))
* **web:** make the negative price windows visible and consistent ([3313220](https://github.com/SunReye/SunReye/commit/3313220c6b40a9dd4fee1f47ccb524395c6aef61))
* **web:** narrow the last seven chart gutters on a phone ([5d2d2fa](https://github.com/SunReye/SunReye/commit/5d2d2fa026a5544b92c1f2ffb8f89966304feb5f))
* **web:** never render a tile against an empty response body ([6c40a8b](https://github.com/SunReye/SunReye/commit/6c40a8bb6302c2f911de9d895ff52a8a977ba4ba))
* **web:** one place for a panel's controls, and one width for the navigator ([c6e1a4c](https://github.com/SunReye/SunReye/commit/c6e1a4cfa355a1343bb42ddccce6e6ecf2d2954f))
* **web:** paint fixed meanings from the semantic set, not the palette ([8061145](https://github.com/SunReye/SunReye/commit/8061145f70b59731e245cc3be8811e9c61c6a349))
* **web:** patch layerchart's unclamped stacked-bar height ([e3c691a](https://github.com/SunReye/SunReye/commit/e3c691a2a00d4746fb38edfb6d9883d4e85ed1b0))
* **web:** pluralize price copy and cap runaway deltas ([42c978d](https://github.com/SunReye/SunReye/commit/42c978dd44c85950a3d9786c821c5ad5482c48e6))
* **web:** read the buffers untracked when sizing the backfill ([419c1a2](https://github.com/SunReye/SunReye/commit/419c1a27d024d9a85f851f249b62ee46a669484a))
* **web:** render canvas chart marks and labels correctly ([1057920](https://github.com/SunReye/SunReye/commit/1057920793624326db33d2bf934abda07af585c2))
* **web:** report slot-average power consistently in the solar-forecast dialog ([28ec5fe](https://github.com/SunReye/SunReye/commit/28ec5fe53489a9343cc96de75cdc5d6ddfeb9ace))
* **web:** stat tiles stop drawing a second box on a phone ([2e22f51](https://github.com/SunReye/SunReye/commit/2e22f514b28bdd529dec347b62651d67bf33137b))
* **web:** statistics layout at narrow widths and in sparse windows ([5121ce6](https://github.com/SunReye/SunReye/commit/5121ce67aa1a1f15bcdf4dbacd98201d44e1bc72))
* **web:** stop the automations card overflowing a phone ([1237d38](https://github.com/SunReye/SunReye/commit/1237d385eeeb4628942358adc5d5b74ddd2caefb))
* **web:** stop the calendar's today marker reading as a selected day ([22d9aa1](https://github.com/SunReye/SunReye/commit/22d9aa107b4c60007498fac99b2dd2948dd57fcf))
* **web:** stop the forecast dialog reporting unmeasured slots as zero production ([5e05163](https://github.com/SunReye/SunReye/commit/5e051634e59865f631ccfd47bf103d439c90bb42))
* **web:** stub the battery-health read in the browser layer ([dcdf2d0](https://github.com/SunReye/SunReye/commit/dcdf2d0568bf69cf3710977abb2882cf8714a0e3))
* **web:** the ceiling stops invalidating the effect that folds it ([a930f00](https://github.com/SunReye/SunReye/commit/a930f00e130ce9506e97b83432e92da3cf0c2bd4))
* **web:** the desktop toolbar is one line of controls, one height ([4dd2ed1](https://github.com/SunReye/SunReye/commit/4dd2ed107a670d452ca8d8f13bb43b279eb819e0))
* **web:** tolerate a manifest with no storage, and teach the e2e fixture the field ([a388f9e](https://github.com/SunReye/SunReye/commit/a388f9ebbac42177870413038449c30cf7970dbe))
* **web:** type the chart-axes gap fixture so svelte-check passes ([a9e1d3b](https://github.com/SunReye/SunReye/commit/a9e1d3b8db15c396ec1c1f376b7646d0982faa64))
* **web:** type the node-trigger helper for a pattern, not just a string ([9a83369](https://github.com/SunReye/SunReye/commit/9a83369697efe812bc719236067f6097d7e80d13))
* stop the charge-current round-up eating exportable PV, and finish the card migration ([3cdadfe](https://github.com/SunReye/SunReye/commit/3cdadfec95bbaa412034355159c319ec6519bdf8))


### Performance Improvements

* **e2e:** run the browser suite fully parallel and sharded, and drop the measurement layer ([44d1e65](https://github.com/SunReye/SunReye/commit/44d1e659cf4fba46a27b5fc789ed688b5a5cd49d))
* **server,web:** bucket the sparkline backfill and resume from the gap ([d9a66b8](https://github.com/SunReye/SunReye/commit/d9a66b826c450ec6d60d66145f9e487d1778917b))
* **web:** build a chart when the reader stops, not when they scroll past ([c077445](https://github.com/SunReye/SunReye/commit/c0774452f2e89c5aebff5eaa1113b616da79ae7a))
* **web:** build each chart once, at a width it can actually use ([db697a8](https://github.com/SunReye/SunReye/commit/db697a84bb03e0f55dae223edbf71b16e5d60988))
* **web:** stop the live charts repainting on every frame ([82399f5](https://github.com/SunReye/SunReye/commit/82399f5777f8174f11be68804f00d801772d6503))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @SunReye/inverter-core bumped to 1.1.0

## [1.2.0](https://github.com/SunReye/SunReye/compare/web-v1.1.1...web-v1.2.0) (2026-07-19)


### Features

* **evcc:** optional residual-home split (Home = load − EV) ([0e0327f](https://github.com/SunReye/SunReye/commit/0e0327f3c6404afd026d38e3fd70f33ec9ec6702))
* **evcc:** stream loadpoint state to the dashboard over WebSocket ([67aad79](https://github.com/SunReye/SunReye/commit/67aad79a30002269fa21d22f4acbcf28cca009d8))
* **web:** EVCC EV charger — power-flow node, dashboard card, settings ([4d5fd57](https://github.com/SunReye/SunReye/commit/4d5fd5781ab835c46688f7f71168356c15b709bc))


### Bug Fixes

* **web:** make solar forecast dialog open instantly with fresh data ([9674a5e](https://github.com/SunReye/SunReye/commit/9674a5ed8a7a0d4e6a9020eaa02b31c43e1060b2))
* **web:** stop dashboard animation stutter on weak devices ([b2b10e6](https://github.com/SunReye/SunReye/commit/b2b10e6473641d71648117992ed94f12984d73c7))

## [1.1.1](https://github.com/SunReye/SunReye/compare/web-v1.1.0...web-v1.1.1) (2026-07-18)


### Bug Fixes

* **web:** keep KPI money value on one line in narrow dashboard cards ([d785203](https://github.com/SunReye/SunReye/commit/d785203e9939f3a49a53dfcf94c71fe774028212))
* **web:** keep KPI money/ratio value on one line in narrow cards ([1623250](https://github.com/SunReye/SunReye/commit/16232504533b9e05c4fd828df64aaae3616187f8))

## [1.1.0](https://github.com/SunReye/SunReye/compare/web-v1.0.1...web-v1.1.0) (2026-07-18)


### Features

* **web:** compact overview cards + per-card detail dialogs with charts ([75f1db3](https://github.com/SunReye/SunReye/commit/75f1db3627677e3803ed9002cac5b4d01747015a))
* **web:** two-column overview on tablet/desktop with portrait diagram ([3925757](https://github.com/SunReye/SunReye/commit/3925757a5d88a4ceac6d229e5dc2b9db186b953c))
* **web:** weather card shows remaining kWh; forecast dialog overlays actual vs predicted ([02b5ed4](https://github.com/SunReye/SunReye/commit/02b5ed4cfc5e8d6bd802d0c9b4a74e29ad95343e))


### Bug Fixes

* **web:** header-bar trigger on mobile, floating trigger + gutter on desktop ([7107941](https://github.com/SunReye/SunReye/commit/71079417e2e0ec06b660e187a1c6adf802824ede))
* **web:** pad app content so floating sidebar trigger never overlaps page headers ([86a854f](https://github.com/SunReye/SunReye/commit/86a854fa6b78943aa784ac1f0c60940e47733862))
* **web:** stack weather tile on narrow screens to stop temp/forecast overlap ([745b4d5](https://github.com/SunReye/SunReye/commit/745b4d555d0a04953bd5698293ffb1d56d7dd5e6))
* **web:** stop detail-dialog charts overflowing on mobile ([02db01d](https://github.com/SunReye/SunReye/commit/02db01d4763050c26e4da484da3933e09d62e591))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @SunReye/inverter-core bumped to 1.0.0

## [1.0.1](https://github.com/SunReye/SunReye/compare/web-v1.0.0...web-v1.0.1) (2026-07-18)


### Miscellaneous Chores

* **web:** Synchronize sunreye-stack versions

## [1.0.0](https://github.com/SunReye/SunReye/compare/web-v0.7.1...web-v1.0.0) (2026-07-18)


### Features

* **auth:** lock down read endpoints with a public-dashboard opt-out ([ffed21f](https://github.com/SunReye/SunReye/commit/ffed21f847697e98ad252a897a5db724e12497e8))
* **profiles:** bake in the official profile source (protected) ([b6ff3bd](https://github.com/SunReye/SunReye/commit/b6ff3bd8112b885963213baacd76570bd0692db1))
* **weather:** Open-Meteo backend + location settings; dedupe accessors ([3a07f80](https://github.com/SunReye/SunReye/commit/3a07f804fee30b24bec610043300fd9f92dbf823))
* **weather:** PV production forecast on the weather tile ([aeabc30](https://github.com/SunReye/SunReye/commit/aeabc302cf760546f2509c176627cab23510d62c))
* **web:** add i18n infra (Paraglide) + English messages + missing-key lint ([26cc44c](https://github.com/SunReye/SunReye/commit/26cc44ccaa55cb6b7023c49855f29ec7022d1c01))
* **web:** add sensor visibility settings to hide metrics from the dashboard ([4cd919d](https://github.com/SunReye/SunReye/commit/4cd919ddee68eb5315772ba77f152a9201631fcf))
* **web:** anonymous read-only dashboard for logged-out visitors ([803619f](https://github.com/SunReye/SunReye/commit/803619ff40a718f973d720769873a8d7d3b3ebb2))
* **web:** consistent sticky Save bar across settings forms ([dd4d025](https://github.com/SunReye/SunReye/commit/dd4d025814ed8dff958c56683a4787f0fcf69bd0))
* **web:** cost + self-consumption KPIs on the daily-energy cards ([bdeeddc](https://github.com/SunReye/SunReye/commit/bdeeddc49549d27a234507e09b92d9462a6d5de5))
* **web:** give custom charts independent left/right y-axes per unit ([8d709a8](https://github.com/SunReye/SunReye/commit/8d709a88490c073c0e5613f0fbdf0bc4e5c1eab2))
* **web:** link to the public dashboard from login ([d77e9f8](https://github.com/SunReye/SunReye/commit/d77e9f8bb4b634812e0a59c88aea20e07e1d60aa))
* **web:** responsive kiosk power-flow redesign ([5393462](https://github.com/SunReye/SunReye/commit/5393462583dab794ceb04120a2d9cc04202432ef))
* **web:** restore self-sufficiency & self-consumption tiles on costs ([f91ae6d](https://github.com/SunReye/SunReye/commit/f91ae6dddcafac2c6f639badd67875c49b1bde7d))
* **web:** rework Costs headline tiles for clarity ([92bf171](https://github.com/SunReye/SunReye/commit/92bf17173edcb6b1b69e47d6efeffed8df41c4ed))
* **web:** show today's solar savings on the production card ([1368c04](https://github.com/SunReye/SunReye/commit/1368c04d9376fa8ff78e0b365c2ae4ed897e3b81))
* **web:** single-screen kiosk overview + System detail page ([5c30cfe](https://github.com/SunReye/SunReye/commit/5c30cfefb0d01f876061a5e68b2d507b36306536))
* **web:** split settings into routed panels with a grouped nav ([67d7e64](https://github.com/SunReye/SunReye/commit/67d7e640bca8c3296eb55f49fcb44af4b73cee85))
* **web:** translate auth, onboarding & setup wizard ([c5cd2f6](https://github.com/SunReye/SunReye/commit/c5cd2f6a003447eba2a22b8a5c63df5a865662d5))
* **web:** translate costs, history, controls & inverter components ([6c91294](https://github.com/SunReye/SunReye/commit/6c91294345723d29043624d54fda6d603593a8db))
* **web:** translate missed profile-source & TOU toasts ([2f7ee42](https://github.com/SunReye/SunReye/commit/2f7ee42132caeb500429e40db10e7fd745735655))
* **web:** translate role-mapped surfaces + fill de/es/it/fr ([33b8311](https://github.com/SunReye/SunReye/commit/33b83112d50a809579c8143dd361ea4b0e0381b9))
* **web:** translate settings area ([9c44ab0](https://github.com/SunReye/SunReye/commit/9c44ab027f3b92d85d98388a063c81259295bb00))


### Bug Fixes

* Home Assistant discovery, number ranges, settings tabs, chart dot ([a5beaf6](https://github.com/SunReye/SunReye/commit/a5beaf6f1fceebaee23942dffa94ada44d2ef61e))
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

## [0.7.1](https://github.com/SunReye/SunReye/compare/web-v0.7.0...web-v0.7.1) (2026-07-13)


### Bug Fixes

* **profiles:** register downloaded profiles immediately, no restart ([7bca64e](https://github.com/SunReye/SunReye/commit/7bca64e994e04de6cd96554fe2623f6645268f60))

## [0.7.0](https://github.com/SunReye/SunReye/compare/web-v0.6.0...web-v0.7.0) (2026-07-13)


### Features

* **web:** add a day stepper to the history range picker ([d9e29c3](https://github.com/SunReye/SunReye/commit/d9e29c33e8e1c978c111384eacd2d29620408f9f))
* **web:** add custom charts section to history page ([c46eee9](https://github.com/SunReye/SunReye/commit/c46eee9c95a0dfb908a88b465829d5f53c050618))
* **web:** add instance-wide date & time display preferences ([4d5e130](https://github.com/SunReye/SunReye/commit/4d5e1307f90d2920b248b69054366c295219a0a4))
* **web:** auto-save profile sources with optimistic updates ([2f20016](https://github.com/SunReye/SunReye/commit/2f2001638c4149ba8de1e86052abb858edaaed21))
* **web:** group available profiles by manufacturer and family ([a202d44](https://github.com/SunReye/SunReye/commit/a202d44aed33fafd465ed6c4fbdd96a6eac6697c))
* **web:** show source repo on available profiles ([52d4411](https://github.com/SunReye/SunReye/commit/52d44111f3ffe559564ab4bc96ae59bbf1c54fc5))
* **web:** step forward into live view from the history stepper ([e75507d](https://github.com/SunReye/SunReye/commit/e75507d1f882c033884eba95e3c58ebf75ed51fe))
* **web:** surface available profile updates in settings ([a8a6bf4](https://github.com/SunReye/SunReye/commit/a8a6bf484757c7b7866aa38751ce0bd9da03b366))


### Bug Fixes

* **web:** derive active route from the hash under the hash router ([63a0ba3](https://github.com/SunReye/SunReye/commit/63a0ba30658dd88a01a3cb798f270055c5872db2))
* **web:** keep the desktop sidebar open after navigation ([dbc0aef](https://github.com/SunReye/SunReye/commit/dbc0aef25942ee32e80fe365001758f83a15cfb5))
* **web:** stack profile meta over source repo on mobile ([72b2c1e](https://github.com/SunReye/SunReye/commit/72b2c1efbbdd6ef5a4e2e90ca6292fb707f32eaf))
* **web:** step into today from a non-day range in history stepper ([b71915d](https://github.com/SunReye/SunReye/commit/b71915d1b1d056fa4e900d4c976dfbde8d7a7f4b))

## [0.6.0](https://github.com/SunReye/SunReye/compare/web-v0.5.0...web-v0.6.0) (2026-07-13)


### Features

* **web:** add lock toggle to controls page ([af984dd](https://github.com/SunReye/SunReye/commit/af984dd0938935cb2115c913da4278ae279a1705))
* **web:** align setup profile picker with settings and animate selection ([ec64c05](https://github.com/SunReye/SunReye/commit/ec64c050146b547525762d4d8aec7e9345c72c61))
* **web:** move settings to sidebar footer, close nav on click ([3bcd3fe](https://github.com/SunReye/SunReye/commit/3bcd3feca2ff29deece1363fb431376501be3715))
* **web:** searchable profiles grouped by manufacturer with restart confirm ([d543faa](https://github.com/SunReye/SunReye/commit/d543faa8fab307f36f4b2151f099c79dd30aa1c0))


### Bug Fixes

* **web:** resolve mobile overflow across settings and setup ([4460188](https://github.com/SunReye/SunReye/commit/4460188886e85dbb17a9d033023d2ddd2e874a52))
* **web:** stop history chart overflow on non-live ranges ([e7833ed](https://github.com/SunReye/SunReye/commit/e7833ed0ed1021d67495b11bfa471d947b0b72d2))
* **web:** use native Tabs for settings navigation ([79b377d](https://github.com/SunReye/SunReye/commit/79b377d0e902cd65e85f6038ca11038b5e197637))

## [0.5.0](https://github.com/SunReye/SunReye/compare/web-v0.4.0...web-v0.5.0) (2026-07-12)


### Miscellaneous Chores

* **web:** Synchronize sunreye-stack versions

## [0.4.0](https://github.com/SunReye/SunReye/compare/web-v0.3.0...web-v0.4.0) (2026-07-12)


### Miscellaneous Chores

* **web:** Synchronize sunreye-stack versions

## [0.3.0](https://github.com/ediiiz/SunReye/compare/web-v0.2.2...web-v0.3.0) (2026-07-12)


### Features

* **web:** add adapter-static build mode for prefix-agnostic deployments ([727fa3c](https://github.com/ediiiz/SunReye/commit/727fa3c6924c8878d88f60171915139233feca0f))


### Bug Fixes

* **web:** anchor hash navigation to the document URL under ingress ([5a22b1e](https://github.com/ediiiz/SunReye/commit/5a22b1ec425069f46dbb0d458774ab58e9de27f6))

## [0.2.2](https://github.com/ediiiz/SunReye/compare/web-v0.2.1...web-v0.2.2) (2026-07-12)


### Bug Fixes

* **web:** route internal navigation through resolve() for the hash router ([1615518](https://github.com/ediiiz/SunReye/commit/1615518dbc735d21871ea93c9e8dc0dc57bd7efc))

## [0.2.1](https://github.com/ediiiz/SunReye/compare/web-v0.2.0...web-v0.2.1) (2026-07-12)


### Miscellaneous Chores

* **web:** Synchronize sunreye-stack versions

## [0.2.0](https://github.com/ediiiz/SunReye/compare/web-v0.1.0...web-v0.2.0) (2026-07-12)


### Features

* **web:** runtime API base and hash routing for reverse-proxy prefixes ([1aa8661](https://github.com/ediiiz/SunReye/commit/1aa8661b1b5ca0fac7932d12a92c419941c53b1e))

## [0.1.0](https://github.com/ediiiz/SunReye/compare/web-v0.0.1...web-v0.1.0) (2026-07-11)


### Features

* **brand:** unify logo across docs and web, align docs theme with app ([81dbad0](https://github.com/ediiiz/SunReye/commit/81dbad07494e2a02df6f66643f6d952acdceb40e))
* **costs:** range picker with contextual net-cost bar charts ([425a134](https://github.com/ediiiz/SunReye/commit/425a1344cc43e0faad0c068a67ab01e738806d6b))
* **costs:** range-driven energy split + solar self-consumption savings ([d1c5b17](https://github.com/ediiiz/SunReye/commit/d1c5b1775d76d29c14e1493d0e102d38e03763be))
* **costs:** split total-cost bars into diverging component stack ([a0428e9](https://github.com/ediiiz/SunReye/commit/a0428e932979d1b737fe0a9896906c9265c07702))
* **costs:** total-cost series, cleaner layout, fade transitions ([4016f4f](https://github.com/ediiiz/SunReye/commit/4016f4ff312aec2a00908d6fcfb3bfccda83eb15))
* **inverter:** add computed self-consumption and efficiency metrics ([73e0043](https://github.com/ediiiz/SunReye/commit/73e00431efa69f177e7cc978f125f637b791cc7e))
* **inverter:** drive time-of-use target by battery mode ([e3b1188](https://github.com/ediiiz/SunReye/commit/e3b1188c4c791a4f6e5287628e94130a93fdff63))
* **settings:** add admin danger-zone data reset ([c0e03db](https://github.com/ediiiz/SunReye/commit/c0e03db0224a766078867cccddfa07f3d1d783ab))
* **web:** use minute rollups up to a week, hourly beyond on history ([a605a5d](https://github.com/ediiiz/SunReye/commit/a605a5d60c83d4646ecdabd7812639ad4016fd07))
* wire Deye real-time inverter dashboard scaffold ([dc1afce](https://github.com/ediiiz/SunReye/commit/dc1afcecac6097fbdf6793e7e17397fb0c6e22a7))


### Bug Fixes

* **inverter:** make saved host optional for unconfigured installs ([12a82dc](https://github.com/ediiiz/SunReye/commit/12a82dc519e1582caa4d157fd7d58cf52f6b389a))
* **web:** mobile layout for costs charts and range picker ([76e4c14](https://github.com/ediiiz/SunReye/commit/76e4c14af006d7f169df0f4810ff4096fc0079ba))
* **web:** preserve edited number-input value on Apply ([76c6f22](https://github.com/ediiiz/SunReye/commit/76c6f22965cf8ab476de0978d45305adda100f7c))
* **web:** seed numeric control input so stepper increments from current value ([a092006](https://github.com/ediiiz/SunReye/commit/a0920065c62f324a8ca98279deb464197730f68c))
* **web:** stop eden date coercion breaking cost period keys ([f15971d](https://github.com/ediiiz/SunReye/commit/f15971d0e0b0d5686ede70f361b93802668e49cc))
