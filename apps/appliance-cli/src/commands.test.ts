import { describe, expect, test } from "bun:test";
import { applyCommand, type Context } from "./commands";
import { DEFAULT_SITE, type SiteConfig } from "./site";

const ctx: Context = {
  zoneExists: (tz) => ["UTC", "Europe/Berlin", "America/New_York"].includes(tz),
  isRoot: true,
};

/** The happy path returns an update; anything else is a test bug, so say so loudly. */
function updated(argv: readonly string[], site: SiteConfig = DEFAULT_SITE, context: Context = ctx) {
  const outcome = applyCommand(site, argv, context);
  if (outcome.kind !== "update")
    throw new Error(`expected an update, got ${outcome.kind}: ${JSON.stringify(outcome)}`);
  return outcome;
}

function failure(argv: readonly string[], site: SiteConfig = DEFAULT_SITE, context: Context = ctx) {
  const outcome = applyCommand(site, argv, context);
  if (outcome.kind !== "error") throw new Error(`expected an error, got ${outcome.kind}`);
  return outcome.message;
}

describe("timezone", () => {
  test("sets a zone the system knows", () => {
    expect(updated(["timezone", "Europe/Berlin"]).site.timeZone).toBe("Europe/Berlin");
  });

  test("refuses a zone the system does not have, because a bad TZ is only visible in the bills", () => {
    expect(failure(["timezone", "Europe/Berlim"])).toContain("Europe/Berlim");
  });

  test("needs a zone", () => {
    expect(failure(["timezone"])).toContain("usage");
  });
});

describe("lan-access", () => {
  test("on with no site id advertises the prefix directly", () => {
    const { site } = updated(["lan-access", "on"]);
    expect(site.lan).toEqual({ mode: "direct", siteId: null });
  });

  test("on with a site id advertises both, so a second site costs nothing later", () => {
    expect(updated(["lan-access", "on", "--site-id", "1"]).site.lan).toEqual({
      mode: "both",
      siteId: 1,
    });
  });

  test("off clears the site id too, because a stale id blocks the rebuild", () => {
    const routed: SiteConfig = { ...DEFAULT_SITE, lan: { mode: "both", siteId: 4 } };
    expect(updated(["lan-access", "off"], routed).site.lan).toEqual({ mode: "none", siteId: null });
  });

  test("rejects a site id outside the 4via6 range", () => {
    expect(failure(["lan-access", "on", "--site-id", "0"])).toContain("--site-id");
    expect(failure(["lan-access", "on", "--site-id", "65536"])).toContain("--site-id");
  });

  test("refuses when this box is not on a tailnet at all — there is nothing to advertise to", () => {
    const noTailnet: SiteConfig = { ...DEFAULT_SITE, tailscale: { enable: false } };
    expect(failure(["lan-access", "on"], noTailnet)).toContain("tailscale");
  });

  test("--site-id is meaningless with off and is rejected rather than ignored", () => {
    expect(failure(["lan-access", "off", "--site-id", "1"])).toContain("--site-id");
  });

  test("rejects anything but on and off", () => {
    expect(failure(["lan-access"])).toContain("usage");
    expect(failure(["lan-access", "maybe"])).toContain("usage");
  });
});

describe("ssh-key", () => {
  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 ops@example";

  test("add appends, and adding the same key twice is not an error", () => {
    const once = updated(["ssh-key", "add", key]).site;
    expect(once.ssh.authorizedKeys).toEqual([key]);
    expect(applyCommand(once, ["ssh-key", "add", key], ctx)).toMatchObject({ kind: "print" });
  });

  test("remove drops a key by its exact text", () => {
    const withKey: SiteConfig = { ...DEFAULT_SITE, ssh: { authorizedKeys: [key] } };
    expect(updated(["ssh-key", "remove", key], withKey).site.ssh.authorizedKeys).toEqual([]);
  });

  test("removing a key that is not there says so rather than rebuilding for nothing", () => {
    expect(failure(["ssh-key", "remove", key])).toContain("not configured");
  });

  test("list prints, and never rebuilds", () => {
    const withKey: SiteConfig = { ...DEFAULT_SITE, ssh: { authorizedKeys: [key] } };
    const outcome = applyCommand(withKey, ["ssh-key", "list"], ctx);
    expect(outcome).toMatchObject({ kind: "print" });
    if (outcome.kind !== "print") return;
    expect(outcome.text).toContain(key);
  });

  test("list says so when there are none, rather than printing nothing at all", () => {
    const outcome = applyCommand(DEFAULT_SITE, ["ssh-key", "list"], ctx);
    if (outcome.kind !== "print") throw new Error("expected a print");
    expect(outcome.text).toContain("no keys");
  });

  test("rejects a value that is not an SSH public key", () => {
    expect(failure(["ssh-key", "add", "hunter2"])).toContain("public key");
  });

  test("needs a subcommand and, for add/remove, a key", () => {
    expect(failure(["ssh-key"])).toContain("usage");
    expect(failure(["ssh-key", "add"])).toContain("usage");
    expect(failure(["ssh-key", "rotate", "x"])).toContain("usage");
  });
});

describe("tls", () => {
  test("sets each mode", () => {
    expect(updated(["tls", "internal"]).site.tls).toBe("internal");
    expect(updated(["tls", "tailscale"], { ...DEFAULT_SITE }).site.tls).toBe("tailscale");
  });

  test("refuses a tailscale certificate on a box with tailscale off", () => {
    const noTailnet: SiteConfig = { ...DEFAULT_SITE, tailscale: { enable: false } };
    expect(failure(["tls", "tailscale"], noTailnet)).toContain("tailscale");
    expect(failure(["tls", "both"], noTailnet)).toContain("tailscale");
    expect(applyCommand(noTailnet, ["tls", "internal"], ctx).kind).toBe("update");
  });

  test("rejects an unknown mode", () => {
    expect(failure(["tls", "letsencrypt"])).toContain("usage");
  });
});

describe("tailscale reset", () => {
  test("is a root action, and returns one rather than editing the document", () => {
    expect(applyCommand(DEFAULT_SITE, ["tailscale", "reset"], ctx)).toEqual({ kind: "reset" });
  });

  test("refuses for a non-root caller, because it would fail halfway through", () => {
    expect(failure(["tailscale", "reset"], DEFAULT_SITE, { ...ctx, isRoot: false })).toContain(
      "root",
    );
  });

  test("rejects any other tailscale subcommand", () => {
    expect(failure(["tailscale", "up"])).toContain("usage");
  });
});

describe("show and apply", () => {
  test("show asks for the summary, and never rebuilds", () => {
    expect(applyCommand(DEFAULT_SITE, ["show"], ctx)).toEqual({ kind: "show" });
  });

  test("apply rebuilds without changing the document", () => {
    expect(applyCommand(DEFAULT_SITE, ["apply"], ctx)).toEqual({ kind: "apply" });
  });
});

describe("the command surface itself", () => {
  test("no arguments prints help rather than doing something", () => {
    const outcome = applyCommand(DEFAULT_SITE, [], ctx);
    if (outcome.kind !== "print") throw new Error("expected a print");
    expect(outcome.text).toContain("sunreye");
  });

  test("--help and help both print it", () => {
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      expect(applyCommand(DEFAULT_SITE, argv, ctx).kind).toBe("print");
    }
  });

  test("an unknown command names itself and points at help", () => {
    const message = failure(["reboot"]);
    expect(message).toContain("reboot");
    expect(message).toContain("--help");
  });

  test("every update carries a one-line summary of what changed", () => {
    expect(updated(["timezone", "Europe/Berlin"]).summary).toContain("Europe/Berlin");
    expect(updated(["lan-access", "on"]).summary.length).toBeGreaterThan(0);
    expect(updated(["tls", "internal"]).summary).toContain("internal");
    expect(updated(["ssh-key", "add", "ssh-rsa AAAAB3 a@b"]).summary).toContain("key");
  });

  test("an update never mutates the document it was given", () => {
    const before = structuredClone(DEFAULT_SITE);
    updated(["timezone", "Europe/Berlin"]);
    updated(["ssh-key", "add", "ssh-rsa AAAAB3 a@b"]);
    expect(DEFAULT_SITE).toEqual(before);
  });

  // A rebuild on an appliance is minutes of the dashboard being unavailable and
  // a generation on a flash device. A command that would change nothing must not
  // buy either of those.
  test("a command that changes nothing reports it instead of rebuilding", () => {
    expect(applyCommand(DEFAULT_SITE, ["timezone", "UTC"], ctx)).toMatchObject({ kind: "print" });
    expect(applyCommand(DEFAULT_SITE, ["tls", "both"], ctx)).toMatchObject({ kind: "print" });
    expect(applyCommand(DEFAULT_SITE, ["lan-access", "off"], ctx)).toMatchObject({ kind: "print" });
  });
});

/**
 * `inverter` and `simulate` are gone from this tool deliberately.
 *
 * Both wrote `site.json`, which becomes the container's environment — and env
 * only SEEDS the runtime config the first time it is read. Once the dashboard
 * has saved an inverter the database is the authority, so on a running box
 * those commands changed nothing while reporting success. The inverter is set
 * during onboarding now, where the simulate switch also greys out the
 * connection fields it would have no use for.
 */
describe("the removed inverter commands", () => {
  test("`inverter` is refused, not silently accepted", () => {
    expect(applyCommand(DEFAULT_SITE, ["inverter", "192.168.1.100"], ctx).kind).toBe("error");
  });

  test("`simulate` is refused too", () => {
    expect(applyCommand(DEFAULT_SITE, ["simulate", "off"], ctx).kind).toBe("error");
  });

  // A bare "not a command" reads as a broken tool to someone following an older
  // doc or their own shell history. The refusal has to say where it went.
  test("the refusal says where the setting lives now", () => {
    const outcome = applyCommand(DEFAULT_SITE, ["inverter", "192.168.1.100"], ctx);

    expect(outcome.kind === "error" && outcome.message).toMatch(/dashboard|onboarding/i);
  });
});

/**
 * Pulling a release without waiting for the nightly timer.
 *
 * The box already knows how to upgrade itself — `nixos-upgrade.service`, at
 * 04:20 plus jitter. What it had no way to say was "now". The answer was
 * `systemctl start nixos-upgrade.service`, which is not something a tool whose
 * entire job is configuring this box should make someone find out elsewhere.
 *
 * `apply` is NOT that command and never was: it rebuilds against the existing
 * flake.lock, so it reproduces the system you already have. Moving the lock is
 * `--update-input`, and that lives in the unit.
 */
describe("upgrade", () => {
  test("it asks for the unit the timer already runs", () => {
    expect(applyCommand(DEFAULT_SITE, ["upgrade"], ctx)).toEqual({ kind: "upgrade" });
  });

  // It stops containers and switches the system generation.
  test("it refuses without root, and says why", () => {
    const outcome = applyCommand(DEFAULT_SITE, ["upgrade"], { ...ctx, isRoot: false });

    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.message).toMatch(/root|sudo/i);
  });

  test("it is in the help, or nobody will find it", () => {
    const printed = applyCommand(DEFAULT_SITE, ["--help"], ctx);

    expect(printed.kind === "print" && printed.text).toContain("upgrade");
  });
});
