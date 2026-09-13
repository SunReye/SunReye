#!/usr/bin/env bun
import { createServer } from "node:http";
import { access, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * Hand this box's console password to whoever set it up, exactly once.
 *
 * The appliance generates a root password on first boot and prints it on the
 * console. That covers someone standing at the machine with a monitor, and
 * nobody else — which is the wrong shape for a headless box in a cupboard. The
 * other ways in are worse for a first boot: Tailscale SSH needs enrolment to
 * have already worked, and a baked `authorized_keys` needs the owner to have
 * built the image themselves.
 *
 * So the password is also served over the LAN, behind the same Caddy that
 * serves the dashboard, for a few minutes after boot.
 *
 * It closes on the FIRST successful read, not only on the timer, and that is
 * the point. A timed window with unlimited reads leaves you unable to tell
 * afterwards whether anyone else looked; one that closes on read makes the
 * answer visible — see the password and you know you were first, get refused
 * and you know to re-flash. The exposure is the same class the box already has
 * during setup (whoever reaches the enrolment page first owns the tailnet
 * enrolment, whoever registers first is the admin), but this way it is
 * detectable.
 *
 * The marker is a file, so a box that has been read from never reopens the
 * window across a reboot.
 */

export interface FirstBootRequest {
  /** The generated console password. Never logged, never echoed on a refusal. */
  password: string;
  /** Milliseconds since the window opened. May be <= 0 if the clock stepped. */
  elapsedMs: number;
  /** How long the window stays open unread. */
  windowMs: number;
  /** Whether the password has already been handed out, on this boot or an earlier one. */
  claimed: boolean;
}

export interface FirstBootResponse {
  status: number;
  body: string;
  /** True when this response contained the password, so the caller must record it. */
  claim: boolean;
}

const REFUSAL = `SunReye — setup window closed

This box's password has already been handed out, or the window expired.

If you did not take it, someone else on this network may have. Re-flash the
box if that matters to you.

You can still reach this box with a monitor and keyboard — the password is on
the login screen — or over Tailscale SSH once it is enrolled.
`;

const offer = (password: string) => `SunReye — this box's password

    root / ${password}

This page will not show it again. Write it down.

It works on the console, and over SSH only if you add a key; SSH refuses
passwords. Nothing else on this network can read this page now.
`;

/**
 * Decide what a request to the window gets.
 *
 * Pure, because the interesting behaviour is entirely in this decision and a
 * server that wires it to a socket is not where a mistake would hide.
 */
// fallow-ignore-next-line unused-export -- the decision under test; first-boot.test.ts is its only other consumer and test files are not traced
export function firstBootResponse(request: FirstBootRequest): FirstBootResponse {
  const { password, elapsedMs, windowMs, claimed } = request;

  // Claimed outlives everything: a box read from once never reopens, however
  // long ago that was and whatever the clock has done since.
  if (claimed) return { status: 410, body: REFUSAL, claim: false };

  // `>=`, so the deadline itself is closed rather than the millisecond after
  // it. Negative elapsed time is a clock that stepped backwards, not an expiry.
  if (elapsedMs >= windowMs) return { status: 410, body: REFUSAL, claim: false };

  return { status: 200, body: offer(password), claim: true };
}

/**
 * The server, as a function of its filesystem so it can be tested against one.
 *
 * Reading the password and the marker on EVERY request rather than at startup:
 * the marker is what makes this one-shot, and a copy cached in memory would be
 * wrong the moment anything else on the box wrote it — including a second
 * instance of this server after a restart.
 */
export interface FirstBootIo {
  readPassword: () => Promise<string | null>;
  isClaimed: () => Promise<boolean>;
  markClaimed: () => Promise<void>;
  now: () => number;
}

// fallow-ignore-next-line unused-export -- exported for first-boot.test.ts, which exercises the one-shot behaviour against a fake filesystem
export function firstBootHandler(io: FirstBootIo, openedAt: number, windowMs: number) {
  return async (): Promise<FirstBootResponse> => {
    const password = await io.readPassword();

    // No password file means the generator has not run yet. That is a box still
    // booting, not a closed window — but there is nothing to hand over, and
    // saying "already claimed" would be a lie that sends someone to re-flash.
    if (password === null) {
      return {
        status: 503,
        body: "SunReye — still starting up. Try again in a moment.\n",
        claim: false,
      };
    }

    const response = firstBootResponse({
      password,
      elapsedMs: io.now() - openedAt,
      windowMs,
      claimed: await io.isClaimed(),
    });

    // Marked BEFORE the body is handed to the socket. A crash between the two
    // costs the owner a re-flash; the other order costs them a password that
    // reads as unclaimed after somebody already has it.
    if (response.claim) await io.markClaimed();

    return response;
  };
}

/**
 * Whether this module is the program being run. See main.ts — `import.meta.main`
 * is a Bun-ism and is `undefined` under node, which would leave this block dead
 * and the window silently never opening.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

/**
 * The real seam, over a pair of paths.
 *
 * Parameterised so the suite can exercise it against a temporary directory:
 * "no password file yet" and "the marker is 0600" are both behaviour, and a
 * first boot is precisely the case where neither file exists. Untested, they
 * are the two things that would break on a box and nowhere else.
 */
// fallow-ignore-next-line unused-export -- the entry point below and first-boot.test.ts are its consumers; test files are not traced
export function makeFirstBootIo(paths: { passwordFile: string; claimFile: string }): FirstBootIo {
  return {
    readPassword: async () => {
      try {
        return (await readFile(paths.passwordFile, "utf8")).trim();
      } catch {
        return null;
      }
    },
    isClaimed: async () => {
      try {
        await access(paths.claimFile);
        return true;
      } catch {
        return false;
      }
    },
    // 0600: the marker records that a password has been handed out, and on a box
    // where that is the only credential, its absence is what reopens the window.
    markClaimed: async () => {
      await writeFile(paths.claimFile, `${new Date().toISOString()}\n`, { mode: 0o600 });
    },
    now: () => Date.now(),
  };
}

/**
 * The window as an HTTP server.
 *
 * node:http, not Bun.serve — see main.ts for why nothing here may depend on
 * bun. Returned rather than listened on so a test can bind an ephemeral port
 * and close it; the one-shot behaviour is only real once it has been through a
 * socket, and this transport was rewritten wholesale when bun came out.
 */
// fallow-ignore-next-line unused-export -- the entry point below and first-boot.test.ts are its consumers; test files are not traced
export function firstBootServer(handle: () => Promise<FirstBootResponse>) {
  return createServer((_request, response) => {
    void handle().then(({ status, body }) => {
      response.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        // A password in a proxy or browser cache is the same password available
        // to the next person who opens that browser.
        "cache-control": "no-store",
      });
      response.end(body);
    });
  });
}

if (isEntryPoint()) {
  const port = Number(process.env.SUNREYE_FIRST_BOOT_PORT ?? 5251);
  const windowMs = Number(process.env.SUNREYE_FIRST_BOOT_WINDOW_MS ?? 15 * 60 * 1000);

  const io = makeFirstBootIo({
    passwordFile: process.env.SUNREYE_PASSWORD_FILE ?? "/var/lib/secrets/console-password",
    claimFile: process.env.SUNREYE_CLAIM_FILE ?? "/var/lib/secrets/console-claimed",
  });

  // 127.0.0.1 only: Caddy publishes this on the LAN over HTTPS, and a listener
  // of our own on 0.0.0.0 would be a second door serving the same secret in
  // clear.
  firstBootServer(firstBootHandler(io, Date.now(), windowMs)).listen(port, "127.0.0.1", () => {
    console.log(`first-boot window open on 127.0.0.1:${port} for ${windowMs / 1000}s`);
  });
}
