/**
 * "Try it before saving it": a throwaway read of an inverter address and a
 * throwaway dial of a broker, neither of which touches the live poll loop or the
 * export. Out of `./runtime.ts` because they share none of its state — they
 * only ever borrowed its imports — and every collaborator is injected here.
 */

import type { MqttParams } from "@SunReye/db/connection-kinds";
import { type InverterProfile, type InverterSource, errorMessage } from "@SunReye/inverter-core";

import type { ProfileContext, SourceConnection } from "./inverter";

/** One captured value from a test read, enriched for a plausibility check. */
export interface TestSnapshotMetric {
  key: string;
  label: string;
  unit: string | null;
  group: string;
  value: number;
  /** Enum label for the raw value, when the metric is an enum/status. */
  display?: string;
}

export interface TestInverterResult {
  ok: boolean;
  error?: string;
  metricCount?: number;
  /** Wall-clock duration of the single test read, ms. */
  durationMs?: number;
  /** Full snapshot of captured values, sorted by group then label. */
  metrics?: TestSnapshotMetric[];
}

/** The throwaway broker client: `mqtt`'s, as far as a one-shot dial uses it. */
export interface ProbeMqttClient {
  once(event: "connect", handler: () => void): unknown;
  once(event: "error", handler: (error: Error) => void): unknown;
  end(force: boolean, callback: () => void): unknown;
}

export interface ConnectionProbeDeps {
  /** A profile by id — built-in or installed — independent of any running loop. */
  resolveProfile(id: string): Promise<InverterProfile | null>;
  /** The profile of the registry's primary device, for a bare settings re-test. */
  primaryProfile(): InverterProfile | null;
  buildContext(profile: InverterProfile): ProfileContext;
  buildSource(
    profile: InverterProfile,
    config: SourceConnection,
    simulate: boolean,
  ): InverterSource;
  connectMqtt(url: string, options: Record<string, unknown>): ProbeMqttClient;
}

export interface ConnectionProbes {
  testInverter(profileId: string | null, config: SourceConnection): Promise<TestInverterResult>;
  testMqtt(broker: MqttParams): Promise<{ ok: boolean; error?: string }>;
}

export function createConnectionProbes(deps: ConnectionProbeDeps): ConnectionProbes {
  /**
   * Try a config against a throwaway source without disturbing the live one.
   * Times the read and returns the full captured snapshot so the operator can
   * eyeball every value for plausibility before saving.
   *
   * The profile is resolved independent of the running runtime, so this works
   * during onboarding — before any device is registered — against the chosen
   * (built-in or freshly-installed) profile. A null `profileId` falls back to the
   * profile of the registry's primary device, for the ordinary settings-page
   * re-test.
   */
  async function testInverter(
    profileId: string | null,
    config: SourceConnection,
  ): Promise<TestInverterResult> {
    const profile = profileId ? await deps.resolveProfile(profileId) : deps.primaryProfile();
    if (!profile) {
      return {
        ok: false,
        error: profileId ? `Unknown profile "${profileId}"` : "No profile selected",
      };
    }
    const testCtx = deps.buildContext(profile);
    // Never the simulator. A connection test exists to answer "does this
    // address speak Modbus", and with INVERTER_SIMULATE set it used to answer
    // yes by reading a fake inverter — a green test against an address nothing
    // had dialled.
    const probe = deps.buildSource(profile, config, false);
    try {
      const started = performance.now();
      const sample = await probe.read();
      const durationMs = Math.round(performance.now() - started);
      const metrics = Object.entries(sample.metrics)
        .map(([key, value]) => {
          const meta = testCtx.metaByKey.get(key);
          const display = meta?.enumLabels?.[value];
          return {
            key,
            label: meta?.label ?? key,
            unit: meta?.unit ?? null,
            group: meta?.group ?? "other",
            value,
            ...(display ? { display } : {}),
          };
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
      return { ok: true, metricCount: metrics.length, durationMs, metrics };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    } finally {
      await probe.close();
    }
  }

  /**
   * Try connecting to a broker without disturbing the live bridge.
   *
   * Takes the BROKER, not the export config: since #217 the endpoint is a
   * connection, and what an operator tests is a broker — one they may not have
   * bound to the export yet. The caller resolves it
   * (`../settings/mqtt-broker.ts`).
   */
  function testMqtt(broker: MqttParams): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const client = deps.connectMqtt(broker.brokerUrl, {
        username: broker.username,
        password: broker.password,
        connectTimeout: 4000,
        reconnectPeriod: 0, // one shot — don't loop retrying a bad broker
      });
      let settled = false;
      const done = (result: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        client.end(true, () => {});
        resolve(result);
      };
      client.once("connect", () => done({ ok: true }));
      client.once("error", (err) => done({ ok: false, error: err.message }));
      setTimeout(() => done({ ok: false, error: "connection timed out" }), 5000);
    });
  }

  return { testInverter, testMqtt };
}
