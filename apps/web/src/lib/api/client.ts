// What every group of the core's client shares: the generated client and refusals (ADR 9).
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components };

export type Client = ReturnType<typeof createClient<paths>>;

/** The generated client over `fetch`, its paths resolved under `base`. */
export function open(base: string, fetch: (request: Request) => Promise<Response>): Client {
  return createClient<paths>({ baseUrl: base, fetch });
}

export type ProblemDetails = components["schemas"]["ProblemDetails"];

/** A refusal's stable code (ADR 9), such as `auth.required`, and the request body's member at
 * fault where the core names it, as a JSON pointer such as `/strings/0/modules`, or the series a
 * range read refuses. */
export interface Problem {
  readonly problem: string;
  readonly pointer?: string;
  readonly series?: string;
}

/** A read the core refused, thrown so it fails as a lost core does yet keeps the core's reason. */
class Refused extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.problem);
    this.name = "Refused";
    this.problem = problem;
  }
}

/** A read's answer; a refusal is thrown as `Refused`. */
export function answerOf<T extends object>(read: T | Problem): T {
  if ("problem" in read) throw new Refused(read);

  return read;
}

/** A read settled: its answer, or its failure with the core's reason, none for a lost core. */
export type Settled<T> =
  | { readonly data: T; readonly failed: false }
  | { readonly failed: true; readonly refused: Problem | undefined };

/** Settles `read`, never rejecting. */
export async function settleRead<T>(read: Readonly<Promise<T>>): Promise<Settled<T>> {
  try {
    return { data: await read, failed: false };
  } catch (error) {
    return { failed: true, refused: error instanceof Refused ? error.problem : undefined };
  }
}

/** A proxy in front of the core may refuse with a body that is no JSON; its status stands in. */
export function refusal(error: Readonly<ProblemDetails> | string, status: number): Problem {
  if (!(error instanceof Object)) return { problem: `http.${status}` };

  const { code, pointer, series } = error;
  let problem: Problem = { problem: code };

  if (pointer !== undefined && pointer !== null) problem = { ...problem, pointer };

  if (series !== undefined && series !== null) problem = { ...problem, series };

  return problem;
}

/** The most series one range request reads (ADR 9). */
const MOST = 16;

/** One answer of a range read: a series by name. */
export type Named = Readonly<{ series: string }>;

/** One request of `series` of a range: each answered, or the whole refused. */
export type RangeRequest<T extends Named> = (
  series: readonly string[],
) => Promise<readonly T[] | Problem>;

/** Each of `series` from `ask`, refused or not; a refusal naming one series goes to it alone. */
async function chunk<T extends Named>(
  series: readonly string[],
  ask: RangeRequest<T>,
): Promise<ReadonlyMap<string, T | Problem>> {
  const read = await ask(series);

  if (!("problem" in read)) return new Map(read.map((one) => [one.series, one]));

  const named = read.series;

  if (named === undefined || !series.includes(named))
    return new Map(series.map((name) => [name, read]));

  const rest = series.filter((name) => name !== named);
  const others = rest.length > 0 ? await chunk(rest, ask) : new Map<string, T | Problem>();

  return new Map([...others, [named, read]]);
}

/**
 * Each of `series` of one device and range, in order, asked at most 16 a request (ADR 9); a
 * series the core refuses by name is refused alone, the others asked again without it. Rejects
 * on an answer missing a series asked.
 */
export async function bySeries<T extends Named>(
  series: readonly string[],
  ask: RangeRequest<T>,
): Promise<readonly (T | Problem)[]> {
  const unique = [...new Set(series)];
  const chunks: (readonly string[])[] = [];

  for (let i = 0; i < unique.length; i += MOST) chunks.push(unique.slice(i, i + MOST));

  const answers = new Map<string, T | Problem>();

  for (const read of await Promise.all(chunks.map((names) => chunk(names, ask))))
    for (const [name, one] of read) answers.set(name, one);

  return series.map((name) => {
    const one = answers.get(name);

    if (one === undefined) throw new TypeError(`the core did not answer ${name}`);

    return one;
  });
}

/** Undefined for a success without a body, else why it was refused. */
export function done(
  error: Readonly<ProblemDetails> | string | undefined,
  response: Readonly<Pick<Response, "ok" | "status">>,
): Problem | undefined {
  return response.ok ? undefined : refusal(error ?? "", response.status);
}
