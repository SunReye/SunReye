# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# One-shot schema migrator.
#
# Runs the journaled migration runner (packages/db/src/migrate.ts) against
# DATABASE_URL, then exits: downgrade guard → baseline stamping for databases
# from the pre-journal `db:push` era → pending drizzle migrations
# (transactional) → journaled TimescaleDB structural files → re-applied
# policies. Non-interactive by construction — unlike the old `db:push`
# entrypoint, nothing can prompt and hang a TTY-less container.
#
# Safe to run on every `docker compose up`: applied migrations are skipped via
# the journal tables, and the server only starts after this exits 0.
#
# Unlike the distroless server image, this needs the bun toolchain and the
# migration SQL files — hence a separate, run-once image.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.4
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

WORKDIR /app/packages/db
ENTRYPOINT ["bun", "run", "db:migrate"]
