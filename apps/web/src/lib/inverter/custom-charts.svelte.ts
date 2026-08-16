// Client store for user-defined custom charts on the history page. Loads the
// saved charts once, then mutates optimistically on create/update/delete so the
// section reflects edits immediately. The model itself lives in
// `custom-chart.ts`, which is plain TS and therefore testable.
import { api } from "$lib/api";
import type { CustomChart } from "./custom-chart";

/** Payload for create/update. */
interface CustomChartInput {
  name: string;
  metrics: string[];
}

/** Pull a human message out of an Eden error ({ error } bodies from the API). */
function errorMessage(error: { value?: unknown }): string {
  const value = error.value;
  if (value && typeof value === "object" && "error" in value) {
    return String((value as { error: unknown }).error);
  }
  return "Something went wrong";
}

class CustomChartsStore {
  charts = $state<CustomChart[]>([]);
  loaded = $state(false);
  /**
   * A metric the user picked "new chart with this metric" for, on a card that
   * is nowhere near the editor in the tree. The editor dialog is mounted once,
   * by the custom-charts section; this is how a card two levels down asks for
   * it. Cleared by whoever opens the dialog.
   */
  editorSeed = $state<string[] | null>(null);
  #started = false;

  /** Load the saved charts once. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.reload();
  }

  async reload(): Promise<void> {
    const { data } = await api.api["custom-charts"].get();
    if (data) this.charts = data as CustomChart[];
    this.loaded = true;
  }

  /** Create a chart. Returns an error message on failure, else `null`. */
  async create(input: CustomChartInput): Promise<string | null> {
    const { data, error } = await api.api["custom-charts"].post(input);
    if (error) return errorMessage(error);
    if (data) this.charts = [data as CustomChart, ...this.charts];
    return null;
  }

  /** Update a chart. Returns an error message on failure, else `null`. */
  async update(id: string, input: CustomChartInput): Promise<string | null> {
    const { data, error } = await api.api["custom-charts"]({ id }).put(input);
    if (error) return errorMessage(error);
    if (data) this.charts = this.charts.map((c) => (c.id === id ? (data as CustomChart) : c));
    return null;
  }

  /** Ask the section to open its editor with these metrics pre-picked. */
  seedEditor(metrics: string[]): void {
    this.editorSeed = metrics;
  }

  /** Delete a chart. Returns an error message on failure, else `null`. */
  async remove(id: string): Promise<string | null> {
    const { error } = await api.api["custom-charts"]({ id }).delete();
    if (error) return errorMessage(error);
    this.charts = this.charts.filter((c) => c.id !== id);
    return null;
  }
}

export const customCharts = new CustomChartsStore();
