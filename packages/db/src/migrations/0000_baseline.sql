CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battery_capacity_estimates" (
	"device_id" smallint NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"soc_start" double precision NOT NULL,
	"soc_end" double precision NOT NULL,
	"energy_kwh" double precision NOT NULL,
	"capacity_kwh" double precision NOT NULL,
	"temp_c" double precision,
	CONSTRAINT "battery_capacity_estimates_device_id_measured_at_pk" PRIMARY KEY("device_id","measured_at")
);
--> statement-breakpoint
CREATE TABLE "custom_charts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_correction_cells" (
	"device_id" smallint NOT NULL,
	"month" integer NOT NULL,
	"hour" integer NOT NULL,
	"ratio" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_correction_cells_device_id_month_hour_pk" PRIMARY KEY("device_id","month","hour")
);
--> statement-breakpoint
CREATE TABLE "forecast_correction_state" (
	"device_id" smallint PRIMARY KEY NOT NULL,
	"learned_through" text,
	"mae_raw" double precision DEFAULT 0 NOT NULL,
	"mae_corrected" double precision DEFAULT 0 NOT NULL,
	"samples" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batteries" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "batteries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"device_id" smallint NOT NULL,
	"usable_kwh" double precision NOT NULL,
	"max_charge_w" double precision,
	"min_soc" double precision DEFAULT 10 NOT NULL,
	"nominal_v" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batteries_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"plant_id" smallint NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 502 NOT NULL,
	"transport" text DEFAULT 'tcp' NOT NULL,
	"timeout_ms" integer DEFAULT 2000 NOT NULL,
	"poll_interval_ms" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"plant_id" smallint NOT NULL,
	"connection_id" smallint,
	"unit_id" smallint NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"profile_id" text NOT NULL,
	"serial" text,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_plant_slug_key" UNIQUE("plant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "metric_keys" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metric_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"is_counter" boolean DEFAULT false NOT NULL,
	CONSTRAINT "metric_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"time_zone" text DEFAULT 'auto' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"label" text DEFAULT '' NOT NULL,
	"arrays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"temp_coefficient" double precision DEFAULT -0.4 NOT NULL,
	"system_loss" double precision DEFAULT 14 NOT NULL,
	"max_output_w" double precision,
	"house_load_w" double precision,
	"smart_meter_since" text,
	"bidding_zone" text,
	"tariff_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "metrics_config_log" (
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"value" double precision NOT NULL,
	"device_id" smallint NOT NULL,
	"metric_id" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics_raw" (
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"value" double precision NOT NULL,
	"dur_ms" integer,
	"device_id" smallint NOT NULL,
	"metric_id" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"version" text NOT NULL,
	"data" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spot_prices" (
	"zone" text NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_minutes" integer NOT NULL,
	"eur_per_mwh" double precision NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_prices_zone_slot_start_pk" PRIMARY KEY("zone","slot_start")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_capacity_estimates" ADD CONSTRAINT "battery_capacity_estimates_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_correction_cells" ADD CONSTRAINT "forecast_correction_cells_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_correction_state" ADD CONSTRAINT "forecast_correction_state_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_config_log" ADD CONSTRAINT "metrics_config_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_config_log" ADD CONSTRAINT "metrics_config_log_metric_id_metric_keys_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metric_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_raw" ADD CONSTRAINT "metrics_raw_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_raw" ADD CONSTRAINT "metrics_raw_metric_id_metric_keys_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metric_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "battery_capacity_estimates_measured_at_idx" ON "battery_capacity_estimates" USING btree ("measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_connection_unit_key" ON "devices" USING btree ("connection_id","unit_id");--> statement-breakpoint
CREATE INDEX "devices_plant_role_idx" ON "devices" USING btree ("plant_id","role");--> statement-breakpoint
CREATE INDEX "metrics_config_log_device_metric_time_idx" ON "metrics_config_log" USING btree ("device_id","metric_id","time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metrics_raw_device_metric_time_idx" ON "metrics_raw" USING btree ("device_id","metric_id","time");--> statement-breakpoint
CREATE INDEX "metrics_raw_time_idx" ON "metrics_raw" USING btree ("time" DESC NULLS LAST);