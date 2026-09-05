// fallow-ignore-file unused-file -- compile entry of sunreye/Dockerfile, not imported anywhere
// Entrypoint for the Home Assistant addon's single compiled binary. Each
// `bun build --compile` output embeds the full bun runtime (~90 MB), so the
// addon ships one executable instead of separate server and migrate
// binaries: `sunreye migrate` runs the schema runner, anything else boots
// the server (including its `--healthcheck` self-probe path). Dynamic
// imports keep the migrate-only path from booting server modules.
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
