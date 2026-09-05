# Changelog

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
