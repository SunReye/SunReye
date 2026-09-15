export * from "./types";
// The framing list, hoisted below every package that needs it (see the file).
// Also its own subpath (`@SunReye/inverter-core/transports`) for the packages
// that must not pull `modbus-serial` in through this barrel.
export { MODBUS_TRANSPORTS, narrowTransport } from "./transports";
export { errorMessage } from "./error-message";
export { decode, encodeWord, registerWidth, clampReports, resetClampReports } from "./codec";
export type { ClampReport } from "./codec";
export { ModbusInverter } from "./driver";
export { ModbusTransport, planReads } from "./modbus-transport";
export type { ReadBlock } from "./modbus-transport";
export { HttpReadError, HttpTransport } from "./http-transport";
export type { HttpFailureKind } from "./http-transport";
// Solarman V5 is a FRAMING under `kind: "modbus"`, not a device kind — the codec
// and the port are exported so the server can decode a capture, and so tests
// outside this package can build a frame without restating the envelope. This
// barrel is already Node-only (it pulls in `modbus-serial`), so the port living
// here costs nothing new; it must NOT gain a browser-visible entry point.
export {
  checksum,
  decodeFrame,
  encodeRequest,
  splitFrames,
  SolarmanFrameError,
  SolarmanV5Port,
} from "./solarman";
export type {
  EncodeRequestInput,
  SolarmanFrame,
  SolarmanFrameReason,
  SolarmanSocket,
  SolarmanSocketFactory,
  SolarmanSocketHandlers,
  SolarmanV5PortOptions,
} from "./solarman";
export { applyComputed } from "./computed";
export { SimulatedInverter } from "./simulator";
export { genericSimulate } from "./generic-sim";
export {
  registerProfile,
  unregisterProfile,
  getProfile,
  tryGetProfile,
  listProfiles,
  createInverter,
} from "./registry";
export {
  resolveKind,
  resolveStorage,
  resolveDeadband,
  statedKind,
  metricKeySpecs,
  hasResolvableKind,
  kindFallbackKeys,
  kindFallbackReports,
  resetKindFallbacks,
  deriveCapabilities,
  toManifestMetric,
  buildManifest,
} from "./capabilities";
export { DEVICE_CLASSES, isDeviceClass } from "./device-class";
export { deviceInstance, instanceFromProfile, roleBindings } from "./device-instance";
export type {
  DeviceClass,
  DeviceInstance,
  DeviceInstanceSpec,
  DeviceMetric,
  ProfileInstanceSpec,
  RoleBinding,
  RoleKey,
} from "./device-instance";
export type {
  CapabilityInputs,
  CapabilityMetric,
  DeadbandInputs,
  KindFallbackReport,
  KindInputs,
  KindResolvable,
  MetricKeyFacts,
  StorageInputs,
} from "./capabilities";
export { entityConstraint, writableMetrics, metricByKey } from "./entities";
export type { EntityConstraint, EntityValueType } from "./entities";
// Profile authoring SDK + serializable data model + validator.
export { ROLE_CATALOG, ROLE_NAMES } from "./roles";
export { PLANT_AGGREGATES, plantAggregateOf } from "./plant-aggregate";
export type { PlantAggregate } from "./plant-aggregate";
export type { CanonicalRole, RoleSpec } from "./roles";
// The optimizer's stored enums live in `./optimizer-vocabulary.ts` and are
// deliberately NOT re-exported here: the browser reads them too, and this barrel
// pulls in `modbus-serial` — a Node transport that dies at import in a browser
// (`ReferenceError: Buffer is not defined`). They are reached through the
// package's `/optimizer` subpath instead, by both sides.
export { control, defineFamily, defineProfile, defineVariant, metric, sumOf } from "./define";
export type {
  BaseMetricOpts,
  BoundMetricDef,
  ControlOpts,
  MetricAdd,
  MetricOpts,
  MetricPatch,
  MetricsOverlay,
  ModelOverrides,
  RoledMetricOpts,
  UnroledMetricOpts,
} from "./define";
export {
  bindingFor,
  compileComputeExpr,
  declarationsOf,
  hydrateProfile,
  PROFILE_SCHEMA_VERSIONS,
} from "./profile-data";
export type {
  AggregateExpr,
  AggregateMatch,
  ComputeExpr,
  ControlExpr,
  MetricDataDef,
  ProfileData,
  ProfileSchemaVersion,
  TopicToKey,
} from "./profile-data";
export { profileDataSchema, parseProfileData, safeParseProfileData } from "./schema";
export { repoIndexSchema, repoProfileEntrySchema } from "./repo-index";
export type { RepoIndex, RepoProfileEntry } from "./repo-index";
export { bumpVersion, compareSemver, isNewerVersion, parseSemver } from "./semver";
export type { BumpLevel, SemverParts } from "./semver";
