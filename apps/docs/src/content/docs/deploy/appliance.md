---
title: SunReye Appliance
description: Flash a NixOS image onto a mini PC and run SunReye from two cables.
---

The addon and Docker Compose both need a host someone already runs. The appliance is the
third channel: write one image to a mini PC, plug in Ethernet and power, and the box runs
SunReye against your inverter. No host OS to maintain, no compose file, no Linux knowledge.

It is also remote-administrable by design. The box joins **your** Tailscale network, serves
the dashboard over real HTTPS on a `*.ts.net` name — so it
[installs as an app on a phone](/use/dashboard/#install-on-your-phone) — and can optionally make
the rest of your LAN reachable when you are away.

:::caution[x86 only]
These images are for x86-64 mini PCs. There is no arm64 build, so no Raspberry Pi — use
the [Home Assistant addon](/deploy/home-assistant/) or [Compose](/deploy/docker/) there.
:::

## Hardware

| Part | What to get | Why |
| --- | --- | --- |
| Mini PC | Intel N100 / N150, 8 GB RAM | Four cores is plenty; 8 GB leaves room for Home Assistant later |
| Storage | **NVMe or SATA SSD**, 64 GB+ | Not eMMC, and capacity is about wear headroom, not space — see below |
| Network | **Wired** Ethernet | There is no Wi-Fi setup path in the image, on purpose: a headless box that loses Wi-Fi is a box someone has to visit |
| Inverter link | Modbus TCP, or an RS485→Ethernet gateway | Same requirement as every other deployment — see [Requirements](/deploy/requirements/) |

### How much disk it actually needs

Less than people expect, and the reason is worth knowing: SunReye stores **changes, not
samples**. The number of value changes per day is a property of the signal, not the
sampler — so polling at 1 Hz for control quality costs the same storage as a 30-second
logger, and device count scales the footprint while poll rate does not.

Measured, compressed, per inverter:

| | |
| --- | --- |
| Raw readings (kept **5 years**) | **361 MB/year** → 1.8 GB at full retention |
| Minute rollups (90-day resolution window) | ~85 MB/year, so ~21 MB at steady state |
| Hourly rollups (kept 10 years) | ~4.9 kB/metric/year — tens of MB |
| Daily rollups | kept forever, negligible |

The system itself is the bigger line item: a **3.2 GiB** NixOS closure (both container
images included), another ~0.6 GiB once podman unpacks them, and a 2 GiB
[emergency reserve](#troubleshooting). Call it **~6 GB before a single reading**, ~8 GB
after five years with one inverter, plus a few generations of update history.

So 64 GB is comfortable and 128 GB is generous. Buy the larger part for endurance — more
spare area means less write amplification — not because you will run out of room.

:::caution[This assumes your profile authors deadbands]
Those figures depend on the installed [inverter profile](/profiles/concept/) declaring
per-metric `deadband` values. Without them the analog registers store every bit of sensor
noise and raw runs roughly **5.5× heavier** — about 10 GB per inverter over five years
instead of 1.8. Still fine on a 64 GB disk; not fine on the 32 GB part you might have been
tempted by.
:::

Retention, not disk size, is what bounds your history. It is set by the server's
migrations and is the same on every deployment channel.

## Flash it

Download `sunreye-appliance-X.Y.Z.img.zst` and its `.sha256` from the
[latest release](https://github.com/SunReye/SunReye/releases), then:

```bash
# 1. Verify what you downloaded.
sha256sum -c sunreye-appliance-X.Y.Z.img.zst.sha256

# 2. Find the target disk. Check twice — this erases it.
lsblk -o NAME,SIZE,MODEL

# 3. Write it.
zstd -dc sunreye-appliance-X.Y.Z.img.zst | sudo dd of=/dev/sdX bs=4M status=progress conv=fsync
```

The image grows to fill the disk on first boot, so the size you write does not matter.

:::danger
`dd` does exactly what you tell it. `of=/dev/sda` on the wrong machine erases that machine.
:::

## First boot

Plug the box into your router and power it on. It takes a couple of minutes the first time:
it generates its own secrets, starts a database, applies the schema, and names itself
`sr-<something>` from the machine's serial number.

Then, from any computer on the same network:

1. **Log the box into your Tailscale network.** Open `http://sr-xxxx:5252` (your router's
   device list will show the name), and follow the login page. This is the box asking to
   join *your* tailnet — the published image contains no key, no account and no SSH key
   belonging to anyone else.

   The login page closes itself the moment enrolment succeeds and **never reopens on its
   own**. If you need it back, see [Starting over](#starting-over).

2. **Open the dashboard** at `https://sr-xxxx.<your-tailnet>.ts.net`. That is a real
   certificate — no warning, no CA to install — which is what lets you install it as an app
   on a phone. On the LAN, `https://sunreye.local` also works, with a browser warning.

3. **Create your account.** The first account you register is the administrator.

4. **Point it at your inverter.** Over Tailscale SSH (`ssh root@sr-xxxx`) or a keyboard on
   the box:

   ```bash
   sunreye-setup inverter 192.168.1.100
   sunreye-setup timezone Europe/Berlin
   ```

   Each command rebuilds the box, which takes a minute or two and briefly interrupts the
   dashboard. Until you set an inverter the box runs a **simulated** one, so there is
   always something to look at.

## `sunreye-setup`

Everything an appliance owner needs, without editing any Nix:

```bash
sunreye-setup inverter <host> [--port 502] [--unit 1] [--transport tcp|rtu-over-tcp]
sunreye-setup timezone Europe/Berlin
sunreye-setup simulate on|off
sunreye-setup lan-access on [--site-id N] | off
sunreye-setup ssh-key add <key> | remove <key> | list
sunreye-setup tls tailscale|internal|both
sunreye-setup tailscale reset
sunreye-setup show
sunreye-setup apply
```

`show` prints the current configuration and the tailnet status. Every command that changes
something validates first, writes `/etc/nixos/site.json`, commits it, and rebuilds — so
`git -C /etc/nixos log` is a history of how this box got the way it is, and a bad change is
one `nixos-rebuild switch --rollback` away.

### Time zone matters more than it looks

Every day, month and tariff band is cut in the box's local clock. Left on UTC, a German
evening peak is billed to the following day and "this month" opens two hours into the last
one. Set it once, on the first day.

## Sharing the box with someone else

The common case is a box in a relative's house: they want the dashboard on their phone, you
want to be able to fix it.

Enrol the box into **your** tailnet (step 1 above), then **share the node** to their
Tailscale account from the [Tailscale admin console](https://login.tailscale.com/admin/machines).
Sharing keeps the MagicDNS name and the certificate, so their phone opens the same
`https://sr-xxxx.<your-tailnet>.ts.net` URL and installs the same app — and you keep SSH
and admin.

The other way round works too: let them enrol the box into their own tailnet, and add your
SSH key (`sunreye-setup ssh-key add ...`) for support. Same image, either way.

## Reaching the rest of the LAN

A box on site can also route you to everything else on that network — the inverter's
gateway, a heat pump, the router:

```bash
sunreye-setup lan-access on --site-id 1
```

Then approve the subnet route in the Tailscale console (**Machines → the box → Edit route
settings**) and, while you are there, **disable key expiry** — otherwise the node silently
drops off the tailnet in 90 days.

:::note[Why `--site-id`]
Almost every home LAN is `192.168.1.0/24`. Tailscale does failover, not per-site routing,
for identical prefixes, so a second box advertising the same range makes the first one
unreachable at random. `--site-id` adds a
[4via6](https://tailscale.com/kb/1201/4via6-subnets) address that is unique to this site, so
adding a second box later costs you nothing. Omit it and you get direct addressing only,
which is fine for exactly one site.
:::

## Updates

The box checks nightly (~04:20 local, jittered) for a new SunReye release and stages it into
the next boot. It never reboots itself — a box that reboots unattended is a box that
reboots during someone's evening peak.

```bash
nixos-rebuild switch --flake /etc/nixos     # apply a staged update now
nixos-rebuild switch --rollback             # go back one generation
```

Updates follow the `stable` branch, which only ever advances after **both** the container
images and the flashable image for that version are published. A box can never pull a
configuration whose parts do not exist yet.

Rolling back is also available from the bootloader: the box keeps its last generations and
the boot menu lists them, which is the recovery path when an update leaves it unreachable.

## Adding evcc, Home Assistant, anything else

`/etc/nixos/local.nix` is yours; nothing overwrites it. It ships commented examples for the
three things people actually add:

- **evcc** for EV charging. Note the warning in the file: most RS485→Ethernet gateways accept
  one TCP client at a time, so point evcc at SunReye's API rather than at the gateway.
- **Home Assistant Core** plus **Mosquitto**. SunReye already publishes Home Assistant MQTT
  discovery, so the inverter appears with no YAML.
- Any container at all, via `virtualisation.oci-containers`.

After editing: `sunreye-setup apply`.

:::note
This is Home Assistant *Core*, not Home Assistant OS — no Supervisor, so no add-ons and no
Supervisor backups. If you want the full HAOS experience, run HAOS and use the
[addon](/deploy/home-assistant/) instead.
:::

## Backups

A `pg_dump` runs weekly into `/var/lib/sunreye/backups`, keeping the last two.

**They are not small.** The dump has to include the raw readings — past the minute
tier's 90-day window they are the only second-resolution record there is — and `pg_dump`
writes logical rows, so the ~5 bytes a compressed reading occupies on disk expands to
~227 bytes on the way out before the dump's own compression claws some of it back. A
snapshot is comparable in size to the database itself, not a fraction of it. That is why
the default is two, and why the job refuses to run when free space is below the database
size rather than filling the disk it is supposed to be protecting.

They also live on the same disk as the database, which protects you from very little. Copy
them off if the history matters:

```bash
scp root@sr-xxxx:/var/lib/sunreye/backups/*.dump .
```

:::note[Restore serially]
`pg_restore -j` silently corrupts a TimescaleDB catalog — rows go missing with no error.
Restore without `-j`.
:::

## Health beacon

The box can POST a health report daily, and on any failed service, to a URL of your choice —
[ntfy.sh](https://ntfy.sh), healthchecks.io, a Slack webhook. Without one, the only sign a
box is sick is noticing it went offline, which does not distinguish "unplugged" from "the
database has been crash-looping for a week". Nobody in the house is going to tell you.

```bash
install -d -m 0700 /var/lib/secrets
printf 'https://ntfy.sh/your-secret-topic' > /var/lib/secrets/health-webhook
chmod 600 /var/lib/secrets/health-webhook
# then uncomment appliance.health.webhook in /etc/nixos/local.nix and:
sunreye-setup apply
```

The report includes disk, memory, both containers and their restart counts, the watchdog,
how long the Tailscale key has left, and which routes the tailnet has actually approved
versus what the box is advertising — the last one being how a subnet you forgot to approve
shows up before you need it.

## Starting over

To hand the box to someone else, or re-enrol it into a different tailnet:

```bash
sunreye-setup tailscale reset
```

It forgets the tailnet and reopens the login page on port 5252. This is the only way that
window reopens — nothing on the box does it automatically, because a box that re-offers its
own enrolment page after a reboot is a box anyone on that network can take.

To wipe it completely, flash the image again.

## Troubleshooting

**No name on the network.** The box is `sr-` plus its serial number. Check your router's
lease list, or plug in a monitor — the console shows the hostname and any failed service.

**Dashboard does not load.** `systemctl status podman-sunreye-server podman-sunreye-postgres`
and `journalctl -u sunreye-migrate`. On a first boot the database initialises before the
migrations run, which takes a few minutes.

**No readings.** `sunreye-setup show` — if `simulate` is `true` the box is not talking to
your inverter yet. If it is `false`, check the address and that nothing else is holding the
gateway's single TCP slot.

**Disk filling up.** `appliance-ballast release` instantly frees a 2 GB reserve, which is
enough room to investigate and fix the cause over SSH. Restore it afterwards with
`appliance-ballast restore`.
