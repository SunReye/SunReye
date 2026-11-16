// Scratch: screenshots of the dashboard scene per 3D quality level. bun shot.ts <port> <outdir> <tag> [levels...]
import { chromium } from "playwright";

const [port, out, tag, ...levels] = process.argv.slice(2);
const zone = await (await fetch(`http://127.0.0.1:${port}/zone`)).json();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

for (const level of levels.length > 0 ? levels : ["low", "medium", "high", "ultra"]) {
  for (const scheme of (process.env.SCHEMES ?? "light").split(",")) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: Number(process.env.DPR ?? 1),
      locale: "de-DE",
      timezoneId: zone.name,
      colorScheme: scheme as "light" | "dark",
    });

    await context.addInitScript(([mode, quality]) => {
      localStorage.setItem("mode-watcher-mode", mode!);
      if (quality !== "base") localStorage.setItem("sunreye.3d-quality", quality!);
    }, [scheme, level]);

    await context.clock.install({ time: new Date(process.env.AT ?? "2026-06-21T13:30:00Z") });
    const page = await context.newPage();
    const errors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    const started = Date.now();

    await page.route("**/api/v1/**", (route) => route.continue({ url: route.request().url().replace(`:${process.env.VITE ?? 18779}`, `:${port}`) }));
    await page.goto(`http://127.0.0.1:${process.env.VITE ?? 18779}/`);
    await page.mouse.move(1270, 790);
    await page.locator("canvas").first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(Number(process.env.WAIT ?? 15_000));
    await page.screenshot({ path: `${out}/${tag}-${level}-${scheme}.png`, timeout: 180_000 });

    const zoom = Number(process.env.ZOOM ?? 0);

    if (zoom > 0) {
      const canvas = page.locator("canvas").first();
      const box = (await canvas.boundingBox())!;
      const [dx, dy] = (process.env.PAN ?? "0,0").split(",").map(Number);

      await page.getByRole("button", { name: "Kamera bewegen" }).click();
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
      for (let i = 0; i < zoom; i++) {
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(400);
      }
      const [ox, oy] = (process.env.ORBIT ?? "0,0").split(",").map(Number);

      if (ox !== 0 || oy !== 0) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5 + ox!, box.y + box.height * 0.6 + oy!, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(1500);
      }
      if (dx !== 0 || dy !== 0) {
        await page.mouse.down({ button: "right" });
        await page.mouse.move(box.x + box.width * 0.55 + dx!, box.y + box.height * 0.5 + dy!, { steps: 6 });
        await page.mouse.up({ button: "right" });
      }
      await page.mouse.move(1270, 790);
      await page.waitForTimeout(Number(process.env.SETTLE ?? 12_000));
      await page.screenshot({
        path: `${out}/${tag}-${level}-${scheme}-zoom.png`,
        clip: { x: box.x, y: box.y + 110, width: box.width, height: box.height - 110 },
        timeout: 180_000,
      });

      // Further views, each a step from the last: "name:wheels:panx,pany;..."
      for (const view of (process.env.VIEWS ?? "").split(";").filter(Boolean)) {
        const [name, wheels, pan] = view.split(":");
        const [px, py] = (pan ?? "0,0").split(",").map(Number);
        const [cx, cy] = [box.x + box.width * 0.55, box.y + box.height * 0.5];

        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(cx + px!, cy + py!, { steps: 6 });
        await page.mouse.up({ button: "right" });
        for (let i = 0; i < Math.abs(Number(wheels)); i++) {
          await page.mouse.wheel(0, Number(wheels) > 0 ? -240 : 240);
          await page.waitForTimeout(400);
        }
        await page.mouse.move(1270, 790);
        await page.waitForTimeout(Number(process.env.SETTLE ?? 12_000));
        await page.screenshot({
          path: `${out}/${tag}-${level}-${scheme}-${name}.png`,
          clip: { x: box.x, y: box.y + 110, width: box.width, height: box.height - 110 },
          timeout: 180_000,
        });
      }
    }

    console.log(level, scheme, Date.now() - started, "ms", errors.slice(0, 5));
    await context.close();
  }
}

await browser.close();
