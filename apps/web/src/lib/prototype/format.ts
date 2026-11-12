export const fmt = (v: number, digits = 1) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
export const eur = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
export const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
