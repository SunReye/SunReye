// How the tariff screen writes the core's figures; it computes none (ADR 12).
import { getLocale } from "../paraglide/runtime.js";

/** EUR/kWh as ct/kWh to the hundredth; a currency subunit symbol, the same in every locale. */
export function ctPerKwh(eurPerKwh: number | undefined): string {
  if (eurPerKwh === undefined) return "–";

  const cents = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${cents.format(eurPerKwh * 100)} ct/kWh`;
}

/** EUR to the cent in the locale's currency format. */
export function euros(amount: number): string {
  return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "EUR" }).format(amount);
}
