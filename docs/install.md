# Install SunReye 5

Three ways: a static binary under systemd, a Docker image, or a Home Assistant add-on. Each serves the SPA and API on port 8099 over plain HTTP; put a reverse proxy in front for TLS.

Moving from SunReye 3? Install v5 beside it, then follow [move-from-v3.md](move-from-v3.md).

## Release status

No release is published yet. The first one waits for the release key ceremony. Until then there are no downloads, no images on `ghcr.io` and no add-on in the store; build from a checkout as shown below.

A release will publish:

- `sunreye-<version>-linux-amd64` and `sunreye-<version>-linux-arm64`, static binaries
- `sunreye.service`, the systemd unit
- `ghcr.io/sunreye/sunreye-v5:<version>` and `:latest`, for amd64 and arm64
- the add-on `sunreye_v5` in the add-on repository `https://github.com/SunReye/SunReye`
- `SHA256SUMS` and `SHA256SUMS.sig`, its Ed25519 signature by the release key `release.pub`

Verify downloaded files before installing:

```sh
openssl pkeyutl -verify -pubin -inkey release.pub -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig
sha256sum -c --ignore-missing SHA256SUMS
```

## Build from a checkout

Needs Bun, Docker with Buildx and the Rust toolchain `rust-toolchain.toml` pins (the SPA build compiles WASM). From the repository root:

```sh
bun install
bun run --cwd apps/web build
```

The core embeds that SPA build, so run it before every image or binary build below.

## Binary and systemd

Build the static binary (add `--platform linux/arm64` for arm64; no emulation needed):

```sh
docker buildx build -f packaging/Dockerfile --target binary --output type=local,dest=out .
```

Install it with the unit. systemd creates `/var/lib/sunreye` as the data directory and runs the core as a dynamic user in group `dialout`:

```sh
sudo install -m 755 out/sunreye /usr/local/bin/sunreye
sudo install -m 644 packaging/sunreye.service /etc/systemd/system/sunreye.service
sudo systemctl daemon-reload
sudo systemctl enable --now sunreye
journalctl -u sunreye -f
```

Open `http://<host>:8099` and set the admin password.

To listen elsewhere, run `sudo systemctl edit sunreye` and add:

```ini
[Service]
Environment=SUNREYE_LISTEN=127.0.0.1:8099
```

## Docker

Build the image:

```sh
docker build -f packaging/Dockerfile --target core -t sunreye-v5 .
```

Run it with a volume for `/data`, the image's data directory:

```sh
docker run -d --name sunreye --restart unless-stopped -p 8099:8099 -v sunreye-data:/data sunreye-v5
docker logs -f sunreye
```

Open `http://<host>:8099` and set the admin password.

## Home Assistant add-on

Pending the first release: Supervisor offers only a version whose image is published.

1. In Home Assistant, go to Settings, Add-ons, Add-on store, and add the repository `https://github.com/SunReye/SunReye` (SunReye 3 users have it already).
2. Install **SunReye 5**. It installs beside SunReye 3's add-on and does not replace it.
3. Start it and open **SunReye 5** in the sidebar.

The add-on runs under ingress: Home Assistant's login stands in for the core's, so there is no password to set, and no port is exposed. It maps `/share` read-only for the import from v3.

Ingress was checked against an nginx stand-in for Supervisor, not yet on a real Supervisor, and the arm64 image has not yet run on arm64 hardware.

## Startup options

Every other setting lives in the core's database and changes in the SPA.

| Flag | Variable | Default |
| --- | --- | --- |
| `--data-dir` | `SUNREYE_DATA_DIR` | none; the unit and images set it |
| `--listen` | `SUNREYE_LISTEN` | `0.0.0.0:8099` |
| `--ingress` | `SUNREYE_INGRESS` | unset; only the add-on image sets it |

`--ingress` names the Supervisor's address, whose ingress requests act as admin. Never set it outside the add-on.

```sh
sunreye --data-dir /var/lib/sunreye --listen 127.0.0.1:8099
```
