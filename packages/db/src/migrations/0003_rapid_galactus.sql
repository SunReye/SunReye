ALTER TABLE "forecast_correction_cells" ADD CONSTRAINT "forecast_correction_cells_month_hour_check" CHECK ("forecast_correction_cells"."month" between 1 and 12 and "forecast_correction_cells"."hour" between 0 and 23);--> statement-breakpoint
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_min_soc_check" CHECK ("batteries"."min_soc" between 0 and 100);--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_transport_check" CHECK ("connections"."transport" in ('tcp', 'rtu-over-tcp'));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_role_check" CHECK ("devices"."role" in ('inverter', 'controller', 'meter', 'charger', 'optimizer'));--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_temp_coefficient_check" CHECK ("plants"."temp_coefficient" <= 0);--> statement-breakpoint
ALTER TABLE "spot_prices" ADD CONSTRAINT "spot_prices_slot_minutes_check" CHECK ("spot_prices"."slot_minutes" > 0);