/**
 * The two reads and the one refusal that BOTH integration surfaces make.
 *
 * The devices panel lists every integration under its connection; the detail
 * page shows one of them. They fetch the same list, render the same catalog and
 * report a failed write in the same words — three blocks that were verbatim
 * copies of each other, which is three chances for the two pages to start
 * telling an operator different things about the same 409.
 *
 * Deliberately thin. Nothing here decides anything: the calls are the treaty's,
 * and what to do with an absent answer stays with the caller, because "the list
 * has not arrived" means something different on a page that is a list and on a
 * page that has to find one row in it.
 */

import { api } from "$lib/api";
import * as m from "$lib/paraglide/messages";
import { toast } from "svelte-sonner";
import { apiErrorText } from "../api-error";
import type { IntegrationView } from "../devices/device-types";
import type { Catalog } from "../wizard/add-wizard";

/** Every configured integration, or null when the request failed. */
export async function readIntegrations(): Promise<IntegrationView[] | null> {
  const { data } = await api.api.integrations.get();
  if (!data) return null;
  return (data as { integrations: IntegrationView[] }).integrations;
}

/** What each integration kind's settings step asks for, or null on failure. */
export async function readCatalog(): Promise<Catalog | null> {
  const { data } = await api.api.integrations.catalog.get();
  return data ? (data as Catalog) : null;
}

/** A refused write, in the operator's language, with the server's own reason. */
export function refuseIntegration(error: unknown): void {
  toast.error(
    m.devices_integration_toast_failed({ error: apiErrorText(error, m.error_unknown()) }),
  );
}
