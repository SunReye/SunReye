import { afterEach, describe, expect, test } from "bun:test";

import {
  discoveryHeld,
  holdDiscovery,
  onDiscoveryRelease,
  releaseDiscovery,
  resetDiscoveryGate,
} from "./discovery-gate";

afterEach(() => resetDiscoveryGate());

describe("the discovery gate", () => {
  test("is NOT held by default — an install that never migrated is unaffected", () => {
    // A gate defaulting to held would, on the first boot where whatever clears it
    // failed, look exactly like a broken MQTT bridge, and nothing would connect
    // the two.
    expect(discoveryHeld()).toBeNull();
  });

  test("holds with a reason the log and the API can both show", () => {
    holdDiscovery("migration onboarding not completed");
    expect(discoveryHeld()).toBe("migration onboarding not completed");
  });

  test("holding twice is idempotent", () => {
    holdDiscovery("a");
    holdDiscovery("a");
    expect(discoveryHeld()).toBe("a");
  });

  test("releasing lifts the gate and notifies, so the announcement is immediate", () => {
    // Waiting for the broker to next drop the connection would leave a plant with
    // no entities in Home Assistant for an unbounded time after the operator did
    // everything right.
    let announced = 0;
    onDiscoveryRelease(() => (announced += 1));
    holdDiscovery("a");
    releaseDiscovery();
    expect(discoveryHeld()).toBeNull();
    expect(announced).toBe(1);
  });

  test("releasing an ungated bridge announces NOTHING", () => {
    // A second confirmation must not republish every retained config for no
    // reason — each one is a write to the broker that HA re-reads.
    let announced = 0;
    onDiscoveryRelease(() => (announced += 1));
    releaseDiscovery();
    expect(announced).toBe(0);
  });

  test("every listener is notified, and unsubscribing stops it", () => {
    let a = 0;
    let b = 0;
    onDiscoveryRelease(() => (a += 1));
    const off = onDiscoveryRelease(() => (b += 1));
    off();
    holdDiscovery("x");
    releaseDiscovery();
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  test("a restarted bridge does not leak a listener", () => {
    // The bridge is rebuilt on a profile swap and on a settings save. Without the
    // unsubscribe, each rebuild would add an announcement to every later lift.
    const offs = [1, 2, 3].map(() => onDiscoveryRelease(() => {}));
    for (const off of offs) off();
    let announced = 0;
    onDiscoveryRelease(() => (announced += 1));
    holdDiscovery("x");
    releaseDiscovery();
    expect(announced).toBe(1);
  });
});
