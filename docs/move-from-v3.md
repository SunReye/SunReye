# Move from SunReye 3

Run v5 beside v3, import v3's history, compare, then remove v3. v5 cannot read v3's database, and updating v3 in place would leave one neither can export, so v5 is a separate install: on Home Assistant a separate add-on, `sunreye_v5`.

v3's configuration does not move: set up v5's devices yourself. Only history moves.

## 1. Install v5 and add your devices

Install v5 beside v3 ([install.md](install.md)) and add every device in its first-run setup. Each v3 device's history is imported into a v5 device, so that device must exist first. v5 records from then on; v3 keeps running.

## 2. Export from v3

In v3, open Settings, Danger zone, and choose **Download export**. Or, where v3 runs, `sunreye export --out <file>` (v3's command, not v5's); on the v3 add-on, `--out /share/<file>.tar.gz` puts it where v5's add-on can read it.

The export is a `.tar.gz` archive, format version 1.

## 3. Import into v5

### In the SPA

As admin, open Settings, **Import from SunReye 3**:

1. Choose the archive: one under `/share` (add-on only), or upload it. An upload may be at most 1 GiB; put a larger one in `/share`.
2. Map each v3 device to a v5 device, or leave it out.
3. Start the import. v5 keeps recording while it runs.

The result lists the v3 metrics no v5 quantity reads and the devices left out; neither is imported.

### From the command line

For the binary or Docker. Stop the core first. Name each mapping as `--device <v3 slug>=<v5 device id>`: the slug is the v3 device's name in its MQTT topics and API, the id is shown in v5's Settings as Device `<id>`.

Binary:

```sh
sudo systemctl stop sunreye
sudo sunreye import /path/to/export.tar.gz --device deye-1=1 --data-dir /var/lib/private/sunreye
sudo chown -R --reference=/var/lib/private/sunreye /var/lib/private/sunreye
sudo systemctl start sunreye
```

The unit's dynamic user keeps the data in `/var/lib/private/sunreye`; the `chown` hands it back the files root wrote.

Docker, with the archive in the current directory:

```sh
docker stop sunreye
docker run --rm -v sunreye-data:/data -v "$PWD":/import:ro sunreye-v5 import /import/export.tar.gz --device deye-1=1
docker start sunreye
```

### What the import does

- v5's own data wins: for each series only rows before v5's first reading are imported. Importing the same file again changes nothing.
- Raw readings are stored as if v5 had read them. Hourly and daily values fill only spans with no raw readings left; v3's minute values are ignored.
- Imported days follow UTC, as v3's did, so their daily totals cut at UTC midnight.
- Configuration and v3's configuration log are not imported.

## 4. Compare

Check v5's History against v3 for a few days before and after the import started: daily energy, the battery's state of charge, grid import and export. Small differences on imported days come from the UTC day cut.

## 5. Remove v3

Only once v5's history is right: the export is the only copy of v3's history that v5 can read, so keep it. Then uninstall v3 (on Home Assistant, its add-on **SunReye**). v3 gets no further release.
