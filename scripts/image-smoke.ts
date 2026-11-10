// fallow-ignore-file coverage-gaps -- needs Docker and a browser; run by hand with `bun run image:smoke`.
// The image smoke test (ADR 13): builds the core and add-on images, runs each, and drives the SPA
// in Chromium through a stand-in for Home Assistant's ingress proxy.
//
// The Supervisor's address, 172.30.32.2, cannot exist on this host, so the add-on container is
// told to trust 127.0.0.2 instead and an nginx stand-in proxies from that address. Containers use
// the host network: bridged containers fail on the LXC host this runs on.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { answers, type Check, report, run } from "./smoke.ts";

const CORE = "127.0.0.1:18099";
const PROXY = "127.0.0.1:18100";
const SUPERVISOR = "127.0.0.2";
const PREFIX = "/api/hassio_ingress/smoke-token";
const IMAGE = "sunreye-smoke";

/** What Supervisor does to an ingress request: strips the prefix and names it in a header. */
const INGRESS = `server {
  listen ${PROXY};
  location ${PREFIX}/ {
    proxy_pass http://${CORE}/;
    proxy_bind ${SUPERVISOR};
    proxy_http_version 1.1;
    proxy_set_header X-Ingress-Path ${PREFIX};
    proxy_buffering off;
  }
}
`;

async function build(target: string): Promise<void> {
  process.stderr.write(`building ${IMAGE}:${target}\n`);

  await run([
    "docker",
    "build",
    "--network",
    "host",
    "-q",
    "-f",
    "packaging/Dockerfile",
    "--target",
    target,
    "-t",
    `${IMAGE}:${target}`,
    ".",
  ]);
}

/** Starts `target` on the host network; returns the container id once the core answers. */
async function startCore(target: string, env: readonly string[]): Promise<string> {
  const flags = [`SUNREYE_LISTEN=${CORE}`, ...env].flatMap((pair) => ["-e", pair]);
  const image = `${IMAGE}:${target}`;

  const id = await run([
    "docker",
    "run",
    "-d",
    "--network",
    "host",
    "--tmpfs",
    "/data",
    ...flags,
    image,
  ]);

  if (!(await answers(`http://${CORE}/openapi.json`, 50)))
    throw new Error(`${image} never answered`);

  return id;
}

/** The status of `GET path` on the core, sent straight from 127.0.0.1 with the ingress header. */
async function direct(path: string): Promise<number> {
  const response = await fetch(`http://${CORE}${path}`, { headers: { "x-ingress-path": PREFIX } });

  return response.status;
}

interface Screen {
  /**
   * Requests the page made that failed or were answered 400 or above, live values aside. A problem
   * the core answered reached it through the prefix: `layout.none` before any scene (ADR 20).
   */
  readonly failed: readonly string[];
  /** `null` when the screen never asked for live values. */
  readonly liveStatus: number | null;
  readonly alert: string | null;
  /** Whether the first-run setup asks for the admin password. */
  readonly asksPassword: boolean;
}

/** Opens the SPA under the ingress prefix and waits for its live stream to answer, if it asks. */
async function screen(): Promise<Screen> {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const failed: string[] = [];

    page.on("requestfailed", (request) => failed.push(`${request.url()} failed`));
    page.on("response", (response) => {
      const problem = response.headers()["content-type"] === "application/problem+json";

      if (response.status() >= 400 && !problem && !response.url().endsWith("/api/v1/live"))
        failed.push(`${response.url()} ${response.status()}`);
    });

    const live = page.waitForResponse((response) => response.url().endsWith("/api/v1/live"), {
      timeout: 10_000,
    });

    await page.goto(`http://${PROXY}${PREFIX}/`);

    // A screen whose code fails to load never asks for live values.
    const liveStatus = await live.then(
      (response) => response.status(),
      () => null,
    );

    const alert = page.locator("[role=alert]");

    const text = await alert.waitFor({ timeout: 2000 }).then(
      () => alert.textContent(),
      () => null,
    );

    const asksPassword = (await page.locator("input[autocomplete=new-password]").count()) === 2;

    return { failed, liveStatus, alert: text, asksPassword };
  } finally {
    await browser.close();
  }
}

function isCreated(value: unknown): value is { readonly id: number } {
  return value instanceof Object && "id" in value && Number.isInteger(value.id);
}

/** A connection or device as `POST` takes it: flat fields only. */
type Fields = Readonly<Record<string, string | number>>;

/** POSTs `body` as JSON to the core through the ingress prefix; returns the created id. */
async function create(path: string, body: Fields): Promise<number | null> {
  const response = await fetch(`http://${PROXY}${PREFIX}/api/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status !== 201) return null;

  const created: unknown = await response.json();

  return isCreated(created) ? created.id : null;
}

/**
 * The SPA opens on first-run setup until the admin has a device (ADR 11), and only the dashboard
 * streams live values. Its endpoint (port 9, discard) answers nothing, and writes stay off.
 */
async function addDevice(): Promise<boolean> {
  const endpoint = { name: "smoke", transport: "modbus-tcp", host: "127.0.0.1", port: 9 };
  const connection = await create("connections", endpoint);

  if (connection === null) return false;

  const device = { name: "smoke", connection, profile: "deye-sg05lp3", unit: 1 };

  return (await create("devices", device)) !== null;
}

async function addonChecks(): Promise<Check[]> {
  const env = await run([
    "docker",
    "image",
    "inspect",
    "-f",
    "{{json .Config.Env}}",
    `${IMAGE}:addon`,
  ]);

  const id = await startCore("addon", [`SUNREYE_INGRESS=${SUPERVISOR}`]);

  try {
    const session = await fetch(`http://${PROXY}${PREFIX}/api/v1/session`);
    const added = await addDevice();
    const shown = await screen();

    for (const failure of shown.failed) process.stderr.write(`${failure}\n`);

    return [
      [
        "the add-on image trusts the Supervisor's address",
        env.includes("SUNREYE_INGRESS=172.30.32.2"),
      ],
      ["an ingress request from the Supervisor acts as admin", session.status === 204],
      ["the Supervisor adds a device through the prefix", added],
      [
        "the ingress header from another address needs the login",
        (await direct("/api/v1/session")) === 401,
      ],
      ["the screen loads every asset under the prefix", shown.failed.length === 0],
      ["the screen streams live values through the prefix", shown.liveStatus === 200],
      ["the screen shows no refusal", shown.alert === null],
    ];
  } finally {
    await run(["docker", "rm", "-f", id]);
  }
}

async function coreChecks(): Promise<Check[]> {
  const id = await startCore("core", []);

  try {
    const session = await fetch(`http://${PROXY}${PREFIX}/api/v1/session`);
    const shown = await screen();

    return [
      ["the core image runs the skeleton", (await direct("/openapi.json")) === 200],
      ["the core image trusts no ingress", session.status === 401],
      ["its screen asks for setup", shown.asksPassword],
    ];
  } finally {
    await run(["docker", "rm", "-f", id]);
  }
}

/** Runs the nginx stand-in for Supervisor's ingress proxy around `checks`. */
async function behindIngress(checks: () => Promise<Check[]>): Promise<Check[]> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-ingress-"));
  const conf = join(dir, "default.conf");

  await writeFile(conf, INGRESS);

  const mount = `${conf}:/etc/nginx/conf.d/default.conf:ro`;

  const proxy = await run([
    "docker",
    "run",
    "-d",
    "--network",
    "host",
    "-v",
    mount,
    "nginx:alpine",
  ]);

  try {
    return await checks();
  } finally {
    await run(["docker", "rm", "-f", proxy]);
    await rm(dir, { recursive: true });
  }
}

async function main(): Promise<number> {
  await run(["bun", "run", "--cwd", "apps/web", "build"]);
  await build("core");
  await build("addon");

  try {
    const checks = await behindIngress(async () => [
      ...(await coreChecks()),
      ...(await addonChecks()),
    ]);

    return report(checks);
  } finally {
    await run(["docker", "image", "rm", `${IMAGE}:core`, `${IMAGE}:addon`]);
  }
}

process.exitCode = await main();
