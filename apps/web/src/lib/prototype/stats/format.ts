// PROTOTYPE: figures as the Statistics screen writes them.
const nf = (digits: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n0 = nf(0);
const n1 = nf(1);
const n2 = nf(2);

/** A figure split into number and unit, so the unit can sit quieter. */
export function energyParts(kwh: number): [string, string] {
  if (kwh >= 10_000) return [n1.format(kwh / 1000), "MWh"];
  return [kwh < 100 ? n1.format(kwh) : n0.format(kwh), "kWh"];
}
export const energy = (kwh: number) => energyParts(kwh).join(" ");
export function moneyParts(eur: number): [string, string] {
  return [Math.abs(eur) < 100 ? n2.format(eur) : n0.format(eur), "€"];
}
export const money = (eur: number) => moneyParts(eur).join(" ");
export const percent = (share: number | null) => (share === null ? "–" : `${n0.format(share * 100)} %`);
export const cents = (ct: number) => `${n1.format(ct)} ct`;
export const num = (v: number, digits = 0) => nf(digits).format(v);

/** A change against a baseline: "+12 %", or points for a ratio. */
export function delta(change: number | null, points = false): string {
  if (change === null) return "–";
  const v = Math.round(change * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} ${points ? "Pkt." : "%"}`;
}
/** The same in words, for a sentence: "12 % mehr als". */
export function deltaWords(change: number, more = "mehr", less = "weniger"): string {
  const v = Math.round(change * 100);
  return v === 0 ? "so viel wie" : `${Math.abs(v)} % ${v > 0 ? more : less} als`;
}

// A figure that rolls keeps the unit and the digits of where it is going, so neither flips on the way.
export function energyRoll(kwh: number): { fmt: (v: number) => string; unit: string } {
  if (kwh >= 10_000) return { fmt: (v) => n1.format(v / 1000), unit: "MWh" };
  return { fmt: (v) => (kwh < 100 ? n1 : n0).format(v), unit: "kWh" };
}
export function moneyRoll(eur: number): { fmt: (v: number) => string; unit: string } {
  return { fmt: (v) => (Math.abs(eur) < 100 ? n2 : n0).format(v), unit: "€" };
}
/** The whole figure with its unit, for a row. */
export const energyTo = (kwh: number) => {
  const r = energyRoll(kwh);
  return (v: number) => `${r.fmt(v)} ${r.unit}`;
};
export const moneyTo = (eur: number, sign = "") => {
  const r = moneyRoll(eur);
  return (v: number) => `${sign}${r.fmt(v)} €`;
};
export const percentTo = (v: number) => `${n0.format(v * 100)} %`;
