# Changelog

## [2.1.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v2.0.1...profile-sdk-v2.1.0) (2026-08-27)


### Features

* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **inverter-core:** add per-string yield and grid frequency roles ([452d165](https://github.com/SunReye/SunReye/commit/452d16537b3077db83a5bc5e4ae9790e8ee9b8b2))
* **inverter-core:** separate the backup output from house load ([4ae4d04](https://github.com/SunReye/SunReye/commit/4ae4d044b060c8a8299141b197948062486e12d6))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* make the role vocabulary fit non-Deye inverters ([39db7f8](https://github.com/SunReye/SunReye/commit/39db7f805c9ae02b774cce2fd06555417c029d57))
* **profile-sdk:** add `profile replay` — golden register captures ([915ad49](https://github.com/SunReye/SunReye/commit/915ad497d2a990eb27ab8442633dabb28aefeb76)), closes [#73](https://github.com/SunReye/SunReye/issues/73)
* **profile-sdk:** author a real meter against the http arm ([76c57b5](https://github.com/SunReye/SunReye/commit/76c57b52570952c966ce5bf2b6e1c145e7e6eb50))
* **profile-sdk:** lint the silent resolveKind fallback ([383c9c0](https://github.com/SunReye/SunReye/commit/383c9c08843a36c7f421911d236f6f558dd052ad))
* **profile-sdk:** six plausibility lints and a required-role build floor ([0b34134](https://github.com/SunReye/SunReye/commit/0b34134fe636018cd73c11666b8dd5eaf3a9e7e2))


### Bug Fixes

* green the suite, stop the weather tile printing NaN, and enforce TDD ([37d8e9b](https://github.com/SunReye/SunReye/commit/37d8e9b9531ef15e07bcba82bd968b358b5c590f))
* **inverter-core:** close dead-code findings on the authoring surface ([adcdc0c](https://github.com/SunReye/SunReye/commit/adcdc0c82eaabbd9c6b28cb942b3134314bbceba))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @SunReye/inverter-core bumped to 1.1.0

## [2.0.1](https://github.com/SunReye/SunReye/compare/profile-sdk-v2.0.0...profile-sdk-v2.0.1) (2026-07-18)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @SunReye/inverter-core bumped to 1.0.0

## [2.0.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v1.5.0...profile-sdk-v2.0.0) (2026-07-18)


### ⚠ BREAKING CHANGES

* no inverter profile ships in the box. Existing installs keep their installed/active profile; new installs must install one from a profile source before the full dashboard comes online.

### Features

* remove bundled SG05 profile; ship profile-agnostic core ([440fcd2](https://github.com/SunReye/SunReye/commit/440fcd2f252e1ac822eacef8ae3ad14e7685c916))

## [1.5.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v1.4.0...profile-sdk-v1.5.0) (2026-07-13)


### Features

* **profile-sdk:** version profiles change-aware on build ([2eeff87](https://github.com/SunReye/SunReye/commit/2eeff87cfdcded82a4b577ecf5fe2b4a7d9e0fb2))

## [1.4.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v1.3.0...profile-sdk-v1.4.0) (2026-07-13)


### Features

* **profile-sdk:** scaffold portable AI authoring guide + add upgrade and sumOf lint ([92fc0f9](https://github.com/SunReye/SunReye/commit/92fc0f9352844e1da98533e5b676347af4de1100))

## [1.3.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v1.2.0...profile-sdk-v1.3.0) (2026-07-12)


### Features

* **profile-sdk:** add init command to scaffold authoring projects ([61b934d](https://github.com/SunReye/SunReye/commit/61b934dbda75662f5506f42e241821fcbcfe3157))
* **profiles:** add profile families & per-model variants ([ee0879d](https://github.com/SunReye/SunReye/commit/ee0879dd9dace727780dfa3b4bb596a37d21c06b))


### Reverts

* **docs:** publish the docs site under /SunReye again ([bee80d8](https://github.com/SunReye/SunReye/commit/bee80d8b863fcce2f8e3234b1cc0f431a84631c8))

## [1.2.0](https://github.com/SunReye/SunReye/compare/profile-sdk-v1.1.0...profile-sdk-v1.2.0) (2026-07-12)


### Features

* **docs:** publish the docs site at the organization root ([710a5ea](https://github.com/SunReye/SunReye/commit/710a5eabf8185c8551130c7457c05a373bba7612))

## [1.1.0](https://github.com/ediiiz/SunReye/compare/profile-sdk-v1.0.0...profile-sdk-v1.1.0) (2026-07-12)


### Features

* **addon:** home assistant addon with embedded timescaledb ([f22b52a](https://github.com/ediiiz/SunReye/commit/f22b52a039adbb10374357afcd5a299323727f5c))

## 1.0.0 (2026-07-12)


### Features

* **profile-sdk:** declare publishConfig with provenance ([c533b3d](https://github.com/ediiiz/SunReye/commit/c533b3d03a70cabdba3727b7b8c1f214b793ebb2))
