-- One layout version per date it applies from (ADR 17): the newest of each date stays. Pure SQL,
-- since an older scene may no longer read.
DELETE FROM layout_string
WHERE layout NOT IN (SELECT max(id) FROM layout GROUP BY applies_from);

DELETE FROM layout_scene
WHERE layout NOT IN (SELECT max(id) FROM layout GROUP BY applies_from);

DELETE FROM layout
WHERE id NOT IN (SELECT max(id) FROM layout GROUP BY applies_from);

CREATE UNIQUE INDEX layout_applies_from ON layout (applies_from);
