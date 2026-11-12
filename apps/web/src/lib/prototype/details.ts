import type { LiveKey } from "./sim.svelte";

export interface DetailSpec {
  title: string;
  unit: string;
  metric: "pv" | "house" | "soc" | "price";
  colour: string;
  /** The day's summary under the chart. What a device reads now is `readings.ts`'s, not this. */
  stats: [string, string][];
  /** A power figure: its sheet opens with the live graph of this series (ADR 21). */
  live?: LiveKey;
  /** The live series is signed and fills diverging around zero: [above, below] colours. */
  diverging?: [string, string];
  /** Today's figure the sheet leads with, when it is not the live power. */
  today?: "production" | "consumption" | "feedIn" | "purchase";
}

export const DETAILS: Record<string, DetailSpec> = {
  production: { live: "pv", today: "production", title: "Produktion", unit: "kWh", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "8,6 kW"], ["Prognose", "49,7 kWh"], ["vs. gestern", "+12 %"]] },
  consumption: { live: "house", today: "consumption", title: "Verbrauch", unit: "kWh", metric: "house", colour: "var(--e-house)", stats: [["Grundlast", "0,35 kW"], ["Spitze", "2,3 kW"], ["aus PV", "96 %"]] },
  feedIn: { live: "grid", diverging: ["var(--e-import)", "var(--e-export)"], today: "feedIn", title: "Einspeisung", unit: "kWh", metric: "pv", colour: "var(--e-export)", stats: [["Vergütung", "1,39 €"], ["Satz", "8,2 ct"], ["Limit", "70 %"]] },
  purchase: { live: "grid", diverging: ["var(--e-import)", "var(--e-export)"], today: "purchase", title: "Bezug", unit: "kWh", metric: "house", colour: "var(--e-import)", stats: [["Kosten", "0,19 €"], ["Preis Ø", "32 ct"], ["Nachts", "0,6 kWh"]] },
  autarky: { title: "Autarkie & Eigenverbrauch", unit: "%", metric: "house", colour: "var(--e-battery)", stats: [["Autarkie", "96 %"], ["Eigenverbr.", "46 %"], ["Gespart", "5,93 €"]] },
  saved: { title: "Ersparnis", unit: "€", metric: "pv", colour: "var(--e-solar)", stats: [["Heute", "5,93 €"], ["Monat", "48,20 €"], ["Gesamt", "3.912 €"]] },
  price: { title: "Spotpreis", unit: "ct/kWh", metric: "price", colour: "var(--e-house)", stats: [["Min", "8,1 ct"], ["Max", "36,8 ct"], ["Ø", "21,4 ct"]] },
  forecast: { title: "Prognose heute", unit: "kWh", metric: "pv", colour: "var(--e-solar)", stats: [["Noch", "18,5 kWh"], ["Gesamt", "49,7 kWh"], ["Morgen", "41,2 kWh"]] },
  weather: { title: "Wetter", unit: "°C", metric: "pv", colour: "var(--e-solar)", stats: [["Jetzt", "21 °C"], ["Bewölkung", "8 %"], ["Wind", "9 km/h"]] },
  ev: { live: "ev", title: "Auto", unit: "kW", metric: "house", colour: "var(--e-ev)", stats: [["Heute", "11,3 kWh"], ["aus PV", "92 %"], ["Kosten", "0,29 €"]] },
  battery: { live: "battery", diverging: ["var(--e-battery)", "var(--e-battery)"], title: "Batterie", unit: "%", metric: "soc", colour: "var(--e-battery)", stats: [["Geladen heute", "6,2 kWh"], ["Zyklen", "≈ 412"], ["Gesundheit", "≈ 97 %"]] },
  inverter: { live: "inverter", title: "Wechselrichter", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "8,4 kW"], ["Heute", "30,4 kWh"], ["Wirkungsgrad", "Ø 97,4 %"]] },
  grid: { live: "grid", diverging: ["var(--e-import)", "var(--e-export)"], title: "Netz", unit: "kW", metric: "house", colour: "var(--e-export)", stats: [["Einspeisung", "16,9 kWh"], ["Bezug", "0,6 kWh"], ["Limit", "70 %"]] },
  house: { live: "house", title: "Haus", unit: "kW", metric: "house", colour: "var(--e-house)", stats: [["Grundlast", "0,35 kW"], ["Spitze", "2,3 kW"], ["Heute", "14,8 kWh"]] },
  solar: { live: "pv", title: "PV gesamt", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "8,6 kW"], ["Heute", "31,2 kWh"], ["Prognose", "49,7 kWh"]] },
  s4: { live: "s4", title: "MPPT2 West", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "2,5 kW"], ["Heute", "8,4 kWh"], ["Korrektur", "×1,01"]] },
  s5: { live: "s5", title: "MPPT3 Ost", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "1,8 kW"], ["Heute", "6,0 kWh"], ["Korrektur", "×0,97"]] },
  s6: { live: "s6", title: "MPPT3 Carport", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "3,3 kW"], ["Heute", "11,1 kWh"], ["Korrektur", "×1,00"]] },
  s1: { live: "s1", title: "MPPT1 Süd", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "3,6 kW"], ["Heute", "13,9 kWh"], ["Korrektur", "×0,98"]] },
  s2: { live: "s2", title: "MPPT1 Nord", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "2,4 kW"], ["Heute", "5,1 kWh"], ["Korrektur", "×1,04"]] },
  s3: { live: "s3", title: "MPPT2 Süd", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "3,6 kW"], ["Heute", "12,2 kWh"], ["Korrektur", "×0,99"]] },
};
