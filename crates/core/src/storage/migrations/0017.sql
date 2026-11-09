-- A layout version's scene (ADR 20), owned by the layout module: one JSON document in the `pv`
-- crate's scene schema, whose modules name their string by id. Its strings are derived from it.
CREATE TABLE layout_scene (
  layout INTEGER PRIMARY KEY REFERENCES layout (id),
  scene TEXT NOT NULL
) STRICT;
