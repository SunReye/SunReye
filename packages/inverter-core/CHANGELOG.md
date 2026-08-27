# Changelog

## [1.1.0](https://github.com/SunReye/SunReye/compare/inverter-core-v1.0.0...inverter-core-v1.1.0) (2026-08-27)


### Features

* **automation:** steer battery limits in watts as well as amps ([b6bd8d8](https://github.com/SunReye/SunReye/commit/b6bd8d851364a02d68505affcc5f3522f91e5830))
* **inverter-core:** add per-string yield and grid frequency roles ([452d165](https://github.com/SunReye/SunReye/commit/452d16537b3077db83a5bc5e4ae9790e8ee9b8b2))
* **inverter-core:** an http arm on the binding union ([5f3f051](https://github.com/SunReye/SunReye/commit/5f3f0516b0071a92e50d22ddf71b8a1e022b7e08))
* **inverter-core:** an HTTP transport behind the same seam ([048dcb6](https://github.com/SunReye/SunReye/commit/048dcb6628ee430e695f224b4cae03b93436aa11))
* **inverter-core:** sample computed-metric inputs in one atomic read ([fea7f48](https://github.com/SunReye/SunReye/commit/fea7f48eacd16930e488386afc20b268f058e7ab))
* **inverter-core:** say when a sample was not read all at once ([b607cc0](https://github.com/SunReye/SunReye/commit/b607cc0ae37fa9730741dbf21395f8f67aca126e))
* **inverter-core:** separate the backup output from house load ([4ae4d04](https://github.com/SunReye/SunReye/commit/4ae4d044b060c8a8299141b197948062486e12d6))
* **inverter-core:** storage class and deadband as authored profile fields ([3640187](https://github.com/SunReye/SunReye/commit/3640187f5522d10b7a252cac444ea462b2e3a88a))
* make the role vocabulary fit non-Deye inverters ([39db7f8](https://github.com/SunReye/SunReye/commit/39db7f805c9ae02b774cce2fd06555417c029d57))
* **profile-sdk:** author a real meter against the http arm ([76c57b5](https://github.com/SunReye/SunReye/commit/76c57b52570952c966ce5bf2b6e1c145e7e6eb50))
* **profile-sdk:** lint the silent resolveKind fallback ([383c9c0](https://github.com/SunReye/SunReye/commit/383c9c08843a36c7f421911d236f6f558dd052ad))


### Bug Fixes

* green the suite, stop the weather tile printing NaN, and enforce TDD ([37d8e9b](https://github.com/SunReye/SunReye/commit/37d8e9b9531ef15e07bcba82bd968b358b5c590f))
* **inverter-core:** close dead-code findings on the authoring surface ([adcdc0c](https://github.com/SunReye/SunReye/commit/adcdc0c82eaabbd9c6b28cb942b3134314bbceba))
* **inverter-core:** never fabricate a reading, never wrap a write ([7f0586b](https://github.com/SunReye/SunReye/commit/7f0586beeec74471bf6c85deafa762632ecd576b))
* **inverter-core:** three holes an adversarial pass found in the http arm ([9cad2d8](https://github.com/SunReye/SunReye/commit/9cad2d85c53fe2dde8d93b66f26f42ad7a63b113))
* **test:** run the suites against a valid env and the real sources ([b442100](https://github.com/SunReye/SunReye/commit/b442100df65ac579e12d46c09bf5eb6c7d065fc7))

## 1.0.0 (2026-07-18)


### ⚠ BREAKING CHANGES

* no inverter profile ships in the box. Existing installs keep their installed/active profile; new installs must install one from a profile source before the full dashboard comes online.

### Features

* **inverter-core:** add clamp compute primitive for directional metrics ([cddb0e7](https://github.com/SunReye/SunReye/commit/cddb0e77b5b2736fcc887104568ccd77ef691432))
* **inverter-core:** add semver parse/compare/bump utilities ([0bbdfe7](https://github.com/SunReye/SunReye/commit/0bbdfe760a314d546a229cdb278edce1f1d943cf))
* **inverter-core:** add sumOf deferred aggregates + prune dangling overlay refs ([41b413e](https://github.com/SunReye/SunReye/commit/41b413e4c6381a05ed204e4f8a84ef5fb7de4e20))
* **inverter-core:** generic role-based coherent simulator ([b2cbe12](https://github.com/SunReye/SunReye/commit/b2cbe129c1cc37467647cd10caf5041c40eccd94))
* **inverter:** add computed self-consumption and efficiency metrics ([73e0043](https://github.com/SunReye/SunReye/commit/73e00431efa69f177e7cc978f125f637b791cc7e))
* **inverter:** drive time-of-use target by battery mode ([e3b1188](https://github.com/SunReye/SunReye/commit/e3b1188c4c791a4f6e5287628e94130a93fdff63))
* **profiles:** add profile families & per-model variants ([ee0879d](https://github.com/SunReye/SunReye/commit/ee0879dd9dace727780dfa3b4bb596a37d21c06b))
* remove bundled SG05 profile; ship profile-agnostic core ([440fcd2](https://github.com/SunReye/SunReye/commit/440fcd2f252e1ac822eacef8ae3ad14e7685c916))


### Bug Fixes

* **inverter-core:** clamp range-annotated computed metrics ([f5d9132](https://github.com/SunReye/SunReye/commit/f5d9132cabcd51829623415e8f083f9125f2ba0e))
* **inverter-core:** serialize modbus client and write via FC16 ([2cd1b2c](https://github.com/SunReye/SunReye/commit/2cd1b2cfff9c51dd968f75396972e016d149a0db))
* **profiles:** register downloaded profiles immediately, no restart ([7bca64e](https://github.com/SunReye/SunReye/commit/7bca64e994e04de6cd96554fe2623f6645268f60))
