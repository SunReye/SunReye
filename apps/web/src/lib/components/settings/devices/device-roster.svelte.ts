/**
 * A {@link DeviceRoster} over the live API, its state in `$state` so every
 * getter a view reads is reactive. One per mounted surface — the panel and the
 * wizard each make their own, with the policy their flow needs.
 */

import { createContext } from "svelte";
import {
  type DeviceRoster,
  type RosterPolicy,
  createDeviceRoster,
  emptyRosterState,
} from "./device-roster";
import { coreCapabilities } from "$lib/capabilities.svelte";
import { rosterTransport } from "./roster-transport";

const transport = rosterTransport((area) => coreCapabilities.has(area));

export function deviceRoster(policy: RosterPolicy): DeviceRoster {
  const state = $state(emptyRosterState());
  return createDeviceRoster(transport, state, policy);
}

/** The roster's polled device id, read by every row below the panel without passing it through each card. */
const [getPolled, setPolled, hasPolled] = createContext<() => number | null>();

export const setPolledDevice = setPolled;

/** A getter: rows outside a roster panel (an integration's page) have no polled device. */
export function polledDevice(): () => number | null {
  return hasPolled() ? getPolled() : () => null;
}
