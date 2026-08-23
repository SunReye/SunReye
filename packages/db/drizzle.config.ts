import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../../apps/server/.env",
});

export default defineConfig({
  // The barrel, not the directory. Pointed at `./src/schema`, drizzle-kit loads
  // every file in it through its own CJS loader — including the colocated
  // `*.test.ts`, which import `bun:test` and fail to resolve, so `db:generate`
  // dies before it reads a single table. The barrel re-exports every schema
  // module and no test.
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  // TimescaleDB continuous aggregates (`*_rollups`) are created out-of-band by
  // src/timescale.sql, not by drizzle. They surface as ordinary public VIEWs in
  // introspection, so without this filter `push`/`pull` would emit
  // `DROP VIEW "…_rollups"` — which TimescaleDB rejects ("cannot drop continuous
  // aggregate using DROP VIEW"), breaking every push. Excluding them leaves the
  // aggregates entirely to timescale.sql.
  tablesFilter: ["!*_rollups"],
});
