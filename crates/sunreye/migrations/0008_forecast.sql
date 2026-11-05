-- The PV forecast's settings, bounded as 3.x's `WeatherConfig` (packages/db/src/weather.ts). One plant row,
-- absent until first saved; the PV description and the forecast battery per inverter, as 3.x migration 0005
-- moved them onto the device.
CREATE TABLE plant_forecast (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  label TEXT NOT NULL CHECK (length(label) <= 120),
  forecast_enabled INTEGER NOT NULL CHECK (forecast_enabled IN (0, 1)),
  provider TEXT NOT NULL,
  max_output_w REAL CHECK (max_output_w > 0 AND max_output_w <= 10000000),
  house_load_w REAL CHECK (house_load_w BETWEEN 0 AND 10000000),
  smart_meter_since TEXT,
  correction_enabled INTEGER NOT NULL CHECK (correction_enabled IN (0, 1))
) STRICT;

-- A null coefficient or loss falls back to the plant's. The battery is all three columns or none.
CREATE TABLE device_pv (
  device_id INTEGER PRIMARY KEY REFERENCES device (id) ON DELETE CASCADE,
  temp_coefficient REAL CHECK (temp_coefficient BETWEEN -2 AND 0),
  system_loss REAL CHECK (system_loss BETWEEN 0 AND 90),
  battery_usable_kwh REAL CHECK (battery_usable_kwh > 0 AND battery_usable_kwh <= 10000),
  battery_max_charge_w REAL CHECK (battery_max_charge_w > 0 AND battery_max_charge_w <= 10000000),
  battery_min_soc REAL CHECK (battery_min_soc BETWEEN 0 AND 100),
  CHECK ((battery_usable_kwh IS NULL) = (battery_min_soc IS NULL)),
  CHECK (battery_max_charge_w IS NULL OR battery_usable_kwh IS NOT NULL)
) STRICT;

-- `mppt` is the `index` of the inverter's `pv.string.*` metrics the array is wired into; one array per string.
CREATE TABLE pv_array (
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
  kwp REAL NOT NULL CHECK (kwp > 0 AND kwp <= 100000),
  tilt REAL NOT NULL CHECK (tilt BETWEEN 0 AND 90),
  azimuth REAL NOT NULL CHECK (azimuth BETWEEN -180 AND 180),
  temp_coefficient REAL CHECK (temp_coefficient BETWEEN -2 AND 0),
  system_loss REAL CHECK (system_loss BETWEEN 0 AND 90),
  mppt INTEGER CHECK (mppt >= 0),
  PRIMARY KEY (device_id, position),
  UNIQUE (device_id, mppt)
) STRICT, WITHOUT ROWID;
