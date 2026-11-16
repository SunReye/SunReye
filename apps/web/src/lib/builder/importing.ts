// Loading imported surroundings (ADR 20): the core fetches in its own task, so a load asks, then
// follows the status until the document is ready or the fetch has failed. Pure.
import type { Core, Problem, SurroundingsLoad } from "../api/core.ts";
import type { Imported } from "./imported.ts";

/** The core's surroundings. */
export type Source = Pick<Core, "loadSurroundings" | "surroundingsStatus" | "surroundings">;

/** How a load ended without a document: the core's refusal, or why its fetch failed. */
export interface Failure {
  readonly problem?: string;
  readonly reason?: string;
}

export interface Loaded {
  readonly id: string;
  readonly document: Imported;
}

const failed = ({ problem }: Problem): Failure => ({ problem });

/** Loads `request` to its end, asking the status after every `pause`. */
export async function fetched(
  core: Source,
  request: SurroundingsLoad,
  pause: () => Promise<void>,
): Promise<Loaded | Failure> {
  let status = await core.loadSurroundings(request);

  while (!("problem" in status) && status.state === "fetching") {
    // One question after the other: each waits for the last answer.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design.
    await pause();
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design.
    status = await core.surroundingsStatus();
  }

  if ("problem" in status) return failed(status);

  const id = status.document;

  if (status.state !== "ready" || id === undefined || id === null) {
    return { reason: status.error ?? "" };
  }

  const document = await core.surroundings(id);

  return "problem" in document ? failed(document) : { id, document };
}

/** A typed number, with a comma or a point; NaN for anything else. */
function typed(text: string): number {
  const trimmed = text.trim().replace(",", ".");

  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * The exact centre the admin typed: undefined when both fields are empty, so the plant's
 * location is used, and null when it is no place on the globe.
 */
export function centreOf(latitude: string, longitude: string): SurroundingsLoad["centre"] | null {
  if (latitude.trim() === "" && longitude.trim() === "") return undefined;

  const [north, east] = [typed(latitude), typed(longitude)];

  return Math.abs(north) <= 90 && Math.abs(east) <= 180
    ? { latitude: north, longitude: east }
    : null;
}
