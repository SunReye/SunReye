CREATE TABLE "forecast_correction_cells" (
	"inverter_id" text NOT NULL,
	"month" integer NOT NULL,
	"hour" integer NOT NULL,
	"ratio" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_correction_cells_inverter_id_month_hour_pk" PRIMARY KEY("inverter_id","month","hour")
);
--> statement-breakpoint
CREATE TABLE "forecast_correction_state" (
	"inverter_id" text PRIMARY KEY NOT NULL,
	"learned_through" text,
	"mae_raw" double precision DEFAULT 0 NOT NULL,
	"mae_corrected" double precision DEFAULT 0 NOT NULL,
	"samples" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
