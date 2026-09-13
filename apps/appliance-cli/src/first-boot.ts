#!/usr/bin/env bun
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

if (import.meta.main) {
  const passwordFile = process.env.SUNREYE_PASSWORD_FILE ?? "/var/lib/secrets/console-password";
  const claimFile = process.env.SUNREYE_CLAIM_FILE ?? "/var/lib/secrets/console-claimed";
  const port = Number(process.env.SUNREYE_FIRST_BOOT_PORT ?? 5251);
  const windowMs = Number(process.env.SUNREYE_FIRST_BOOT_WINDOW_MS ?? 5 * 60 * 1000);

  const handle = firstBootHandler(
    {
      readPassword: async () => {
        const file = Bun.file(passwordFile);
        return (await file.exists()) ? (await file.text()).trim() : null;
      },
      isClaimed: async () => await Bun.file(claimFile).exists(),
      markClaimed: async () => {
        await Bun.write(claimFile, `${new Date().toISOString()}\n`);
      },
      now: () => Date.now(),
    },
    Date.now(),
    windowMs,
  );

  // 127.0.0.1 only. Caddy publishes this on the LAN over HTTPS; a listener of
  // our own on 0.0.0.0 would be a second door serving the same secret in clear.
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async () => {
      const { status, body } = await handle();
      return new Response(body, {
        status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          // A password in a proxy or browser cache is the same password
          // available to the next person who opens that browser.
          "cache-control": "no-store",
        },
      });
    },
  });

  console.log(`first-boot window open on 127.0.0.1:${port} for ${windowMs / 1000}s`);
}
