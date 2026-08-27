CREATE TABLE "battery_capacity_estimates" (
	"inverter_id" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"soc_start" double precision NOT NULL,
	"soc_end" double precision NOT NULL,
	"energy_kwh" double precision NOT NULL,
	"capacity_kwh" double precision NOT NULL,
	"temp_c" double precision,
	CONSTRAINT "battery_capacity_estimates_inverter_id_measured_at_pk" PRIMARY KEY("inverter_id","measured_at")
);
--> statement-breakpoint
CREATE INDEX "battery_capacity_estimates_measured_at_idx" ON "battery_capacity_estimates" USING btree ("measured_at");