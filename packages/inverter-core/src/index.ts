export * from "./types";
export { decode, encodeWord, registerWidth, clampReports, resetClampReports } from "./codec";
export type { ClampReport } from "./codec";
export { ModbusInverter } from "./driver";
export { ModbusTransport, planReads } from "./modbus-transport";
export type { ReadBlock } from "./modbus-transport";
export { HttpReadError, HttpTransport } from "./http-transport";
export type { HttpFailureKind } from "./http-transport";
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
  hasResolvableKind,
  kindFallbackKeys,
  kindFallbackReports,
  resetKindFallbacks,
  deriveCapabilities,
  toManifestMetric,
  buildManifest,
} from "./capabilities";
export type { KindFallbackReport, KindInputs, KindResolvable } from "./capabilities";
export { entityConstraint, writableMetrics, metricByKey } from "./entities";
export type { EntityConstraint, EntityValueType } from "./entities";
// Profile authoring SDK + serializable data model + validator.
export { ROLE_CATALOG, ROLE_NAMES } from "./roles";
export type { CanonicalRole, RoleSpec } from "./roles";
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
export { bindingFor, compileComputeExpr, hydrateProfile } from "./profile-data";
export type {
  AggregateExpr,
  AggregateMatch,
  ComputeExpr,
  ControlExpr,
  MetricDataDef,
  ProfileData,
  TopicToKey,
} from "./profile-data";
export { profileDataSchema, parseProfileData, safeParseProfileData } from "./schema";
export { repoIndexSchema, repoProfileEntrySchema } from "./repo-index";
export type { RepoIndex, RepoProfileEntry } from "./repo-index";
export { bumpVersion, compareSemver, isNewerVersion, parseSemver } from "./semver";
export type { BumpLevel, SemverParts } from "./semver";
