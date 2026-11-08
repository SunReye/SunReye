import { payloadOrNull } from "$lib/api-payload";
import { byPath, refused } from "$lib/core-by-path";
import type { CustomChart } from "$lib/inverter/custom-chart";
import type { SourceId } from "$lib/source";

/**
 * Endpoints only the 3.x engine serves, reached by path on the core client. The Rust core serves
 * none of them (it reports `controls`, `evccCommands`, `customCharts` and `pricesAndCosts` absent
 * in its capabilities, and every caller checks those first), so these leave with the engine.
 */

/** Write one inverter setting; `true` when the engine accepted it. */
export async function postSetting(key: string, value: number): Promise<boolean> {
  return !refused(await byPath.POST("/api/commands/setting", { body: { key, value } }));
}

export type EvccCommand =
  | { loadpoint: number; action: "mode"; value: "off" | "pv" | "minpv" | "now" }
  | { loadpoint: number; action: "limitSoc"; value: number };

/** Send a loadpoint command; `null` on success, else the engine's message. */
export async function postEvccCommand(body: EvccCommand): Promise<string | null> {
  const answer = await byPath.POST("/api/commands/evcc", { body });
  if (!refused(answer)) return null;
  const detail = answer.error as { error?: string } | null;
  return detail?.error ?? `Command failed (${answer.response?.status})`;
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
  const { data } = await byPath.GET("/api/cost", {
    params: { query: { range: "today", ...query } },
  });
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
  const { data } = await byPath.GET("/api/custom-charts");
  return data ? (data as CustomChart[]) : null;
}

/** Pull a human message out of an error body ({ error } bodies from the API). */
function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return "Something went wrong";
}

/** A custom-chart write: the saved chart, or the engine's message. */
export type ChartWrite = { chart: CustomChart | null; error: string | null };

function chartWrite(answer: Awaited<ReturnType<typeof byPath.POST>>): ChartWrite {
  return refused(answer)
    ? { chart: null, error: errorMessage(answer.error) }
    : { chart: (answer.data as CustomChart) ?? null, error: null };
}

export async function createCustomChart(input: CustomChartInput): Promise<ChartWrite> {
  return chartWrite(await byPath.POST("/api/custom-charts", { body: input }));
}

export async function updateCustomChart(id: string, input: CustomChartInput): Promise<ChartWrite> {
  return chartWrite(
    await byPath.PUT("/api/custom-charts/{id}", { params: { path: { id } }, body: input }),
  );
}

/** Delete a custom chart; `null` on success, else the engine's message. */
export async function deleteCustomChart(id: string): Promise<string | null> {
  const answer = await byPath.DELETE("/api/custom-charts/{id}", { params: { path: { id } } });
  return refused(answer) ? errorMessage(answer.error) : null;
}
