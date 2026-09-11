# SunReye as an appliance workload: two podman containers, a reverse proxy in
# front of them, and the options that a `sunreye-setup` command has to be able to
# express.
#
# The shape mirrors docker/docker-compose.yml deliberately — same images, same
# postgres flags, same one-shot migrate step from the server's own image — because
# that is the deployment surface the rest of the repo's gates already cover. What
# is different is everything an appliance needs and compose does not: the
# database lives on the bare root filesystem rather than under a qcow2 or a
# docker volume, the origin list is computed at start from the node's actual
# Tailscale name, and the secrets are generated on the box instead of being typed
# into a .env.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.sunreye;
  images = import ./images.nix { inherit pkgs lib; version = cfg.imageTag; };

  stateDir = "/var/lib/sunreye";
  secretsEnv = "${stateDir}/secrets.env";
  originsEnv = "/run/sunreye/origins.env";

  wantsTailscaleTls = cfg.tls == "tailscale" || cfg.tls == "both";
  wantsInternalTls = cfg.tls == "internal" || cfg.tls == "both";

  inherit (lib) mkOption mkEnableOption types;
in
{
  imports = [
    ./seed.nix
    ./backup.nix
    ./setup-cli.nix
  ];

  options.appliance.sunreye = {
    enable = mkEnableOption "the SunReye energy dashboard workload" // { default = true; };

    imageTag = mkOption {
      type = types.str;
      default = (lib.importJSON ../../version.json).version;
      defaultText = lib.literalExpression ''(lib.importJSON ../../version.json).version'';
      description = ''
        Tag of `ghcr.io/sunreye/sunreye-server` this appliance runs.

        Defaults to {file}`nixos/version.json`, which the release workflow only
        advances AFTER the images for that version exist in GHCR — the same
        "images first, then advertise" rule the Home Assistant addon follows. A
        box that tracks the `stable` branch therefore never sees a version whose
        image is missing.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 3000;
      description = ''
        Port the server container publishes — on 127.0.0.1 only. The front door is
        Caddy on 80/443; nothing outside the box talks to this directly, because a
        second, unencrypted door that also serves the dashboard is a way to lose
        the secure-context guarantees the cookies are set under.
      '';
    };

    timeZone = mkOption {
      type = types.str;
      # "UTC", not `config.time.timeZone`. Reading it here is circular — this
      # module DEFINES time.timeZone from this option below — and the recursion
      # only shows up in a configuration that sets neither, which is exactly the
      # default path. Setting this option sets the system zone; setting
      # time.timeZone directly wins over it.
      default = "UTC";
      description = ''
        The site's IANA zone, passed to the server as `TZ`.

        Every day, month and tariff-band boundary is cut in the server's local
        clock, so a container left on UTC bills a German evening peak to the
        following day and opens "this month" two hours into the last one.
      '';
    };

    inverter = {
      host = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "192.168.1.100";
        description = "Address of the inverter's Modbus TCP endpoint or gateway.";
      };
      port = mkOption {
        type = types.port;
        default = 502;
        description = "Modbus TCP port.";
      };
      unitId = mkOption {
        type = types.ints.between 0 247;
        default = 1;
        description = "Modbus unit id (slave address) of the inverter.";
      };
      transport = mkOption {
        type = types.enum [ "tcp" "rtu-over-tcp" ];
        default = "tcp";
        description = ''
          `tcp` for a native Modbus-TCP inverter or a protocol-converting gateway;
          `rtu-over-tcp` for the common RS485-to-Ethernet gateways that forward raw
          RTU frames.
        '';
      };
      profile = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "deye-sg05lp3";
        description = ''
          Inverter profile to seed the configuration with. Only read until the
          configuration exists in the database; unset means the first installed
          profile.
        '';
      };
      simulate = mkOption {
        type = types.bool;
        default = cfg.inverter.host == null;
        defaultText = lib.literalExpression "appliance.sunreye.inverter.host == null";
        description = ''
          Run against a fake inverter. Defaults to "yes, when no host is
          configured", so a freshly flashed box with nothing set up still comes up
          with a working dashboard — which is what makes the first boot
          self-explanatory instead of an empty page with no readings and no clue
          why.
        '';
      };
    };

    mqtt = {
      enable = mkEnableOption "the MQTT bridge";
      brokerUrl = mkOption {
        type = types.str;
        default = "mqtt://127.0.0.1:1883";
        description = "Broker to publish readings to.";
      };
      topicPrefix = mkOption {
        type = types.str;
        default = "sunreye";
        description = "Topic prefix for published readings.";
      };
      haDiscovery = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Publish Home Assistant MQTT discovery messages, so a Home Assistant on
          this box (see {file}`local.nix`) or elsewhere on the LAN picks the
          inverter up with no YAML. Requires the bridge.
        '';
      };
    };

    tls = mkOption {
      type = types.enum [ "tailscale" "internal" "both" ];
      default = "both";
      description = ''
        How the dashboard is served over HTTPS. A secure context is not cosmetic
        here: installing the dashboard as a PWA — the thing that makes it a phone
        app rather than a bookmark — requires one, and so do the `Secure` cookies
        the session is set with.

        - `tailscale` — a real, publicly-trusted certificate for the node's
          `*.ts.net` name, fetched by Caddy through `tailscale cert` (which is why
          {option}`services.tailscale.permitCertUid` is set to `caddy`). No CA to
          install, works on a phone that has never seen this network.

        - `internal` — Caddy's own CA for the LAN name. Every browser warns until
          someone installs the root, which nobody does; useful only when there is
          no tailnet at all.

        - `both` — the default: the `ts.net` vhost for anyone on the tailnet, the
          LAN vhost for anyone standing in the house. A box whose Tailscale
          enrolment has not happened yet still serves the dashboard.
      '';
    };

    backup = {
      enable = mkEnableOption "weekly pg_dump snapshots" // { default = true; };
      keep = mkOption {
        type = types.ints.positive;
        default = 4;
        description = ''
          Snapshots to retain under {file}`/var/lib/sunreye/backups`. A custom-format
          `pg_dump` of a compressed hypertable is a small fraction of the datadir,
          so four is cheap — but it is not free, and the disk guard and the ballast
          reserve are both sized assuming this exists and is bounded.
        '';
      };
    };
  };

  config = lib.mkIf (config.appliance.enable && cfg.enable) {
    assertions = [
      {
        assertion = cfg.inverter.host != null || cfg.inverter.simulate;
        message = ''
          appliance.sunreye.inverter.host is unset and
          appliance.sunreye.inverter.simulate is false, so this box would poll
          nothing and record nothing — a dashboard with no data and no error to
          explain it. Set the inverter's address (`sunreye-setup inverter <ip>`),
          or leave simulate on.
        '';
      }
      {
        assertion = !cfg.mqtt.haDiscovery || cfg.mqtt.enable;
        message = ''
          appliance.sunreye.mqtt.haDiscovery is on but
          appliance.sunreye.mqtt.enable is off. Discovery messages are published
          over MQTT — there is no other transport — so this combination silently
          publishes nothing.
        '';
      }
      {
        assertion = !wantsTailscaleTls || config.appliance.tailscale.enable;
        message = ''
          appliance.sunreye.tls = "${cfg.tls}" needs a certificate for this node's
          ts.net name, which only Tailscale can issue, but
          appliance.tailscale.enable is false. Use tls = "internal".
        '';
      }
    ];

    time.timeZone = lib.mkDefault cfg.timeZone;

    # Both containers, and the unit that fails when the database is unhealthy, are
    # what a remote health report has to cover: "the box is up" and "the dashboard
    # works" are different facts, and only the second one matters to the household.
    appliance.health.watchUnits = [
      "podman-sunreye-postgres"
      "podman-sunreye-server"
      "sunreye-migrate"
    ];

    virtualisation.podman = {
      enable = true;
      # No docker socket, no dockerCompat: nothing on this box speaks the docker
      # API, and a socket that answers is a privilege-escalation surface.
      autoPrune = {
        enable = true;
        dates = "weekly";
      };
    };

    virtualisation.oci-containers.backend = "podman";

    virtualisation.oci-containers.containers = {
      sunreye-postgres = {
        imageFile = images.timescaledb;
        image = images.databaseImage;
        # Loopback only. The database is an implementation detail of this box; the
        # only reason to publish it at all is that the other two containers reach
        # it over TCP rather than a shared socket.
        ports = [ "127.0.0.1:5432:5432" ];
        volumes = [ "${stateDir}/postgres:/var/lib/postgresql" ];
        environmentFiles = [ secretsEnv ];
        environment = {
          POSTGRES_DB = "SunReye";
          POSTGRES_USER = "postgres";
        };
        # SSD-endurance tuning, identical to the compose deployments and the
        # addon's generated conf — `scripts/storage-tuning.ts` asserts they agree.
        # synchronous_commit=off group-commits WAL (bounded <~0.5s crash-loss
        # window for telemetry — no corruption); wal_compression=zstd shrinks
        # full-page images harder than the pglz `on` default; a 2 h
        # checkpoint_timeout writes each hot page's image ~4x less often.
        # full_page_writes stays ON. Additive `-c` overrides, so timescaledb's own
        # shared_preload_libraries is kept.
        cmd = [
          "postgres"
          "-c"
          "synchronous_commit=off"
          "-c"
          "wal_compression=zstd"
          "-c"
          "max_wal_size=2GB"
          "-c"
          "checkpoint_timeout=2h"
        ];
      };

      sunreye-server = {
        imageFile = images.server;
        image = "ghcr.io/sunreye/sunreye-server:${cfg.imageTag}";
        dependsOn = [ "sunreye-postgres" ];
        ports = [ "127.0.0.1:${toString cfg.port}:3000" ];
        environmentFiles = [ secretsEnv originsEnv ];
        environment = {
          NODE_ENV = "production";
          TZ = cfg.timeZone;
          # Caddy terminates TLS, so the session cookie is only ever set over
          # HTTPS — and saying so is what stops a browser sending it back over the
          # loopback HTTP hop.
          AUTH_SECURE_COOKIES = "true";
          INVERTER_SIMULATE = lib.boolToString cfg.inverter.simulate;
          INVERTER_PORT = toString cfg.inverter.port;
          INVERTER_UNIT_ID = toString cfg.inverter.unitId;
          INVERTER_TRANSPORT = cfg.inverter.transport;
        }
        // lib.optionalAttrs (cfg.inverter.host != null) { INVERTER_HOST = cfg.inverter.host; }
        // lib.optionalAttrs (cfg.inverter.profile != null) { INVERTER_PROFILE = cfg.inverter.profile; }
        // lib.optionalAttrs cfg.mqtt.enable {
          MQTT_ENABLED = "true";
          MQTT_BROKER_URL = cfg.mqtt.brokerUrl;
          MQTT_TOPIC_PREFIX = cfg.mqtt.topicPrefix;
        }
        // lib.optionalAttrs cfg.mqtt.haDiscovery { HA_DISCOVERY_ENABLED = "true"; };
      };
    };

    # DATABASE_URL is deliberately absent from the attrsets above and comes from
    # secrets.env instead. It embeds the generated password, and anything set
    # through `environment` here lands in the unit file in the world-readable Nix
    # store.

    systemd.services = {
      # A datadir is only readable by the pg major that created it. Refuse to
      # start rather than letting postgres scribble an error loop that looks like
      # a crash — the addon does the same thing for the same reason
      # (sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run).
      podman-sunreye-postgres = {
        serviceConfig.ExecStartPre = [
          (pkgs.writeShellScript "sunreye-pg-major-guard" ''
            set -euo pipefail
            version_file=${stateDir}/postgres/PG_VERSION
            [ -e "$version_file" ] || exit 0
            found=$(cat "$version_file")
            if [ "$found" != "17" ]; then
              echo "Data directory is PostgreSQL $found, this appliance ships PostgreSQL 17." >&2
              echo "A migration between PostgreSQL majors needs a dedicated transition" >&2
              echo "release — do not roll the appliance back; check the SunReye release" >&2
              echo "notes for the upgrade path." >&2
              exit 1
            fi
          '')
        ];
      };

      # The schema migrator, run from the server's OWN image: one artifact means
      # the schema can never be a version the code that queries it does not
      # expect. `podman run --rm` under a oneshot unit rather than an
      # oci-containers entry, because oci-containers models long-running services
      # — a Restart=no container that exits 0 is a "failed" service to it, and
      # `dependsOn` cannot express "wait for it to finish".
      sunreye-migrate = {
        description = "Apply SunReye database migrations";
        requires = [ "podman-sunreye-postgres.service" ];
        after = [ "podman-sunreye-postgres.service" ];
        wantedBy = [ "multi-user.target" ];
        path = [ config.virtualisation.podman.package ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          # A first boot initialises the datadir, which takes longer than a
          # `pg_isready` loop's patience would suggest; and a migration over a
          # compressed hypertable is not quick either.
          TimeoutStartSec = "30min";
          Restart = "on-failure";
          RestartSec = "30s";
        };
        unitConfig = {
          StartLimitBurst = 5;
          StartLimitIntervalSec = "30min";
        };
        script = ''
          set -euo pipefail
          for _ in $(seq 1 120); do
            if podman exec sunreye-postgres pg_isready -U postgres -q; then break; fi
            sleep 2
          done
          podman exec sunreye-postgres pg_isready -U postgres

          # SKIP_ENV_VALIDATION: the runner only needs DATABASE_URL, not the full
          # server env schema (auth secret, origins, …) — same as compose.
          exec podman run --rm \
            --network=host \
            --env-file ${secretsEnv} \
            --env SKIP_ENV_VALIDATION=1 \
            "ghcr.io/sunreye/sunreye-server:${cfg.imageTag}" migrate
        '';
      };

      # The origin list cannot be known at build time: it contains this node's
      # MagicDNS name, which only exists after someone enrolled the box into
      # their own tailnet. Computed at start, written to a file under /run, and
      # picked up through environmentFiles.
      sunreye-origins = {
        description = "Compute SunReye's trusted origin list";
        before = [ "podman-sunreye-server.service" ];
        requiredBy = [ "podman-sunreye-server.service" ];
        wantedBy = [ "multi-user.target" ];
        after = [ "tailscaled.service" "appliance-identity.service" ];
        path = with pkgs; [ coreutils jq ] ++ lib.optional config.appliance.tailscale.enable tailscale;
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = ''
          set -euo pipefail
          host=$(cat /run/appliance/hostname 2>/dev/null || hostname)
          origins="https://$host.local,http://$host.local,https://$host,http://localhost:${toString cfg.port}"
          ${lib.optionalString config.appliance.tailscale.enable ''
            # Trailing dot: MagicDNS returns a fully-qualified name and a browser
            # Origin header never carries one, so leaving it in produces an
            # origin that can never match and a login that fails with no
            # explanation.
            ts=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
            if [ -n "$ts" ]; then
              origins="https://$ts,$origins"
            else
              echo "not enrolled in a tailnet yet; serving LAN origins only"
            fi
          ''}
          install -d -m 0755 /run/sunreye
          umask 077
          printf 'TRUSTED_ORIGINS=%s\nBETTER_AUTH_URL=%s\n' \
            "$origins" "$(printf '%s' "$origins" | cut -d, -f1)" > ${originsEnv}
          echo "trusted origins: $origins"
        '';
      };

      # Caddy asks tailscaled for the certificate over its local API, which is
      # gated on uid — so Caddy has to be up after tailscaled, and a restart of
      # tailscaled must not leave Caddy holding a dead socket.
      caddy = lib.mkIf wantsTailscaleTls {
        after = [ "tailscaled.service" ];
        wants = [ "tailscaled.service" ];
      };
    };

    services.caddy = {
      enable = true;
      # The whole reason for a proxy on a single-container box: HTTPS, and
      # therefore a secure context, and therefore a PWA that installs and cookies
      # that are actually Secure. Caddy also keeps port 3000 off the LAN.
      virtualHosts = lib.mkMerge [
        (lib.mkIf wantsTailscaleTls {
          # Matched on the wildcard rather than a literal name, because the name
          # depends on which tailnet the owner enrolled the box into and is not
          # known when this config is built. `get_certificate tailscale` asks
          # tailscaled for a real, publicly-trusted cert for whatever that name
          # turned out to be — no CA for anyone to install, and it works on a
          # phone that has never touched this LAN.
          "https://*.ts.net" = {
            extraConfig = ''
              tls {
                get_certificate tailscale
              }
              reverse_proxy 127.0.0.1:${toString cfg.port}
            '';
          };
        })
        (lib.mkIf wantsInternalTls {
          # The LAN door. Caddy's internal CA means a browser warning until
          # someone installs the root, which nobody does — so this is the
          # fallback for a box with no tailnet, not the main path. It answers on
          # the mDNS name, the short hostname and the raw IP, because on a first
          # boot the owner has whichever of those their router gave them.
          ":443" = {
            extraConfig = ''
              tls internal
              reverse_proxy 127.0.0.1:${toString cfg.port}
            '';
          };
          # Plain HTTP redirects rather than serving: a dashboard reachable over
          # http:// is a dashboard whose Secure cookies silently never arrive.
          ":80" = {
            extraConfig = ''
              redir https://{host}{uri} permanent
            '';
          };
        })
      ];
    };

    # Caddy needs to ask tailscaled for a certificate, which tailscaled only
    # answers for a permitted uid.
    services.tailscale.permitCertUid = lib.mkIf wantsTailscaleTls "caddy";

    # `sunreye.local`, so the first boot has a name to type that does not depend
    # on finding the box's address in a router's lease table.
    services.avahi = {
      enable = true;
      nssmdns4 = true;
      publish = {
        enable = true;
        addresses = true;
        workstation = true;
      };
      extraServiceFiles.sunreye = ''
        <?xml version="1.0" standalone='no'?>
        <!DOCTYPE service-group SYSTEM "avahi-service.dtd">
        <service-group>
          <name replace-wildcards="yes">SunReye on %h</name>
          <service>
            <type>_https._tcp</type>
            <port>443</port>
          </service>
        </service-group>
      '';
    };

    # 80 and 443 only. Not ${toString cfg.port}: the server is reachable through
    # Caddy or not at all, or the TLS the cookies depend on is optional in
    # practice.
    networking.firewall.allowedTCPPorts = [ 80 443 ];

    systemd.tmpfiles.rules = [
      "d ${stateDir} 0750 root root -"
      "d ${stateDir}/postgres 0700 root root -"
      "d /run/sunreye 0750 root root -"
    ];
  };
}
