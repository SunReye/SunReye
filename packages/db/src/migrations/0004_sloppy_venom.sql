CREATE TABLE "metrics_config_log" (
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"inverter_id" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX "metrics_config_log_metric_time_idx" ON "metrics_config_log" USING btree ("inverter_id","metric","time" DESC NULLS LAST);