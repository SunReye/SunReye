/**
 * Type bridge for the automations feature: the client is typed against the
 * exact server/db shapes (type-only imports, nothing bundles) instead of
 * hand-mirroring them. Served by `/api/settings/automations` and, for
 * everything live, by the `automations` topic on the shared socket — the three
 * `…View` payloads of the old status/history/plan polls are gone with the
 * polls, since the subscribe-time snapshot carries all three in one frame.
 */

export type {
  AutomationConfig,
  AutomationStreamMessage,
  Blocker,
  DecisionPoint,
  PeakShavingPlan,
  PeakShavingPlans,
  PeakShavingRunState,
  PeakShavingStatus,
  PlanSlot,
} from "@SunReye/contracts/automation";
