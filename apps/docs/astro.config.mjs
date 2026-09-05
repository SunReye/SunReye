import starlight from "@astrojs/starlight";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-check
import { defineConfig } from "astro/config";

const github = "https://github.com/SunReye/SunReye";

// GitHub Pages project site: https://sunreye.github.io/SunReye/
// If a custom domain is ever configured, set `base: "/"` (or drop it) and point
// `site` at the domain.
const site = "https://sunreye.github.io";
const base = "/SunReye";
const prefix = base.replace(/\/$/, "");

// Astro base-prefixes the links Starlight generates (nav, sidebar, assets), but
// NOT root-absolute links authored by hand — markdown links like
// `[Settings](/use/settings/)` and component/frontmatter links like a splash
// `hero.actions[].link` or `<LinkCard href="/start/quick-start/">`. Left alone
// they resolve to the domain root and 404 under the `/SunReye/` path prefix.
//
// Rewrite them in one content-agnostic pass over the emitted HTML: every
// `href`/`src` that is root-absolute but not protocol-relative (`//`) and not
// already based gets the prefix. Catches all sources — markdown, components,
// frontmatter — so new pages can't reintroduce the bug.
function baseAbsoluteLinks() {
  const re = new RegExp(`(\\s(?:href|src)=")(/(?!/|${prefix.slice(1)}/)[^"]*)"`, "g");
  return {
    name: "base-absolute-links",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        let count = 0;
        // fallow-ignore-next-line complexity -- recursive directory walk: the dir/.html/changed branches are the whole algorithm; splitting them into helpers would only move the same branching behind extra indirection in build-time config code
        const walk = async (d) => {
          for (const entry of await readdir(d, { withFileTypes: true })) {
            const p = join(d, entry.name);
            if (entry.isDirectory()) {
              await walk(p);
            } else if (entry.name.endsWith(".html")) {
              const html = await readFile(p, "utf8");
              const next = html.replace(re, (_m, attr, path) => {
                count++;
                return `${attr}${prefix}${path}"`;
              });
              if (next !== html) await writeFile(p, next);
            }
          }
        };
        await walk(fileURLToPath(dir));
        logger.info(`rewrote ${count} root-absolute link(s) under ${base}`);
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site,
  base,
  // The costs page became the statistics page; the old URL stays alive for
  // existing links and bookmarks. Astro emits a static meta-refresh page — the
  // key is base-relative (it decides where the file is written), but the target
  // lands verbatim in `<meta http-equiv="refresh">` and in the canonical link,
  // neither of which Astro or `baseAbsoluteLinks` (href/src only) prefixes. So
  // the target carries the base itself.
  redirects: {
    "/use/costs": `${prefix}/use/statistics`,
  },
  integrations: [
    baseAbsoluteLinks(),
    starlight({
      title: "SunReye",
      description:
        "Self-hosted monitoring, control, and integration platform for solar / hybrid inverters. An inverter is data, not code.",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "SunReye",
        replacesTitle: false,
      },
      social: [{ icon: "github", label: "GitHub", href: github }],
      editLink: {
        baseUrl: `${github}/edit/master/apps/docs/`,
      },
      customCss: ["./src/styles/theme.css"],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Introduction", slug: "start/introduction" },
            { label: "Architecture", slug: "start/architecture" },
            { label: "Quick Start", slug: "start/quick-start" },
          ],
        },
        {
          label: "Install & Deploy",
          items: [
            { label: "Requirements", slug: "deploy/requirements" },
            { label: "Manual Setup", slug: "deploy/manual-setup" },
            { label: "Docker Compose", slug: "deploy/docker" },
            { label: "Home Assistant Addon", slug: "deploy/home-assistant" },
            { label: "Upgrading to 2.0.0", slug: "deploy/upgrading-to-2" },
          ],
        },
        {
          label: "Using SunReye",
          items: [
            { label: "Dashboard", slug: "use/dashboard" },
            { label: "History & Analytics", slug: "use/history" },
            { label: "Controls", slug: "use/controls" },
            { label: "Statistics", slug: "use/statistics" },
            { label: "Settings", slug: "use/settings" },
            { label: "Export & Import", slug: "use/export-import" },
            { label: "Users & Roles", slug: "use/users" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "REST API", slug: "integrations/rest-api" },
            { label: "MQTT Bridge", slug: "integrations/mqtt" },
            { label: "Home Assistant", slug: "integrations/home-assistant" },
            { label: "EVCC", slug: "integrations/evcc" },
          ],
        },
        {
          label: "Inverter Profiles",
          items: [
            { label: "Profiles as Data", slug: "profiles/concept" },
            { label: "Supported Inverters", slug: "profiles/supported" },
            { label: "Authoring a Profile", slug: "profiles/authoring" },
            { label: "Distributing Profiles", slug: "profiles/distribution" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Environment Variables", slug: "reference/environment" },
            { label: "Scripts", slug: "reference/scripts" },
            { label: "Architecture Deep-Dive", slug: "reference/internals" },
            { label: "Roadmap", slug: "reference/roadmap" },
          ],
        },
        {
          label: "Contributing",
          items: [{ label: "Contributing", slug: "contributing" }],
        },
      ],
    }),
  ],
});
