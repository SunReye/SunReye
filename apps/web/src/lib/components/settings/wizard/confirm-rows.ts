/**
 * WHAT STEP 4 SAYS ABOUT STEP 3'S ANSWERS.
 *
 * Out of the component because the two tiers say it differently and the choice
 * is a rule, not a render: a coded integration's answers ARE a field bag, so
 * each one is one line; a device is not, and dumping its form through
 * `String()` reads "arrays: [object Object]" — or, for the four fields that
 * matter, nothing at all.
 */

import * as m from "$lib/paraglide/messages";
import type { AddDeviceForm } from "../devices/device-types";
import { roleLabel } from "../devices/role-label";
import type { RegisteredProfile } from "../profile-types";
import type { WizardAnswers } from "./add-wizard";
import { fieldLabel } from "./field-label";

/** One line of the confirm list. `mono` is for the machine-shaped values. */
export type ConfirmRow = { key: string; label: string; value: string; mono: boolean };

/** The name a registered profile goes by, or its raw id when this build has none. */
function profileName(id: string, registered: readonly RegisteredProfile[]): string {
  return registered.find((p) => p.id === id)?.name ?? id;
}

/** A DEVICE, in words: what it is called, what it is, and where it answers. */
function deviceRows(form: AddDeviceForm, registered: readonly RegisteredProfile[]): ConfirmRow[] {
  return [
    { key: "name", label: m.devices_field_name(), value: form.name.trim(), mono: false },
    { key: "role", label: m.devices_field_role(), value: roleLabel(form.role), mono: false },
    {
      key: "profileId",
      label: m.devices_field_profile(),
      value: profileName(form.profileId, registered),
      mono: false,
    },
    { key: "unitId", label: m.devices_field_unit_id(), value: String(form.unitId), mono: true },
  ];
}

/** A coded integration's own settings, one line per field the catalog asked for. */
function codedRows(values: Record<string, unknown>): ConfirmRow[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    label: fieldLabel(key),
    value: String(value),
    mono: true,
  }));
}

export function answerRows(
  answers: WizardAnswers,
  registered: readonly RegisteredProfile[],
): ConfirmRow[] {
  return answers.via === "profile"
    ? deviceRows(answers.form, registered)
    : codedRows(answers.values);
}
