// The computed devices' fixed ids (ADR 15): they count down from the weather device's, above every
// registered device. A live stream keys its values by the id as text.

export const WEATHER = 4_294_967_295;
export const PLANT = 4_294_967_294;
export const TARIFF = 4_294_967_293;
export const SPOT = 4_294_967_292;

/** Whether `device` is one the owner registered, not a computed one. */
export function registered(device: number): boolean {
  return device < SPOT;
}
