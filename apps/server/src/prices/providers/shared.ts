/**
 * Transport shared by the day-ahead price providers.
 *
 * Both speak plain JSON over one GET and have to make the same distinction: a
 * delivery day that has not cleared yet is an expected state before ~13:00
 * market time, not a failure, and must not be logged as one every half hour.
 * Keeping that mapping in one place is what stops the two drifting on which
 * status codes mean "wait" and which mean "broken".
 */

import { SpotPriceUnpublished } from "../spot-price";

const TIMEOUT_MS = 10_000;

/** GET one provider URL as JSON, mapping "not published yet" to its own error. */
export async function fetchSpotJson<T>(url: string, zone: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // 404 = the day is not published; 400 = out of the served range entirely.
  if (res.status === 404 || res.status === 400) {
    throw new SpotPriceUnpublished(`HTTP ${res.status} for ${zone}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
