-- Identify-probe variants (ADR 5): a device stores its family's profile id and the variant's id,
-- NULL for the base. The per-model Deye profiles became variants of their family: their devices
-- move through this fixed table, with no aliases kept, and their history, keyed by device id,
-- stays. Fetched copies and waiting updates of the retired ids go; changed-setting marks follow
-- their family.
ALTER TABLE device ADD COLUMN variant TEXT;

CREATE TEMP TABLE retired (old TEXT PRIMARY KEY, family TEXT NOT NULL, variant TEXT NOT NULL);
INSERT INTO retired (old, family, variant) VALUES
    ('deye-sun5k-sg05lp3', 'deye-sg05lp3', '5k'),
    ('deye-sun6k-sg05lp3', 'deye-sg05lp3', '6k'),
    ('deye-sun8k-sg05lp3', 'deye-sg05lp3', '8k'),
    ('deye-sun10k-sg05lp3', 'deye-sg05lp3', '10k'),
    ('deye-sun12k-sg05lp3', 'deye-sg05lp3', '12k'),
    ('deye-sun14k-sg05lp3', 'deye-sg05lp3', '14k'),
    ('deye-sun15k-sg05lp3', 'deye-sg05lp3', '15k'),
    ('deye-sun16k-sg05lp3', 'deye-sg05lp3', '16k'),
    ('deye-sun18k-sg05lp3', 'deye-sg05lp3', '18k'),
    ('deye-sun20k-sg05lp3', 'deye-sg05lp3', '20k'),
    ('deye-sg01hp3-5k', 'deye-sg01hp3', '5k'),
    ('deye-sg01hp3-6k', 'deye-sg01hp3', '6k'),
    ('deye-sg01hp3-8k', 'deye-sg01hp3', '8k'),
    ('deye-sg01hp3-10k', 'deye-sg01hp3', '10k'),
    ('deye-sg01hp3-12k', 'deye-sg01hp3', '12k'),
    ('deye-sg01hp3-15k', 'deye-sg01hp3', '15k'),
    ('deye-sg01hp3-20k', 'deye-sg01hp3', '20k'),
    ('deye-sg01hp3-25k', 'deye-sg01hp3', '25k');

UPDATE device SET profile = retired.family, variant = retired.variant
FROM retired WHERE device.profile = retired.old;

INSERT OR IGNORE INTO profile_setting_changed (profile, setting)
SELECT retired.family, profile_setting_changed.setting
FROM profile_setting_changed JOIN retired ON profile_setting_changed.profile = retired.old;
DELETE FROM profile_setting_changed WHERE profile IN (SELECT old FROM retired);
DELETE FROM fetched_profile WHERE id IN (SELECT old FROM retired);
DELETE FROM profile_update WHERE id IN (SELECT old FROM retired);

DROP TABLE retired;
