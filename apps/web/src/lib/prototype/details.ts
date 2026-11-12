export interface DetailSpec {
  title: string;
  unit: string;
  metric: "pv" | "house" | "soc" | "price";
  colour: string;
  stats: [string, string][];
}

export const DETAILS: Record<string, DetailSpec> = {
  production: { title: "Produktion", unit: "kWh", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "8,6 kW"], ["Prognose", "49,7 kWh"], ["vs. gestern", "+12 %"]] },
  consumption: { title: "Verbrauch", unit: "kWh", metric: "house", colour: "var(--e-house)", stats: [["Grundlast", "0,35 kW"], ["Spitze", "2,3 kW"], ["aus PV", "96 %"]] },
  feedIn: { title: "Einspeisung", unit: "kWh", metric: "pv", colour: "var(--e-export)", stats: [["Vergütung", "1,39 €"], ["Satz", "8,2 ct"], ["Limit", "70 %"]] },
  purchase: { title: "Bezug", unit: "kWh", metric: "house", colour: "var(--e-import)", stats: [["Kosten", "0,19 €"], ["Preis Ø", "32 ct"], ["Nachts", "0,6 kWh"]] },
  autarky: { title: "Autarkie & Eigenverbrauch", unit: "%", metric: "house", colour: "var(--e-battery)", stats: [["Autarkie", "96 %"], ["Eigenverbr.", "46 %"], ["Gespart", "6,40 €"]] },
  saved: { title: "Ersparnis", unit: "€", metric: "pv", colour: "var(--e-solar)", stats: [["Heute", "6,40 €"], ["Monat", "48,20 €"], ["Gesamt", "3.912 €"]] },
  price: { title: "Spotpreis", unit: "ct/kWh", metric: "price", colour: "var(--e-house)", stats: [["Min", "8,1 ct"], ["Max", "36,8 ct"], ["Ø", "21,4 ct"]] },
  forecast: { title: "Prognose heute", unit: "kWh", metric: "pv", colour: "var(--e-solar)", stats: [["Noch", "18,5 kWh"], ["Gesamt", "49,7 kWh"], ["Morgen", "41,2 kWh"]] },
  weather: { title: "Wetter", unit: "°C", metric: "pv", colour: "var(--e-solar)", stats: [["Jetzt", "21 °C"], ["Bewölkung", "8 %"], ["Wind", "9 km/h"]] },
  ev: { title: "ID.4", unit: "kW", metric: "house", colour: "var(--e-ev)", stats: [["SOC", "52 %"], ["Ziel", "80 %"], ["Heute", "11,3 kWh"]] },
  battery: { title: "Batterie", unit: "%", metric: "soc", colour: "var(--e-battery)", stats: [["SOC", "64 %"], ["Zyklen", "412"], ["Gesundheit", "≈ 97 %"]] },
  inverter: { title: "Wechselrichter", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["AC", "7,6 kW"], ["Wirkungsgrad", "97,5 %"], ["Temp.", "41 °C"]] },
  s1: { title: "MPPT1 Süd", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "3,6 kW"], ["Heute", "13,9 kWh"], ["Residuum", "−2 %"]] },
  s2: { title: "MPPT1 Nord", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "2,4 kW"], ["Heute", "5,1 kWh"], ["Residuum", "+4 %"]] },
  s3: { title: "MPPT2 Süd", unit: "kW", metric: "pv", colour: "var(--e-solar)", stats: [["Spitze", "3,6 kW"], ["Heute", "12,2 kWh"], ["Residuum", "−1 %"]] },
};
