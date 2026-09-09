ALTER TABLE "devices" ADD COLUMN "arrays" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "temp_coefficient" double precision DEFAULT -0.4 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "system_loss" double precision DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_temp_coefficient_check" CHECK ("devices"."temp_coefficient" <= 0);--> statement-breakpoint
-- Hand-written data move (drizzle-kit generates only DDL): the plant-wide PV
-- description each plant carried until now becomes the description of its
-- FIRST in-service inverter — the same "lowest-id inverter" rule the 2.0.0
-- provisioner and the archive import use to name the device that reports the
-- plant. A plant with no inverter keeps its legacy columns and nothing moves.
UPDATE "devices" d
SET "arrays" = p."arrays",
    "temp_coefficient" = p."temp_coefficient",
    "system_loss" = p."system_loss"
FROM "plants" p
WHERE d."plant_id" = p."id"
  AND d."role" = 'inverter'
  AND d."retired_at" IS NULL
  AND d."id" = (
    SELECT min(x."id") FROM "devices" x
    WHERE x."plant_id" = p."id" AND x."role" = 'inverter' AND x."retired_at" IS NULL
  );
