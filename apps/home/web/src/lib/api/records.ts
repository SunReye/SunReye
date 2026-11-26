// What the plant's whole record says (ADR 9): its years and bests, and the battery's capacity.
import { refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

/** kWh, and EUR saved where a tariff priced the days. */
export type Figures = Readonly<components["schemas"]["FiguresView"]>;

/** A best day or month: its first date and its value. */
export type Best = Readonly<components["schemas"]["BestView"]> | null;

/** A recorded plant-local year. */
export type Year = Readonly<Omit<components["schemas"]["YearView"], "figures" | "before">> & {
  readonly figures: Figures;
  readonly before?: Figures | null;
};

export interface Records {
  readonly years: readonly Year[];
  readonly bestDay?: Best;
  readonly bestMonth?: Best;
  readonly bestSaving?: Best;
}

export type Capacity = Readonly<Omit<components["schemas"]["Capacity"], "measurements">> & {
  readonly measurements: readonly Readonly<components["schemas"]["CapacityMeasurement"]>[];
};

export interface PlantRecords {
  /** Every recorded plant-local year, newest first, and the best day, month and saving. */
  records(): Promise<Records | Problem>;
  /** The battery's usable capacity, inferred from its state of charge. */
  batteryCapacity(): Promise<Capacity | Problem>;
}

export function plantRecords(client: Client): PlantRecords {
  return {
    records: async () => {
      const { data, error, response } = await client.GET("/api/v1/records");

      return data ?? refusal(error, response.status);
    },
    batteryCapacity: async () => {
      const { data, error, response } = await client.GET("/api/v1/battery/capacity");

      return data ?? refusal(error, response.status);
    },
  };
}
