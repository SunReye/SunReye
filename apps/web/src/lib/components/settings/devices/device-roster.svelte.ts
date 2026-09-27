/**
 * A {@link DeviceRoster} over the live API, its state in `$state` so every
 * getter a view reads is reactive. One per mounted surface — the panel and the
 * wizard each make their own, with the policy their flow needs.
 */

import {
  type DeviceRoster,
  type RosterPolicy,
  createDeviceRoster,
  emptyRosterState,
} from "./device-roster";
import { edenRosterTransport } from "./roster-transport";

export function deviceRoster(policy: RosterPolicy): DeviceRoster {
  const state = $state(emptyRosterState());
  return createDeviceRoster(edenRosterTransport, state, policy);
}
