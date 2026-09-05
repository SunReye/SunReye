// Entrypoint for every compiled SunReye binary — `bun run compile` and both
// Dockerfiles build this file, and nothing imports it. Each `bun build --compile`
// output embeds the full bun runtime (~75 MB), so one executable is both
// halves rather than two images' worth: `migrate` runs the schema runner,
// `export` / `import` move the portable archive, and anything else boots the
// server (including its `--healthcheck` self-probe path). That is also what makes
// the schema unable to drift from the code querying it — there is one artifact to
// tag, and the archive format cannot drift from the code that reads it either.
// Dynamic imports keep every non-server path from booting server modules.

/**
 * Run one non-server subcommand, or `null` when the argv names none.
 *
 * The ROUTING DECISION itself lives in `./archive-cli.ts` (`routeSubcommand`), so
 * it is testable — this file is the one nothing imports, and a decision that only
 * exists inside an entrypoint is a decision nothing can prove.
 *
 * Dynamic imports throughout: a box being exported is often a box that cannot
 * start, so no subcommand may boot the server, the runtime, or MQTT.
 */
async function subcommand(): Promise<number | null> {
  const { routeSubcommand, runArchiveCommand } = await import("./archive-cli");
  const route = routeSubcommand(process.argv);
  if (route === null) return null;
  const { env } = await import("@SunReye/env/server");
  return runArchiveCommand(route, process.argv.slice(2), env.DATABASE_URL);
}

const handled = await subcommand();
if (handled !== null) {
  process.exit(handled);
} else if (process.argv.includes("migrate")) {
  const { runMigrations } = await import("@SunReye/db/migrate");
  const { env } = await import("@SunReye/env/server");
  try {
    await runMigrations(env.DATABASE_URL);
  } catch (error) {
    console.error("Migration failed — the server will not start:", error);
    process.exit(1);
  }
  process.exit(0);
} else {
  await import("./index");
}

// Only dynamic imports above (the migrate / export / import paths must not boot
// server modules);
// this keeps the file a module so top-level await is legal.
export {};
