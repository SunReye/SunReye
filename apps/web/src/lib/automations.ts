/**
 * Type bridge for the automations feature: the client is typed against the
 * exact server/db shapes (type-only imports, nothing bundles) instead of
 * hand-mirroring them. Served by `/api/settings/automations` and
 * `/api/automations/status`.
 */

export type {
  AutomationConfig,
  AutomationHistoryView,
  AutomationPlanView,
  AutomationStatusView,
  AutomationStreamMessage,
  Blocker,
  DecisionPoint,
  PeakShavingPlan,
  PeakShavingPlans,
  PeakShavingRunState,
  PeakShavingStatus,
  PlanSlot,
} from "@SunReye/contracts/automation";
