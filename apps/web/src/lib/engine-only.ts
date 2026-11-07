import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";
import type { CustomChart } from "$lib/inverter/custom-chart";
import type { SourceId } from "$lib/source";

/**
 * Endpoints only the 3.x engine serves, still on Eden. The Rust core serves none of them (it
 * reports `controls`, `evccCommands`, `customCharts` and `pricesAndCosts` absent in its
 * capabilities, and every caller checks those first), so these leave with the engine.
 */

/** Write one inverter setting; `true` when the engine accepted it. */
export async function postSetting(key: string, value: number): Promise<boolean> {
  const { error } = await api.api.commands.setting.post({ key, value });
  return !error;
}

export type EvccCommand =
  | { loadpoint: number; action: "mode"; value: "off" | "pv" | "minpv" | "now" }
  | { loadpoint: number; action: "limitSoc"; value: number };

/** Send a loadpoint command; `null` on success, else the engine's message. */
export async function postEvccCommand(body: EvccCommand): Promise<string | null> {
  const { error } = await api.api.commands.evcc.post(body);
  if (!error) return null;
  const detail = error.value as { error?: string } | null;
  return detail?.error ?? `Command failed (${error.status})`;
}

/** The slice of `/api/cost?range=today` the daily-energy cards render. */
export type CostToday = {
  currency: string;
  importCost: number;
  exportEarnings: number;
  /** Value of self-consumed solar: (load − import) priced at the grid rate. */
  solarSavings: number;
  /** (load − import) / load — autarky. */
  selfSufficiency: number | null;
  /** (production − export) / production. */
  selfConsumption: number | null;
};

/** Today's cost read, or `null` when the engine had nothing readable to say. */
export async function fetchCostToday(query: { source: SourceId }): Promise<CostToday | null> {
  const { data } = await api.api.cost.get({ query: { range: "today", ...query } });
  return payloadOrNull<CostToday>(data);
}

/** Payload for creating or updating a custom chart. */
export interface CustomChartInput {
  name: string;
  metrics: string[];
  colors?: Record<string, string>;
  /**
   * Per-series device slugs, keyed by metric key. Carried through a save rather
   * than edited — dropping the key here would erase them (see
   * `custom-chart-form.ts`).
   */
  devices?: Record<string, string>;
}

/** The saved custom charts, or `null` when the engine did not answer with a list. */
export async function listCustomCharts(): Promise<CustomChart[] | null> {
  const { data } = await api.api["custom-charts"].get();
  return data ? (data as CustomChart[]) : null;
}

/** Pull a human message out of an Eden error ({ error } bodies from the API). */
function errorMessage(error: { value?: unknown }): string {
  const value = error.value;
  if (value && typeof value === "object" && "error" in value) {
    return String((value as { error: unknown }).error);
  }
  return "Something went wrong";
}

/** A custom-chart write: the saved chart, or the engine's message. */
export type ChartWrite = { chart: CustomChart | null; error: string | null };

export async function createCustomChart(input: CustomChartInput): Promise<ChartWrite> {
  const { data, error } = await api.api["custom-charts"].post(input);
  return error
    ? { chart: null, error: errorMessage(error) }
    : { chart: (data as CustomChart) ?? null, error: null };
}

export async function updateCustomChart(id: string, input: CustomChartInput): Promise<ChartWrite> {
  const { data, error } = await api.api["custom-charts"]({ id }).put(input);
  return error
    ? { chart: null, error: errorMessage(error) }
    : { chart: (data as CustomChart) ?? null, error: null };
}

/** Delete a custom chart; `null` on success, else the engine's message. */
export async function deleteCustomChart(id: string): Promise<string | null> {
  const { error } = await api.api["custom-charts"]({ id }).delete();
  return error ? errorMessage(error) : null;
}
