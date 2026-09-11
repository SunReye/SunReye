import { describe, expect, test } from "bun:test";
import { DEFAULT_SITE, parseSite, serializeSite, type SiteConfig } from "./site";

describe("parseSite", () => {
  test("an absent file parses to the shipped defaults", () => {
    const parsed = parseSite("{}");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.site).toEqual(DEFAULT_SITE);
  });

  test("the defaults simulate, because a freshly flashed box has no inverter yet", () => {
    expect(DEFAULT_SITE.inverter.simulate).toBe(true);
    expect(DEFAULT_SITE.inverter.host).toBeNull();
  });

  test("a partial document keeps its values and fills the rest in", () => {
    const parsed = parseSite(JSON.stringify({ timeZone: "Europe/Berlin" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.site.timeZone).toBe("Europe/Berlin");
    expect(parsed.site.tls).toBe(DEFAULT_SITE.tls);
  });

  test("round-trips without drift", () => {
    const site: SiteConfig = {
      ...DEFAULT_SITE,
      timeZone: "Europe/Berlin",
      inverter: {
        host: "192.168.1.100",
        port: 502,
        unitId: 3,
        transport: "rtu-over-tcp",
        simulate: false,
        profile: "deye-sg05lp3",
      },
      lan: { mode: "both", siteId: 7 },
      tls: "tailscale",
      ssh: { authorizedKeys: ["ssh-ed25519 AAAA ops@example"] },
    };
    const again = parseSite(serializeSite(site));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.site).toEqual(site);
  });

  test("serialised output is newline-terminated JSON, so git diffs stay one-line-per-change", () => {
    const text = serializeSite(DEFAULT_SITE);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "timeZone"');
  });

  test("malformed JSON is reported, not thrown", () => {
    const parsed = parseSite("{ not json");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("not valid JSON");
  });

  test("a value of the wrong shape is reported with its path", () => {
    const parsed = parseSite(JSON.stringify({ tls: "letsencrypt" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("tls");
  });

  test("a port outside the range is rejected rather than silently clamped", () => {
    expect(parseSite(JSON.stringify({ inverter: { port: 70000 } })).ok).toBe(false);
  });

  test("a site id outside the 4via6 range is rejected", () => {
    expect(parseSite(JSON.stringify({ lan: { mode: "via", siteId: 0 } })).ok).toBe(false);
    expect(parseSite(JSON.stringify({ lan: { mode: "via", siteId: 65536 } })).ok).toBe(false);
    expect(parseSite(JSON.stringify({ lan: { mode: "via", siteId: 65535 } })).ok).toBe(true);
  });
});

/**
 * The shipped document and this schema's defaults are two statements of the same
 * thing, in two languages, and they only agree by hand. When they drift, a
 * freshly flashed box runs one configuration and `sunreye-setup show` prints
 * another — and the difference only surfaces when someone changes a setting and
 * an unrelated one moves with it.
 */
describe("nixos/template/site.json", () => {
  const template = Bun.file(`${import.meta.dir}/../../../nixos/template/site.json`);

  test("is what this schema calls the defaults", async () => {
    const parsed = parseSite(await template.text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.site).toEqual(DEFAULT_SITE);
  });

  test("is exhaustive — no field is left to the schema to fill in", async () => {
    const raw: unknown = JSON.parse(await template.text());
    // A field the template omits is a field whose default lives in two places:
    // here, and in whatever the box's own copy happened to be seeded with.
    expect(raw).toEqual(DEFAULT_SITE);
  });
});
