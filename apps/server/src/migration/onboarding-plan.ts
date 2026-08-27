/**
 * THE WRITE DECISION for migration onboarding — and the one-time slug window.
 *
 * `./onboarding.ts` holds the names and the status: what to ASK and what to
 * SHOW. This module holds what may be WRITTEN, which is a different question
 * with a different, narrower gate. Pure, and separate from
 * `./onboarding-apply.ts` (which issues the SQL) for the usual reason: the rule
 * that decides whether an instance's MQTT identity may still be changed deserves
 * a test that needs neither a broker nor a database.
 *
 * ## THE SLUG IS EDITABLE DURING ONBOARDING ONLY, AND FROZEN AT ANNOUNCEMENT
 *
 * This is the decision this module encodes, and the reasoning is worth keeping
 * next to the code that enforces it.
 *
 * A slug lands in every MQTT topic (`<prefix>/<plant-slug>/<device-slug>/…`) and
 * in every Home Assistant `unique_id`, permanently. That is why
 * `@SunReye/db/plant-repo`'s `PlantPatch` has no slug field at all — "a slug
 * exists so it never has to change" — and why nothing in provisioning can edit
 * one.
 *
 * But the 1.2.0 -> 2.0.0 upgrade DERIVES both slugs from whatever it could mine
 * out of the old settings blobs (the weather tile's label, the device's role), and
 * it does that before anybody has been asked. An operator whose plant is now
 * called `limburg-weilburg` because that string happened to be in a weather
 * widget has no way back. Meanwhile this release is ALREADY forcing exactly one
 * round of Home Assistant entity churn, so a correction made now — while
 * discovery is still held and nothing has been announced — costs nothing beyond
 * the churn that is happening anyway. One field, once, prevents a permanent
 * regret.
 *
 * So this is deliberately NOT a settings field. It is a separate write path with
 * two properties:
 *
 *  1. It is reachable only while the migration gate is held AND the names are
 *     still unconfirmed — {@link slugFrozen}.
 *  2. After the announcement it is PROVABLY unreachable. `./onboarding-plan.test.ts`
 *     is where that is proved, and the route has no other way to reach a slug.
 *
 * ## Why the NAMES are gated differently from the slugs
 *
 * The asymmetry is intentional. If the boot-time hold failed (the migration record
 * could not be read — `../index.ts` swallows that on purpose so a bad record
 * cannot stop the server booting), discovery has already gone out under the
 * synthesised identity. The slug is then frozen in fact, whatever this code says,
 * so refusing a change is the only honest answer. The NAMES are a different thing:
 * `name` is freely editable for the rest of the install's life, and the operator
 * still has to be able to finish onboarding — otherwise the form comes back
 * forever on an instance that can never satisfy it.
 */

import { SLUG_MAX, slugify } from "../inverter/provision";
import { type NameErrors, type NameInput, validateNames } from "./onboarding";

import type { MigrationRecord } from "@SunReye/db/upgrade-state";
import { needsMigrationOnboarding } from "@SunReye/db/upgrade-state";

/**
 * Everything the decision reads, as values.
 *
 * `discoveryHeld` is `./discovery-gate.ts`'s reason string, passed in rather than
 * imported, because the gate is module-level process state and this rule has to
 * be assertable in both positions without touching it.
 */
export interface GateState {
  record: MigrationRecord;
  /** Why discovery is withheld, or `null` — meaning it has been ANNOUNCED. */
  discoveryHeld: string | null;
}

/** The form's submission. Both names are required; both slugs are optional. */
export interface OnboardingInput extends NameInput {
  /** A corrected plant slug, or absent for "keep the derived one". */
  plantSlug?: string;
  deviceSlug?: string;
  /** The operator's history decision. `later` is a real, recorded answer. */
  migrateHistory: "now" | "later";
}

/** The slugs an instance currently carries, so an unchanged resubmit is a no-op. */
export interface CurrentSlugs {
  plantSlug: string;
  deviceSlug: string;
}

/** Which fields were rejected — the two names plus, now, the two slugs. */
export type OnboardingErrors = NameErrors & { plantSlug?: string; deviceSlug?: string };

/** What to write. A `null` slug means "leave the frozen one exactly as it is". */
export interface OnboardingPlan {
  ok: true;
  plantName: string;
  deviceName: string;
  plantSlug: string | null;
  deviceSlug: string | null;
  migrateNow: boolean;
}

export type OnboardingRefusal =
  | { ok: false; status: 409; error: "onboarding_closed" | "slug_frozen"; message: string }
  | { ok: false; status: 400; error: "invalid"; errors: OnboardingErrors };

/**
 * Whether migration onboarding may still be COMPLETED.
 *
 * The record alone, deliberately — see the module note on why the names are gated
 * more loosely than the slugs.
 */
function onboardingOpen(state: GateState): boolean {
  return needsMigrationOnboarding(state.record);
}

/**
 * Whether the MQTT identity is now permanent.
 *
 * Both conditions, and either one is enough to freeze:
 *
 *  - the names are confirmed (the record — the durable half, which also closes the
 *    window against a second request racing the first's gate release), or
 *  - discovery is no longer held, i.e. the retained announcement has gone out.
 */
export function slugFrozen(state: GateState): boolean {
  return !onboardingOpen(state) || state.discoveryHeld === null;
}

/**
 * What is wrong with a SUBMITTED slug, or `null`.
 *
 * The submission must already be CANONICAL — `slugify(value) === value`. It is
 * not quietly slugified for the operator, and that is the whole discipline of this
 * field: a value they did not type, frozen into every topic, is exactly the
 * permanent surprise the edit window exists to prevent. The message therefore
 * carries the canonical form, so the fix is one paste away.
 */
function slugProblem(value: string): string | null {
  if (value.length === 0) {
    return "A slug cannot be empty — it is a segment of the MQTT topic.";
  }
  if (value.length > SLUG_MAX) {
    return `A slug must be at most ${SLUG_MAX} characters.`;
  }
  const canonical = slugify(value);
  if (canonical !== value) {
    return canonical.length === 0
      ? "A slug must contain at least one letter or number."
      : `Use lower-case letters, digits and dashes only — e.g. "${canonical}".`;
  }
  return null;
}

/**
 * The slug to write, or `null` for "unchanged" — collecting any problem.
 *
 * An unchanged value is not a change, so it does not meet the freeze. The form
 * round-trips what it was shown, and refusing the second submit of an unedited
 * form would be a refusal the operator cannot act on.
 */
function plannedSlug(
  submitted: string | undefined,
  current: string | undefined,
): { slug: string | null; changed: boolean; problem: string | null } {
  if (submitted === undefined) return { slug: null, changed: false, problem: null };
  const problem = slugProblem(submitted);
  if (problem !== null) return { slug: null, changed: submitted !== current, problem };
  if (submitted === current) return { slug: null, changed: false, problem: null };
  return { slug: submitted, changed: true, problem: null };
}

/**
 * The two slugs' plans, and which of them are CHANGES.
 *
 * Split out so {@link planOnboarding} reads as three guards and a result rather
 * than as an interleaving of both fields' handling — which is what it was, and it
 * is the function where "the slug can no longer change" is enforced.
 */
function plannedSlugs(input: OnboardingInput, current?: CurrentSlugs) {
  const plant = plannedSlug(input.plantSlug, current?.plantSlug);
  const device = plannedSlug(input.deviceSlug, current?.deviceSlug);
  return {
    plant,
    device,
    changing: [...(plant.changed ? ["plantSlug"] : []), ...(device.changed ? ["deviceSlug"] : [])],
  };
}

/** The refusal a closed window earns, in the operator's terms. */
function closed(): OnboardingRefusal {
  return {
    ok: false,
    status: 409,
    error: "onboarding_closed",
    message:
      "Migration onboarding is not open on this instance: there is no unconfirmed 1.x migration.",
  };
}

/** The refusal a frozen identity earns, NAMING the fields that were refused. */
function frozen(changing: readonly string[]): OnboardingRefusal {
  return {
    ok: false,
    status: 409,
    error: "slug_frozen",
    message:
      `Home Assistant discovery has already been announced, so ${changing.join(" and ")} ` +
      "cannot be changed: every retained topic and every entity unique_id is built from it.",
  };
}

/**
 * Every field problem, names and slugs together, or `null`.
 *
 * Both halves are reported in ONE response. The form is shown once, on an instance
 * whose discovery is held; making the operator submit twice to discover the second
 * mistake is how a two-field form becomes a thing they walk away from.
 */
function fieldProblems(
  input: OnboardingInput,
  slugs: ReturnType<typeof plannedSlugs>,
): OnboardingErrors | null {
  const validated = validateNames(input);
  const errors: OnboardingErrors = validated.ok ? {} : { ...validated.errors };
  if (slugs.plant.problem !== null) errors.plantSlug = slugs.plant.problem;
  if (slugs.device.problem !== null) errors.deviceSlug = slugs.device.problem;
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * What migration onboarding should write, or why it will not.
 *
 * Order matters and is the security of the thing: the CLOSED check comes first
 * (nothing at all is written after onboarding), the FROZEN check second (names may
 * still land, a slug may not), and only then the field validation. Validating
 * first would let a well-formed slug reach the freeze check by a different path
 * every time somebody added a field.
 *
 * `current` is optional so a caller that has not read the rows yet still gets the
 * refusal; without it every submitted slug counts as a change, which is the safe
 * direction.
 */
export function planOnboarding(
  state: GateState,
  input: OnboardingInput,
  current?: CurrentSlugs,
): OnboardingPlan | OnboardingRefusal {
  if (!onboardingOpen(state)) return closed();

  const slugs = plannedSlugs(input, current);
  if (slugs.changing.length > 0 && slugFrozen(state)) return frozen(slugs.changing);

  const errors = fieldProblems(input, slugs);
  if (errors !== null) return { ok: false, status: 400, error: "invalid", errors };

  const names = validateNames(input);
  // Unreachable: `fieldProblems` returns every name problem there is, so a
  // validation that failed has already been answered above. Narrowing, not a guard.
  if (!names.ok) return { ok: false, status: 400, error: "invalid", errors: names.errors };

  return {
    ok: true,
    plantName: names.plantName,
    deviceName: names.deviceName,
    plantSlug: slugs.plant.slug,
    deviceSlug: slugs.device.slug,
    migrateNow: input.migrateHistory === "now",
  };
}

/**
 * Whether the missing-history banner is snoozed right now.
 *
 * A snooze rather than a dismissal, and this is a product decision with a reason:
 * the banner exists because "a deferred migration that leaves the app looking
 * complete never gets run" (`@SunReye/db/upgrade-state`). A permanent dismissal
 * is precisely that state, arrived at one click later. So the operator can put it
 * away and it comes back.
 *
 * An UNPARSEABLE stored instant shows the banner. Every degradation here lands on
 * "show it": the failure mode of hiding is an operator who never learns two months
 * of their history is absent, and the failure mode of showing is a line of text.
 */
export function bannerSuppressed(snoozedUntil: string | null, now: Date): boolean {
  if (snoozedUntil === null) return false;
  const until = Date.parse(snoozedUntil);
  return !Number.isNaN(until) && until > now.getTime();
}

/**
 * The device the 1.2.0 history was re-keyed onto, or `null`.
 *
 * Two arms, narrowing, and they mirror `../inverter/provision.ts`'s `findDevice`
 * deliberately — this has to name the SAME row provisioning created, or the
 * backfill writes five million rows against a device nothing reads:
 *
 *  1. the row carrying the 1.2.0 `inverter_id` as its `profile_id`. The normal case.
 *  2. the plant's `role = 'inverter'` row. This is what survives a profile SWAP
 *     between the cutover and onboarding, after which arm 1 matches nothing.
 *
 * A CONTROLLER is never adopted, at either arm. A Victron GX's registers carry
 * plant-level values; re-pointing one at an inverter's history would make its
 * readings claim to be an inverter's, which is the class of silent mislabelling
 * 2.0.0 exists to end.
 */
export function migratedDevice<T extends { profileId: string; role: string }>(
  devices: readonly T[],
  sourceId: string | null,
): T | null {
  const byProfile =
    sourceId === null
      ? undefined
      : devices.find((d) => d.profileId === sourceId && d.role === "inverter");
  return byProfile ?? devices.find((d) => d.role === "inverter") ?? null;
}

/** Why a backfill cannot start, or the device it will write against. */
export type BackfillTarget =
  | { ok: true; deviceId: number }
  | { ok: false; reason: "no-plant" | "no-device" };

/**
 * Which device the history backfill must key five million replayed rows to.
 *
 * Pure, and separate from the driver that issues the SQL, because getting this
 * wrong does not fail — it succeeds against the wrong row. Every carried reading
 * would land on a device nothing reads, the charts would stay empty, and the
 * migration record would say `backfilled`.
 *
 * Both refusals are real states, not defensiveness: an install whose provisioning
 * never ran has no plant, and one whose only device is a CONTROLLER has nothing an
 * inverter's history may be attributed to ({@link migratedDevice} refuses to adopt
 * one). Reporting them beats writing somewhere plausible.
 */
export function backfillTarget<T extends { profileId: string; role: string; id: number }>(
  record: MigrationRecord,
  plant: { id: number } | null,
  devices: readonly T[],
): BackfillTarget {
  if (plant === null) return { ok: false, reason: "no-plant" };
  const device = migratedDevice(devices, record.sourceId);
  return device === null ? { ok: false, reason: "no-device" } : { ok: true, deviceId: device.id };
}
