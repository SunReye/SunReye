CREATE TABLE "replay_progress" (
	"source" text NOT NULL,
	"device_id" smallint NOT NULL,
	"chunk_start" timestamp with time zone NOT NULL,
	"chunk_end" timestamp with time zone NOT NULL,
	"tier" text NOT NULL,
	"series_rows" bigint NOT NULL,
	"config_rows" bigint NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_progress_source_device_id_chunk_start_pk" PRIMARY KEY("source","device_id","chunk_start")
);
--> statement-breakpoint
ALTER TABLE "replay_progress" ADD CONSTRAINT "replay_progress_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;