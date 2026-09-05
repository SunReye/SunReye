/**
 * MIGRATION ONBOARDING: the two names the 1.2.0 -> 2.0.0 upgrade cannot invent,
 * and the status every read of a half-migrated instance hangs off.
 *
 * ## Why anything has to be asked at all
 *
 * 1.2.0 had no plants and no devices. It had ONE `inverter` app_setting, and
 * every reading was keyed by the PROFILE id. 2.0.0 keys readings by
 * `devices.id`, publishes MQTT under `<plant-slug>/<device-slug>/…`, and Home
 * Assistant keys its entities on the `unique_id` built from those slugs. The
 * blocking step can synthesise the ROWS (`../inverter/provision.ts`), but it
 * cannot synthesise the two strings that become permanent identifiers, so it
 * asks — once, on first open after the update.
 *
 * ## Why both fields are REQUIRED, and why that is not a wizard
 *
 * A discovery announcement is retained on the broker and keyed by `unique_id`.
 * Announcing under a placeholder is therefore not something a later rename can
 * take back: the old entities stay, the new ones appear beside them, and every
 * automation the operator built points at the wrong half. So discovery is HELD
 * until both names exist (`./discovery-gate.ts`) and neither field can be
 * skipped.
 *
 * The DEVICE name is the one nobody remembers to ask for. The migration
 * synthesises exactly one device, an auto-generated slug for it would be just as
 * permanent as a chosen one, and it is invisible in the UI until it is already in
 * every topic. It is pre-filled from the profile ({@link defaultDeviceName}) so
 * the form is one keystroke from correct, and captured anyway.
 *
 * Two fields on one form, not a wizard: a wizard is a thing an operator abandons
 * halfway, and a half-finished migration onboarding holds discovery indefinitely.
 *
 * ## Why the logic is pure and lives here
 *
 * Everything below is a function of a {@link MigrationRecord} and two strings, so
 * the rules that decide whether an instance's history is complete are testable
 * without a database — which is the point, because the same record is what
 * `../shared/history-horizon.ts` refuses partial windows from.
 */

import {
  type MigrationRecord,
  backfillOutstanding,
  describeMissingHistory,
  migrationHorizonFrom,
  needsMigrationOnboarding,
} from "@SunReye/db/upgrade-state";

import { SLUG_MAX, slugify } from "../inverter/provision";

/**
 * The longest name accepted, which is the longest slug that survives intact.
 *
 * Tied to `slugify`'s ceiling rather than picked: `slugify` SLICES at `SLUG_MAX`,
 * so a longer name would be silently cut down to a slug the operator never chose
 * and could never change, in every topic and every `unique_id`. Refusing is the
 * only honest option — see the module note on why these strings are permanent.
 */
// fallow-ignore-next-line unused-export -- the limit the form renders and validateNames enforces below; asserted by ./onboarding.test.ts, and test files are not traced as consumers.
export const NAME_MAX = SLUG_MAX;

/** The two names, as the form submits them. */
export interface NameInput {
  plantName: string;
  deviceName: string;
}

/** Which fields were rejected, and why — in the operator's words. */
export type NameErrors = Partial<Record<keyof NameInput, string>>;

export type NameValidation = ({ ok: true } & NameInput) | { ok: false; errors: NameErrors };

/** Which name a message is about, so one rule can serve both fields. */
const LABEL: Record<keyof NameInput, string> = {
  plantName: "Plant name",
  deviceName: "Device name",
};

/**
 * Everything wrong with one name, or `null`.
 *
 * Checked in this order deliberately: an empty field is the common case and
 * deserves the plain message, and the length refusal must NAME the limit
 * ({@link NAME_MAX}) because "too long" without a number is a field an operator
 * edits blind.
 *
 * The last rule is the subtle one. `"!!!"` is non-empty, passes a required check,
 * and slugifies to `""` — which renders `<prefix>//<topic>`, not a topic. It has
 * to be refused at the FORM, because by the time it is a slug it is frozen.
 */
function nameProblem(field: keyof NameInput, value: string): string | null {
  if (value.length === 0) return `${LABEL[field]} is required.`;
  if (value.length > NAME_MAX) {
    return `${LABEL[field]} must be at most ${NAME_MAX} characters — it becomes part of the MQTT topic and cannot be changed later.`;
  }
  if (slugify(value).length === 0) {
    return `${LABEL[field]} must contain at least one letter or number.`;
  }
  return null;
}

/**
 * Both names, trimmed and accepted — or every problem at once.
 *
 * BOTH fields are reported together rather than one per round trip. The form is
 * shown once, on an instance whose history is mid-migration and whose discovery
 * is held; making the operator submit twice to discover the second mistake is how
 * a two-field form becomes a thing they walk away from.
 */
export function validateNames(input: NameInput): NameValidation {
  const plantName = input.plantName.trim();
  const deviceName = input.deviceName.trim();
  const errors: NameErrors = {};
  const plantProblem = nameProblem("plantName", plantName);
  if (plantProblem !== null) errors.plantName = plantProblem;
  const deviceProblem = nameProblem("deviceName", deviceName);
  if (deviceProblem !== null) errors.deviceName = deviceProblem;
  if (plantProblem !== null || deviceProblem !== null) return { ok: false, errors };
  return { ok: true, plantName, deviceName };
}

/** As much of the active profile as a default name can be built from. */
export interface ProfileNaming {
  id: string;
  name?: string | null;
}

/**
 * The device-name field's pre-filled value.
 *
 * NEVER blank, and that is the whole requirement: a blank field is the one an
 * operator submits without reading, and the value they submit here is frozen. The
 * profile's human name is the good answer ("Deye SG05LP3"); its id is the
 * fallback, which is ugly but recognisable and — crucially — visibly THEIRS to
 * edit.
 */
export function defaultDeviceName(profile: ProfileNaming): string {
  const name = profile.name?.trim() ?? "";
  return name.length > 0 ? name : profile.id;
}

/** What the app needs to know about a migration, on every page load. */
export interface MigrationStatus {
  /** Show the onboarding form, and hold discovery, until this is false. */
  onboardingRequired: boolean;
  /** The history backfill has not finished. `deferred` counts. */
  backfillOutstanding: boolean;
  /** The banner, which NAMES the missing span — or `null` when nothing is. */
  banner: string | null;
  /** The oldest instant the new schema can answer, ISO, or `null`. */
  historyFrom: string | null;
  /** Pre-fill for the form, so it opens showing what is already set. */
  plantName: string;
  deviceName: string;
}

/**
 * The migration's state, as one object the UI can render without a second call.
 *
 * The names travel WITH the status. Two round trips would let the form paint
 * empty while the names load, and an empty required field that fills in a moment
 * later is a field the operator has already started typing over.
 *
 * `historyFrom` and `banner` come from the same {@link migrationHorizonFrom}
 * the read guard refuses partial windows with (`../shared/history-horizon.ts`), so
 * the date the banner shows and the date a 422 reports cannot disagree — which
 * they would if either side computed its own.
 */
export function migrationStatus(record: MigrationRecord, names: NameInput): MigrationStatus {
  const horizon = migrationHorizonFrom(record);
  return {
    onboardingRequired: needsMigrationOnboarding(record),
    backfillOutstanding: backfillOutstanding(record),
    banner: describeMissingHistory(record),
    historyFrom: horizon === null ? null : horizon.toISOString(),
    plantName: names.plantName,
    deviceName: names.deviceName,
  };
}

/**
 * Why Home Assistant discovery must be HELD, or `null` to announce.
 *
 * The pure half of the boot-time decision, so the rule that decides whether an
 * instance's MQTT identity is publishable is testable without a broker or a
 * database. `../inverter/mqtt.ts` acts on it through `./discovery-gate.ts`.
 *
 * It is a thin wrapper over {@link needsMigrationOnboarding} deliberately: the
 * gate and the onboarding form must open and close on EXACTLY the same condition.
 * Two predicates that could disagree would either hold discovery on an instance
 * with no form to fill in, or announce under names nobody had confirmed.
 */
export function migrationGateReason(record: MigrationRecord): string | null {
  return needsMigrationOnboarding(record)
    ? "the 1.2.0 -> 2.0.0 migration's plant and device names have not been confirmed yet"
    : null;
}
