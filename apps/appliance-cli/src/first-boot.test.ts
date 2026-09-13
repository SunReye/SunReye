import { describe, expect, test } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  firstBootHandler,
  firstBootResponse,
  firstBootServer,
  makeFirstBootIo,
} from "./first-boot";

/**
 * The one-shot window that hands over this box's console password.
 *
 * Every other way in needs something the owner may not have: Tailscale needs
 * enrolment to have worked, the console banner needs a monitor, and a baked key
 * needs them to have built the image. This is the one that works from a browser
 * on the LAN — which is also why it has to shut.
 *
 * It closes on the FIRST successful read rather than only on a timer, and that
 * is the whole design. A five-minute window with unlimited reads tells you
 * nothing afterwards; one that closes on read tells you everything: if you saw
 * the password, nobody else did, and if you were told it was already taken, you
 * know to re-flash. Detectability, not just a shorter exposure.
 */

const PASSWORD = "kRt7mQp2xLdW9v";
const WINDOW_MS = 5 * 60 * 1000;

const at = (elapsedMs: number, claimed = false) =>
  firstBootResponse({
    password: PASSWORD,
    elapsedMs,
    windowMs: WINDOW_MS,
    claimed,
  });

describe("firstBootResponse", () => {
  test("hands over the password inside the window", () => {
    const response = at(1000);

    expect(response.status).toBe(200);
    expect(response.body).toContain(PASSWORD);
    // The caller writes the marker; saying so is how the window closes at all.
    expect(response.claim).toBe(true);
  });

  // The point of the whole design: a second reader learns that they are second.
  test("refuses once it has been read, and says so", () => {
    const response = at(1000, true);

    expect(response.status).toBe(410);
    expect(response.body).not.toContain(PASSWORD);
    expect(response.body).toMatch(/already/i);
    expect(response.claim).toBe(false);
  });

  test("refuses after the window closes, even unread", () => {
    const response = at(WINDOW_MS + 1);

    expect(response.status).toBe(410);
    expect(response.body).not.toContain(PASSWORD);
    expect(response.claim).toBe(false);
  });

  // Boundary: the window is closed AT the deadline, not one millisecond after.
  // An off-by-one here is a window that outlives its own documentation.
  test("the deadline itself is closed", () => {
    expect(at(WINDOW_MS - 1).status).toBe(200);
    expect(at(WINDOW_MS).status).toBe(410);
  });

  // A clock that has not moved, or has gone backwards across an NTP step, must
  // not read as "expired" — nor as a fresh window on a box claimed long ago.
  test("a zero or negative elapsed time is still inside the window", () => {
    expect(at(0).status).toBe(200);
    expect(at(-5000).status).toBe(200);
    expect(at(-5000, true).status).toBe(410);
  });

  // Claimed beats expired, and both beat open: a box that was read from and
  // then rebooted must never reopen.
  test("being claimed outlives the window", () => {
    const response = at(WINDOW_MS * 10, true);

    expect(response.status).toBe(410);
    expect(response.body).toMatch(/already/i);
  });

  test("the page never leaks the password into a refusal", () => {
    for (const response of [at(WINDOW_MS + 1), at(0, true), at(WINDOW_MS * 10, true)]) {
      expect(response.body).not.toContain(PASSWORD);
    }
  });
});

describe("firstBootHandler", () => {
  const io = (overrides: Partial<Parameters<typeof firstBootHandler>[0]> = {}) => {
    const state = { claimed: false, marks: 0 };
    return {
      state,
      io: {
        readPassword: async () => PASSWORD,
        isClaimed: async () => state.claimed,
        markClaimed: async () => {
          state.claimed = true;
          state.marks += 1;
        },
        now: () => 1000,
        ...overrides,
      },
    };
  };

  test("a second request gets nothing, because the first marked it", async () => {
    const { io: fake, state } = io();
    const handle = firstBootHandler(fake, 0, WINDOW_MS);

    const first = await handle();
    const second = await handle();

    expect(first.status).toBe(200);
    expect(first.body).toContain(PASSWORD);
    expect(second.status).toBe(410);
    expect(second.body).not.toContain(PASSWORD);
    expect(state.marks).toBe(1);
  });

  // The marker must be written before the body reaches the socket: crashing
  // between them should cost a re-flash, never a password that still reads as
  // unclaimed after somebody has it.
  test("it marks the claim before returning the password", async () => {
    const seen: string[] = [];
    const { io: fake } = io({
      markClaimed: async () => {
        seen.push("marked");
      },
    });

    const response = await firstBootHandler(fake, 0, WINDOW_MS)();
    seen.push("returned");

    expect(seen).toEqual(["marked", "returned"]);
    expect(response.claim).toBe(true);
  });

  // A box still generating its password has nothing to hand over — and saying
  // "already claimed" would send its owner to re-flash a healthy machine.
  test("no password file yet is 'try again', not 'too late'", async () => {
    const { io: fake, state } = io({ readPassword: async () => null });

    const response = await firstBootHandler(fake, 0, WINDOW_MS)();

    expect(response.status).toBe(503);
    expect(response.claim).toBe(false);
    expect(state.claimed).toBe(false);
  });

  // Claimed by something else — an earlier boot, another instance — must be
  // read fresh per request rather than cached at startup.
  test("it re-reads the marker rather than trusting a cached one", async () => {
    let claimed = false;
    const { io: fake } = io({ isClaimed: async () => claimed });
    const handle = firstBootHandler(fake, 0, WINDOW_MS);

    expect((await handle()).status).toBe(200);
    claimed = true;
    expect((await handle()).status).toBe(410);
  });

  test("an expired window never marks a claim", async () => {
    const { io: fake, state } = io({ now: () => WINDOW_MS + 1 });

    const response = await firstBootHandler(fake, 0, WINDOW_MS)();

    expect(response.status).toBe(410);
    expect(state.marks).toBe(0);
  });
});

describe("makeFirstBootIo", () => {
  const scratch = async () => {
    const dir = await mkdtemp(join(tmpdir(), "first-boot-"));
    return { dir, passwordFile: join(dir, "password"), claimFile: join(dir, "claimed") };
  };

  // A first boot is exactly the case where neither file exists yet, so this is
  // the state the box is in when it matters most.
  test("no password file yet reads as null, not as an empty password", async () => {
    const { passwordFile, claimFile } = await scratch();

    expect(await makeFirstBootIo({ passwordFile, claimFile }).readPassword()).toBeNull();
  });

  test("it reads the password and strips the trailing newline", async () => {
    const { passwordFile, claimFile } = await scratch();
    await writeFile(passwordFile, `${PASSWORD}\n`);

    expect(await makeFirstBootIo({ passwordFile, claimFile }).readPassword()).toBe(PASSWORD);
  });

  test("the claim marker is absent, then present, and 0600", async () => {
    const { passwordFile, claimFile } = await scratch();
    const io = makeFirstBootIo({ passwordFile, claimFile });

    expect(await io.isClaimed()).toBe(false);
    await io.markClaimed();
    expect(await io.isClaimed()).toBe(true);

    // The marker is what stops the window reopening, and it sits beside a
    // password file: world-readable would be a different kind of leak.
    expect((await stat(claimFile)).mode & 0o777).toBe(0o600);
  });
});

/**
 * The transport, through a real socket.
 *
 * This was `Bun.serve` until bun turned out to fault on the CPUs this appliance
 * ships to, and the rewrite to node:http had no test at all. The one-shot
 * behaviour is only real once it has been through a socket — everything above
 * proves a decision, this proves the thing a browser talks to.
 */
describe("firstBootServer", () => {
  const listening = async (handle: () => Promise<ReturnType<typeof firstBootResponse>>) => {
    const server = firstBootServer(handle);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return { server, url: `http://127.0.0.1:${address.port}/` };
  };

  test("it serves the password once, then refuses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "first-boot-"));
    const passwordFile = join(dir, "password");
    await writeFile(passwordFile, PASSWORD);
    const io = makeFirstBootIo({ passwordFile, claimFile: join(dir, "claimed") });

    const { server, url } = await listening(firstBootHandler(io, Date.now(), WINDOW_MS));
    try {
      const first = await fetch(url);
      const firstBody = await first.text();
      const second = await fetch(url);

      expect(first.status).toBe(200);
      expect(firstBody).toContain(PASSWORD);
      // A password in a proxy or browser cache is the same password available
      // to whoever opens that browser next.
      expect(first.headers.get("cache-control")).toBe("no-store");

      expect(second.status).toBe(410);
      expect(await second.text()).not.toContain(PASSWORD);
    } finally {
      server.close();
    }
  });
});
