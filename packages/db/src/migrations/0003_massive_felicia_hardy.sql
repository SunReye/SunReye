CREATE TABLE "spot_prices" (
	"zone" text NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_minutes" integer NOT NULL,
	"eur_per_mwh" double precision NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_prices_zone_slot_start_pk" PRIMARY KEY("zone","slot_start")
);
