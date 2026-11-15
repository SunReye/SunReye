// A core that keeps its connections and devices as the admin changes them, for Settings' device pages.
import type { Connection, ConnectionDraft, Device, Transport } from "../api/core.ts";

/** The profiles it serves: an inverter and EVCC's loadpoint. */
const PROFILES = [
  {
    id: "deye-sg05lp3",
    manufacturer: "Deye",
    name: "SG05LP3",
    version: "1.0.0",
    official: true,
    acRating: 5000,
  },
  {
    id: "evcc",
    manufacturer: "EVCC",
    name: "Loadpoint",
    version: "1.0.4",
    official: true,
    acRating: null,
  },
];

/** What its scan finds: one inverter. */
const REPORT = {
  subnet: "192.168.1.0/24",
  endpoints: [
    {
      transport: "modbus-tcp",
      host: "192.168.1.40",
      port: 502,
      devices: [{ profile: "deye-sg05lp3", variant: "5k", name: "SUN-5K-SG05LP3-EU-SM2", unit: 1 }],
    },
  ],
};

const problem = (status: number, code: string) =>
  Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const held = () => Promise.withResolvers<Response>().promise;

/** `before` with a draft's secrets: a value sets one, null removes it. */
function secrets(before: readonly string[], change: ConnectionDraft["secrets"]): string[] {
  const after = new Set(before);

  for (const [name, value] of Object.entries(change ?? {})) {
    if (value === null) after.delete(name);
    else after.add(name);
  }

  return [...after].toSorted();
}

function isDevice(value: unknown): value is Omit<Device, "id"> {
  return (
    value instanceof Object &&
    "name" in value &&
    "connection" in value &&
    "profile" in value &&
    "unit" in value
  );
}

function isConnection(value: unknown): value is ConnectionDraft {
  return value instanceof Object && "name" in value && "transport" in value && "host" in value;
}

/** A request body the SPA under test sent, checked to be what `guard` says. */
function parsed<T>(text: string, guard: (value: unknown) => value is T): T {
  const sent: unknown = JSON.parse(text);

  if (!guard(sent)) throw new TypeError(`unexpected body ${text}`);

  return sent;
}

/** A core with one Modbus gateway and the inverter behind it; ids it hands out start at 11. */
export class FakeCore implements Transport {
  readonly base = "http://core.test/";

  readonly connections: Connection[] = [
    {
      id: 1,
      name: "Gateway",
      transport: "modbus-tcp",
      host: "192.168.1.30",
      port: 502,
      secrets: [],
    },
  ];

  readonly devices: Readonly<Device>[] = [
    { id: 3, connection: 1, name: "Wechselrichter", profile: "deye-sg05lp3", unit: 1 },
  ];

  /** Every change asked of it: method, path and body. */
  readonly calls: string[] = [];

  /** Live values by device id; the stream is held while null. */
  live: Readonly<Record<string, Readonly<Record<string, number>>>> | null = null;

  #last = 10;

  readonly fetch = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const text = await request.text();

    if (request.method !== "GET")
      this.calls.push(`${request.method} ${pathname} ${text}`.trimEnd());

    return this.#answer(request.method, pathname, text);
  };

  #answer(method: string, path: string, text: string): Promise<Response> {
    const [, , , kind, id] = path.split("/");

    if (kind === "devices") return Promise.resolve(this.#device(method, Number(id), text));

    if (kind === "connections") return Promise.resolve(this.#connection(method, Number(id), text));

    if (path === "/api/v1/live") return this.live === null ? held() : snapshot(this.live);

    const reads = new Map([
      ["/api/v1/profiles", () => Response.json({ profiles: PROFILES })],
      ["/api/v1/profile-updates", () => Response.json({ updates: [] })],
      ["/api/v1/scan", () => Response.json(REPORT)],
    ]);

    return Promise.resolve(reads.get(path)?.() ?? problem(404, "http.404"));
  }

  #device(method: string, id: number, text: string): Response {
    if (method === "GET") return Response.json({ devices: this.devices });

    const index = this.devices.findIndex(({ id: at }) => at === id);

    if (method === "DELETE") {
      this.devices.splice(index, 1);

      return new Response(null, { status: 204 });
    }

    const draft = parsed(text, isDevice);

    const device = { ...draft, id: method === "PUT" ? id : this.#next() };

    this.devices.splice(method === "PUT" ? index : this.devices.length, 1, device);

    return Response.json(device, { status: method === "PUT" ? 200 : 201 });
  }

  #connection(method: string, id: number, text: string): Response {
    if (method === "GET") return Response.json({ connections: this.connections });

    const index = this.#connectionAt(id);

    if (method === "DELETE") {
      if (this.devices.some(({ connection }) => connection === id))
        return problem(409, "connection.in-use");

      this.connections.splice(index, 1);

      return new Response(null, { status: 204 });
    }

    const { secrets: change, ...reach } = parsed(text, isConnection);
    const before = this.connections[index]?.secrets ?? [];

    const kept = {
      ...reach,
      id: method === "PUT" ? id : this.#next(),
      secrets: secrets(before, change),
    };

    this.connections.splice(method === "PUT" ? index : this.connections.length, 1, kept);

    return Response.json(kept, { status: method === "PUT" ? 200 : 201 });
  }

  #connectionAt(id: number): number {
    for (const [index, connection] of this.connections.entries())
      if (connection.id === id) return index;

    return -1;
  }

  #next(): number {
    this.#last += 1;

    return this.#last;
  }
}

/** The live stream: one snapshot, then held open. */
function snapshot(
  devices: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Promise<Response> {
  const body = `event: snapshot\ndata: ${JSON.stringify({ devices })}\n\n`;

  return Promise.resolve(
    new Response(
      new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode(body));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
}
