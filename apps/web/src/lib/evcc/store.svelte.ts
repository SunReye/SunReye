import type { EvccLoadpoint, EvccState } from "@SunReye/contracts/evcc";
import { api } from "$lib/api";
import * as m from "$lib/paraglide/messages";
import { bus } from "$lib/ws/bus.svelte";
import { EvccFeed, isActive, leaseEvcc, totalChargePower } from "./feed";

export type { EvccLoadpoint };

export type EvccMode = "off" | "pv" | "minpv" | "now";

/**
 * The charge limit to display for a loadpoint, in % (0 = no limit).
 *
 * EVCC resolves three layers into one: the durable per-vehicle limit, the
 * per-session loadpoint override, and `effectiveLimitSoc` as the result. Prefer
 * the effective value — it is what EVCC's own UI shows — and only fall back to
 * the session override on an EVCC old enough not to publish it. A `0` from
 * either layer is genuinely "no limit", so it must not fall through.
 */
export function displayLimitSoc(lp: EvccLoadpoint): number {
  return lp.effectiveLimitSoc ?? lp.limitSoc ?? 0;
}

/** EVCC charge modes with their display labels, in EVCC's own UI order. */
export const EVCC_MODES: { value: EvccMode; label: () => string }[] = [
  { value: "off", label: m.evcc_mode_off },
  { value: "pv", label: m.evcc_mode_pv },
  { value: "minpv", label: m.evcc_mode_minpv },
  { value: "now", label: m.evcc_mode_now },
];

/**
 * Server-held EVCC state on the client, fed by the `evcc` topic of the app's
 * one live socket. The server ingests EVCC's MQTT push, coalesces it, and
 * broadcasts each fresh snapshot; it also replays the current snapshot to a new
 * subscriber, so the first paint comes off the subscribe itself — there is no
 * HTTP prime to race it.
 *
 * Consumers (power-flow diagram, EV card, peak-shaving panel) each hold a
 * {@link lease} from an `$effect`. The bus refcounts the topic, so those three
 * cost one `sub` frame between them and none of them touches the connection —
 * that is leased once, by the app shell.
 *
 * Transport, reconnect replay and frame parsing all live in the bus; what is
 * left here is EVCC's domain: the snapshot, the derived views of it, and the
 * command writes.
 */
class EvccStore {
  state = $state<EvccState | null>(null);

  /**
   * Exponentially-smoothed gap between live EVCC pushes (ms). `AnimatedNumber`
   * stretches its glide across it so EVCC-fed numbers (charge power, session
   * energy) drift continuously between pushes instead of snapping and freezing.
   * Measured and bounded in {@link EvccFeed} — EVCC's push rhythm is its own,
   * not the metrics feed's.
   */
  cadenceMs = $state(1000);

  #feed = new EvccFeed({
    onState: (next) => {
      this.state = next;
    },
    onCadence: (cadenceMs) => {
      this.cadenceMs = cadenceMs;
    },
  });

  /** Integration on + EVCC publishing + at least one loadpoint to show. */
  get active(): boolean {
    return isActive(this.state);
  }

  get loadpoints(): EvccLoadpoint[] {
    return this.state?.loadpoints ?? [];
  }

  /** Total charge power across loadpoints (W) — the diagram's charger node. */
  get chargePower(): number {
    return totalChargePower(this.state);
  }

  /**
   * Lease the EVCC topic from a component `$effect`; returns the cleanup. Any
   * number of consumers share one subscription, and the socket is untouched.
   */
  lease(): () => void {
    return leaseEvcc(bus, this.#feed);
  }

  /** Send a loadpoint command; state converges via EVCC's republish over WS. */
  async #command(
    body:
      | { loadpoint: number; action: "mode"; value: EvccMode }
      | { loadpoint: number; action: "limitSoc"; value: number },
  ): Promise<string | null> {
    const { error } = await api.api.commands.evcc.post(body);
    if (error) {
      const detail = error.value as { error?: string } | null;
      return detail?.error ?? `Command failed (${error.status})`;
    }
    return null;
  }

  setMode(loadpoint: number, mode: EvccMode): Promise<string | null> {
    return this.#command({ loadpoint, action: "mode", value: mode });
  }

  setLimitSoc(loadpoint: number, limit: number): Promise<string | null> {
    return this.#command({ loadpoint, action: "limitSoc", value: limit });
  }
}

export const evcc = new EvccStore();
