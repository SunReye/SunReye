-- Each MPPT input's last 30 days measured against the model (ADR 20), owned by the correction
-- module: stored when the learner runs and when the layout changes, as one read must not run the
-- model (ADR 24). An input without an hour both modelled and measured has no row.
CREATE TABLE correction_recent (
  device INTEGER NOT NULL,
  input INTEGER NOT NULL,
  measured REAL NOT NULL,
  modelled REAL NOT NULL,
  PRIMARY KEY (device, input)
) STRICT, WITHOUT ROWID;
