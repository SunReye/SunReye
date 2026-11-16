// The smoothness journeys (ADR 21): each signature transition, driven as a person would.
// `ready` runs at full speed; `act` runs throttled while the probe records.

import type { CDPSession, Page } from "playwright";
import { aim } from "./aim.ts";
import { EXPLORE, EXPLORE_LANES } from "./explore.ts";
import {
  back,
  builderShown,
  centre,
  drag,
  inTurn,
  land,
  type Pixel,
  sceneShown,
  swipe,
  tap,
} from "./gestures.ts";

export interface Journey {
  readonly name: string;
  /** A 390 × 844 touch phone; else a 1280 × 800 mouse desk. */
  readonly phone?: boolean;
  /** The hash route it opens on. */
  readonly route: string;
  /** localStorage before the page loads. */
  readonly storage?: Readonly<Record<string, string>>;
  /** Throttled and recorded from the first byte, as the tap during the 3D load must be. */
  readonly cold?: boolean;
  /** Judged by input delay alone, not by frames. */
  readonly input?: boolean;
  readonly ready?: (page: Page) => Promise<void>;
  readonly act: (page: Page, cdp: CDPSession) => Promise<void>;
}

const TWO_D = { "sunreye.dashboard": "2d" };
const THREE_D = { "sunreye.dashboard": "3d" };

/** Six seconds of live ticks, one a second. */
const ticks = (page: Page) => land(page, 6000);

/**
 * Presses the today card's heading every 150 ms until the 3D scene shows, then waits it out. Raw
 * presses: an actionability check would wait for the main thread and hide the very delay measured.
 */
async function pressUntilShown(page: Page, at: Pixel, left = 400): Promise<void> {
  if (left === 0 || (await page.locator("figure.shown").count()) > 0) {
    await land(page, 3000);

    return;
  }

  await page.mouse.click(...at);
  await land(page, 150);
  await pressUntilShown(page, at, left - 1);
}

const DESK: readonly Journey[] = [
  {
    name: "rail: hover open and close, pin and unpin",
    route: "history",
    act: async (page) => {
      await inTurn([1, 2, 3], async () => {
        await page.mouse.move(30, 300, { steps: 6 });
        await land(page);
        await page.mouse.move(800, 400, { steps: 6 });
        await land(page);
      });
      await page.mouse.move(30, 300, { steps: 6 });
      await tap(page, "Anheften");
      await tap(page, "Lösen");
    },
  },
  {
    name: "route change through the rail",
    route: "history",
    storage: TWO_D,
    act: (page) =>
      inTurn(
        ["Prognose", "Tarif und Ersparnis", "Status", "Dashboard", "Verlauf"],
        async (name) => {
          await page.mouse.move(30, 300, { steps: 3 });
          await page.getByRole("link", { name }).first().click();
          await page.mouse.move(800, 400, { steps: 3 });
          await land(page, 1500);
        },
      ),
  },
  {
    name: "camera flight between the builder's views",
    route: "builder",
    ready: builderShown,
    act: (page) =>
      inTurn(["Norden", "Osten", "Von oben", "Isometrisch"], (view) => tap(page, view)),
  },
  {
    name: "live tick on the 3D dashboard",
    route: "",
    storage: THREE_D,
    ready: sceneShown,
    act: ticks,
  },
  {
    name: "2D flow, full tier",
    route: "",
    storage: { ...TWO_D, "sunreye.motion-strain": "0" },
    act: ticks,
  },
  {
    name: "2D flow, lite tier",
    route: "",
    storage: { ...TWO_D, "sunreye.motion-strain": "1" },
    act: ticks,
  },
  {
    name: "tap during the 3D scene's background load",
    route: "",
    storage: THREE_D,
    cold: true,
    input: true,
    act: async (page) => {
      const box = await page.getByRole("heading", { name: "Heute" }).boundingBox();

      if (box === null) throw new Error("no today card");

      await pressUntilShown(page, [box.x + box.width / 2, box.y + box.height / 2]);
    },
  },
  {
    name: "builder: drag a block's width handle",
    route: "builder",
    ready: async (page) => {
      await builderShown(page);
      await tap(page, "Gebäude");
      await tap(page, "Baukörper 1");
    },
    act: async (page) => {
      const [from, to] = await aim(page);

      await drag(page, from, to);
      await drag(page, to, from);
    },
  },
  {
    name: "builder: drag a window's width handle",
    route: "builder",
    ready: async (page) => {
      await builderShown(page);
      await tap(page, "Gebäude");
      await tap(page, "Fenster hinzufügen");
    },
    act: async (page) => {
      const [from, to] = await aim(page, "window");

      await drag(page, from, to);
      await drag(page, to, from);
    },
  },
  {
    name: "builder: drag a chimney over its roof",
    route: "builder",
    ready: async (page) => {
      await builderShown(page);
      await tap(page, "Gebäude");
      await tap(page, "Schornstein hinzufügen");
    },
    act: async (page) => {
      const [from, to] = await aim(page, "chimney");

      await drag(page, from, to);
      await drag(page, to, from);
    },
  },
  {
    name: "builder: paint a stroke across a face's cells",
    route: "builder",
    ready: async (page) => {
      await builderShown(page);
      await tap(page, "Module");
      await tap(page, "Baukörper 1, Fläche 2");
    },
    act: async (page) => {
      const cells = page.locator("[data-row][data-column]");

      const middle = async (n: number) => {
        const box = await cells.nth(n).boundingBox();

        if (box === null) throw new Error("no cells");

        return [box.x + box.width / 2, box.y + box.height / 2] as const;
      };

      const a = await middle(0);
      const b = await middle((await cells.count()) - 1);

      await drag(page, a, b);
      await drag(page, b, a);
    },
  },
  {
    name: "statistics: range switch, step, tabs and drill",
    route: "history",
    act: async (page) => {
      await inTurn(["Woche", "Tag", "Jahr", "Monat"], (range) => tap(page, range, "radio"));
      await inTurn(["Früher", "Früher", "Später"], (step) => tap(page, step));
      await inTurn(["Ersparnis", "Autarkie", "Produktion", "Muster", "Jahre", "Verlauf"], (tab) =>
        tap(page, tab, "tab"),
      );
      await tap(page, "Stärkster Abschnitt");
      await back(page);
    },
  },
  EXPLORE,
  EXPLORE_LANES,
];

const PHONE: readonly Journey[] = [
  {
    phone: true,
    name: "drill-in: settings groups in and back",
    route: "settings",
    act: (page) =>
      inTurn(["Anzeige", "Tarif", "Über SunReye"], async (group) => {
        await tap(page, group);
        await back(page);
      }),
  },
  {
    phone: true,
    name: "sheet: dashboard figures open and close over the 3D scene",
    route: "",
    storage: THREE_D,
    ready: sceneShown,
    act: (page) =>
      inTurn(["Produktion", "Spotpreis", "Verbrauch"], async (figure) => {
        await tap(page, figure);
        await back(page);
      }),
  },
  {
    phone: true,
    name: "live graph glide in the house sheet",
    route: "?detail=house",
    storage: TWO_D,
    act: ticks,
  },
  {
    phone: true,
    name: "value-editor fling",
    route: "controls?group=battery",
    ready: async (page) => {
      await page.getByRole("button", { name: "battery.max_charge_current" }).click();
      await page.getByRole("spinbutton").first().waitFor();
      await land(page);
    },
    act: async (page, cdp) => {
      const box = await page.getByRole("spinbutton").first().boundingBox();

      if (box === null) throw new Error("no wheel");

      const mid = [box.x + box.width / 2, box.y + box.height / 2] as const;

      await inTurn([-160, 160, -220], async (dy) => {
        await swipe(cdp, mid, [mid[0], mid[1] + dy], 4);
        await land(page, 1800);
      });
    },
  },
  {
    phone: true,
    name: "statistics: finger-drag paging",
    route: "history",
    act: async (page, cdp) => {
      const [x, y] = await centre(page, "Produktion und Hausverbrauch über die Zeit");

      await inTurn([140, 140, -140], async (dx) => {
        await swipe(cdp, [x - dx / 2, y], [x + dx / 2, y], 12);
        await land(page, 1200);
      });
    },
  },
];

export const JOURNEYS: readonly Journey[] = [...DESK, ...PHONE];
