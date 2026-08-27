// Entrypoint for every compiled SunReye binary — `bun run compile` and both
// Dockerfiles build this file, and nothing imports it. Each `bun build --compile`
// output embeds the full bun runtime (~75 MB), so one executable is both
// halves rather than two images' worth: `migrate` runs the schema runner,
// anything else boots the server (including its `--healthcheck` self-probe
// path). That is also what makes the schema unable to drift from the code
// querying it — there is one artifact to tag. Dynamic imports keep the
// migrate-only path from booting server modules.
if (process.argv.includes("migrate")) {
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

// Only dynamic imports above (the migrate path must not boot server modules);
// this keeps the file a module so top-level await is legal.
export {};
