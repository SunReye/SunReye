// The tariff, its prices, costs and payback (ADR 12); every figure comes from the core.
import { refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

export type Tariff = components["schemas"]["Tariff"];

export type CostDays = components["schemas"]["CostDays"];

export type Payback = components["schemas"]["Payback"];

export type BiddingZone = components["schemas"]["BiddingZone"];

/** The bidding zone spot prices are fetched for; none without one. */
export type SpotPriceZone = components["schemas"]["SpotPriceZone"];

type Schedule = components["schemas"]["ScheduleView"];

/** A price on given weekdays for a span of the plant-local day. */
export interface BandChange {
  /** ISO weekdays, Monday 1 to Sunday 7. */
  readonly days: readonly number[];
  /** `HH:MM`. */
  readonly from: string;
  /** `HH:MM`, up to 24:00. */
  readonly to: string;
  /** EUR/kWh. */
  readonly price: number;
}

/** One flow's prices: a base price, and bands where one applies. */
export interface ScheduleChange {
  /** EUR/kWh. */
  readonly price: number;
  readonly bands: readonly BandChange[];
}

/** A tariff's prices; a read tariff is one too. */
export interface TariffChange {
  /** RFC 3339; now when absent. */
  readonly appliesFrom?: string | null;
  readonly import: ScheduleChange;
  readonly export: ScheduleChange;
}

export interface Tariffs {
  /** The tariff in force now; admin only. */
  tariff(): Promise<Tariff | Problem>;
  /** Changes the tariff from now or a later instant on; admin only. */
  changeTariff(change: TariffChange): Promise<Tariff | Problem>;
  /** Applies the tariff from `from`, even a past instant, rebuilding prices and costs since. */
  reprice(from: string, change: TariffChange): Promise<Tariff | Problem>;
  /** Paid, earned and saved per plant-local day starting from `from` to before `to`. */
  costs(from: Readonly<Date>, to: Readonly<Date>): Promise<CostDays | Problem>;
  /** The savings so far against the investment; admin only. */
  payback(): Promise<Payback | Problem>;
  /** Sets the investment in EUR; admin only. */
  invest(amount: number): Promise<Problem | undefined>;
  /** The bidding zone spot prices are fetched for; admin only. */
  spotZone(): Promise<SpotPriceZone | Problem>;
  /** Chooses the bidding zone, or none; admin only. */
  setSpotZone(zone: BiddingZone | null): Promise<Problem | undefined>;
}

export function tariffs(client: Client): Tariffs {
  return {
    tariff: async () => {
      const { data, error, response } = await client.GET("/api/v1/tariff");

      return data ?? refusal(error, response.status);
    },
    changeTariff: async (change) => {
      const { data, error, response } = await client.PUT("/api/v1/tariff", {
        body: { appliesFrom: change.appliesFrom ?? null, ...prices(change) },
      });

      return data ?? refusal(error, response.status);
    },
    reprice: async (from, change) => {
      const { data, error, response } = await client.POST("/api/v1/tariff/reprice", {
        body: { appliesFrom: from, ...prices(change) },
      });

      return data ?? refusal(error, response.status);
    },
    costs: async (from, to) => {
      const { data, error, response } = await client.GET("/api/v1/costs", {
        params: { query: { from: from.toISOString(), to: to.toISOString() } },
      });

      return data ?? refusal(error, response.status);
    },
    ...payback(client),
    ...spot(client),
  };
}

/** Both flows' prices as the client sends them. */
function prices(change: TariffChange) {
  return { import: schedule(change.import), export: schedule(change.export) };
}

function schedule({ price: base, bands }: ScheduleChange): Schedule {
  return {
    price: base,
    bands: bands.map(({ days, from, to, price }) => ({ days: [...days], from, to, price })),
  };
}

function payback(client: Client): Pick<Tariffs, "payback" | "invest"> {
  return {
    payback: async () => {
      const { data, error, response } = await client.GET("/api/v1/payback");

      return data ?? refusal(error, response.status);
    },
    invest: async (amount) => {
      const { data, error, response } = await client.PUT("/api/v1/investment", {
        body: { amount },
      });

      return data ? undefined : refusal(error, response.status);
    },
  };
}

function spot(client: Client): Pick<Tariffs, "spotZone" | "setSpotZone"> {
  return {
    spotZone: async () => {
      const { data, error, response } = await client.GET("/api/v1/spot-prices");

      return data ?? refusal(error, response.status);
    },
    setSpotZone: async (zone) => {
      const { data, error, response } = await client.PUT("/api/v1/spot-prices", {
        body: { zone },
      });

      return data ? undefined : refusal(error, response.status);
    },
  };
}
