// Client store for user-defined custom charts on the history page. Loads the
// saved charts once, then mutates optimistically on create/update/delete so the
// section reflects edits immediately. The model itself lives in
// `custom-chart.ts`, which is plain TS and therefore testable.
import { coreCapabilities } from "$lib/capabilities.svelte";
import {
  createCustomChart,
  type CustomChartInput,
  deleteCustomChart,
  listCustomCharts,
  updateCustomChart,
} from "$lib/engine-only";
import type { CustomChart } from "./custom-chart";

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
    if (this.#started || !coreCapabilities.has("customCharts")) return;
    this.#started = true;
    void this.reload();
  }

  async reload(): Promise<void> {
    const charts = await listCustomCharts();
    if (charts) this.charts = charts;
    this.loaded = true;
  }

  /** Create a chart. Returns an error message on failure, else `null`. */
  async create(input: CustomChartInput): Promise<string | null> {
    const { chart, error } = await createCustomChart(input);
    if (error) return error;
    if (chart) this.charts = [chart, ...this.charts];
    return null;
  }

  /** Update a chart. Returns an error message on failure, else `null`. */
  async update(id: string, input: CustomChartInput): Promise<string | null> {
    const { chart, error } = await updateCustomChart(id, input);
    if (error) return error;
    if (chart) this.charts = this.charts.map((c) => (c.id === id ? chart : c));
    return null;
  }

  /** Ask the section to open its editor with these metrics pre-picked. */
  seedEditor(metrics: string[]): void {
    this.editorSeed = metrics;
  }

  /** Delete a chart. Returns an error message on failure, else `null`. */
  async remove(id: string): Promise<string | null> {
    const error = await deleteCustomChart(id);
    if (error) return error;
    this.charts = this.charts.filter((c) => c.id !== id);
    return null;
  }
}

export const customCharts = new CustomChartsStore();
