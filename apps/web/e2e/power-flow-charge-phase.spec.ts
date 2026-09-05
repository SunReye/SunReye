/**
 * A change of speed on a rail does not send its charge back to the node.
 *
 * One charge per rail, and its speed is the reading — so a new reading means a
 * new `dur`, and SMIL cannot change a running animation's duration without
 * remapping its elapsed time. The chain is rebuilt instead (keyed on the dur),
 * which used to mean the comet restarted from the top of the path. The fake
 * feed swings a string's power by whole kilowatts between samples, which steps
 * the crossing time on nearly every push; a live 1 Hz feed hovering on a
 * quantization boundary does the same every second. That restart is the
 * jitter: with three or four rails on screen something snapped back on almost
 * every sample.
 *
 * A browser claim because it only exists on a running SMIL timeline: whether
 * the rebuilt chain's head is where the old one was is a question about
 * `getCurrentTime()` and a begin resolved against it. The arithmetic is unit
 * tested in `lib/inverter/flow-pulse.test.ts`.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/** Where the string-1 rail's comet head is along its cable, as a fraction 0..1. */
async function headProgress(page: Page): Promise<number> {
  return page.evaluate(() => {
    const head = document.querySelector<SVGCircleElement>(
      'circle.bead-hot animateMotion mpath[href$="-cable-pv1-hub"]',
    )?.parentElement?.parentElement as SVGCircleElement | null;
    if (!head) throw new Error("no charge on the string-1 rail");
    const cable = document.querySelector<SVGPathElement>(
      `#${head.querySelector("mpath")!.getAttribute("href")!.slice(1)}`,
    )!;
    const total = cable.getTotalLength();
    const bead = head.getBoundingClientRect();
    const svg = cable.ownerSVGElement!.getBoundingClientRect();
    const at = { x: bead.x + bead.width / 2 - svg.x, y: bead.y + bead.height / 2 - svg.y };
    // Nearest point along the cable: coarse sampling is plenty for a fraction.
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 200; i++) {
      const p = cable.getPointAtLength((total * i) / 200);
      const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i / 200;
      }
    }
    return best;
  });
}

test("a step in a rail's speed keeps its charge where it was", async ({ page }) => {
  const opened = await openPage(page, "/#/", { feedIntervalMs: 0 });
  // A slow trickle, long enough to be mid-rail when the speed changes.
  const slow = {
    "dc.pv1.power": 400,
    "dc.pv2.power": 400,
    "battery.power": 0,
    "ac.total_power": 0,
  };
  for (let i = 0; i < 3; i++) await opened.backend.pushMetrics(slow);
  await expect(page.locator('mpath[href$="-cable-pv1-hub"]').first()).toBeAttached();
  // Let the head travel to the middle of the cable, away from either end.
  await page.waitForTimeout(1800);
  const before = await headProgress(page);
  expect(before).toBeGreaterThan(0.15);
  expect(before).toBeLessThan(0.85);

  // Peak power: the fastest crossing there is, three-plus seconds shorter.
  await opened.backend.pushMetrics({ ...slow, "dc.pv1.power": 9000 });
  await page.waitForTimeout(80);
  const after = await headProgress(page);

  // Continuous: the head has moved on a little at its new speed, not snapped
  // back to the node. A restart would read near 0 here.
  expect(after).toBeGreaterThanOrEqual(before - 0.02);
  expect(after).toBeLessThan(before + 0.25);
  expect(opened.consoleErrors).toEqual([]);
});
