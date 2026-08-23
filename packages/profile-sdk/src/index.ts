// Authoring API re-exported from @SunReye/inverter-core (private, bundled into
// the published package) so npm consumers get defineProfile & friends from here.
export {
  control,
  defineFamily,
  defineProfile,
  defineVariant,
  metric,
  sumOf,
} from "@SunReye/inverter-core";
export type {
  AggregateExpr,
  AggregateMatch,
  MetricAdd,
  MetricOpts,
  MetricPatch,
  MetricsOverlay,
  ModelOverrides,
} from "@SunReye/inverter-core";
export { parseProfileData, profileDataSchema, safeParseProfileData } from "@SunReye/inverter-core";
export type {
  CanonicalRole,
  ComputeExpr,
  ControlExpr,
  MetricDataDef,
  ProfileData,
  RoleSpec,
  TopicToKey,
} from "@SunReye/inverter-core";
export { ROLE_CATALOG, ROLE_NAMES } from "@SunReye/inverter-core";
export { repoIndexSchema, repoProfileEntrySchema } from "@SunReye/inverter-core";
export type { RepoIndex, RepoProfileEntry } from "@SunReye/inverter-core";

export { lintProfile, validateProfile } from "./validate";
export type { ValidationResult } from "./validate";
export { coverage, groupByPrefix, isIndexedRole, suggestAggregates } from "./coverage";
export type { AggregateSuggestion, CoverageReport } from "./coverage";
export { scaffoldFromCsv } from "./scaffold";
export type { ScaffoldMeta } from "./scaffold";
export { scaffoldProject } from "./init";
export type { InitOptions } from "./init";
export { exerciseProfile } from "./harness";
export type { HarnessResult } from "./harness";
export { buildRepo } from "./repo";
export type { BuildRepoOptions, RepoBuildResult, RepoEntryInput } from "./repo";
