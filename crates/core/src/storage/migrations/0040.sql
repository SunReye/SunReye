-- A layout version's inverter and battery types by device, copied by value (ADR 27), owned by the
-- layout module: the `pv` schema's JSON, which refuses a member this build does not know. A version
-- without types has no row.
CREATE TABLE layout_types (
  layout INTEGER PRIMARY KEY REFERENCES layout (id),
  types TEXT NOT NULL
) STRICT;
