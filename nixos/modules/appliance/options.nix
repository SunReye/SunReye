# Option declarations for the appliance. Everything tunable lives here so a host
# file is a short list of values, not a pile of copied config.
#
# origin: nixos-sh-appliance@2f444121c544 (HAOS-specific options removed: the
# `appliance.haos.*` VM block and `appliance.backup.*`, which snapshotted that
# VM's disk. What is left is the generic appliance base — boot, hardware,
# watchdog, identity, network, ssh, tailscale, storage, ballast, health,
# updates — which `modules/sunreye` builds on.)
{ config, lib, ... }:
let
  inherit (lib) mkOption mkEnableOption types;
in
{
  options.appliance = {
    enable = mkEnableOption "the headless appliance profile";

    console.password.web = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Also hand the generated password to a browser on the LAN, once, for a
          few minutes after boot.

          The console banner only helps someone standing at the machine with a
          monitor, which is the wrong shape for a box in a cupboard. This is the
          path that works from a laptop on the same network.

          Served behind the same reverse proxy as the dashboard, so it is HTTPS
          and needs no second listener or firewall rule — but on a first boot
          that is the internal CA, so the browser warns. It encrypts against
          passive sniffing on the LAN; it does not authenticate the box.
        '';
      };

      openFor = mkOption {
        type = types.ints.positive;
        default = 15;
        description = ''
          Minutes the window stays open if nobody reads it. It also closes on the
          FIRST successful read, whichever comes first, and never reopens — a
          timed window with unlimited reads leaves nobody able to tell afterwards
          whether someone else looked.

          Counted from when the unit starts, which is early in boot — so the two
          or three minutes the box spends starting its containers come out of
          this budget, and so does the time it takes to find its address. Five
          minutes sounded generous and was not: measured on a real first boot,
          the window had already shut by the time a browser reached it.

          Since a read closes it anyway, the length only ever bounds the case
          where nobody comes. A reboot reopens it as long as the password has
          not been handed out.
        '';
      };

      port = mkOption {
        type = types.port;
        default = 5251;
        description = ''
          Loopback port the window listens on. The proxy publishes it; nothing
          binds this on the LAN.
        '';
      };

      path = mkOption {
        type = types.str;
        default = "/first-boot";
        description = "Path the reverse proxy serves the window at.";
      };
    };

    console.password.file = mkOption {
      type = types.path;
      default = "/var/lib/secrets/console-password";
      readOnly = true;
      internal = true;
      description = "Where the generated console password is kept.";
    };

    console.password.claimFile = mkOption {
      type = types.path;
      default = "/var/lib/secrets/console-claimed";
      readOnly = true;
      internal = true;
      description = ''
        Written once the password has been handed out over the network. Its
        existence is what stops the window reopening on a later boot.
      '';
    };

    console.password.enable = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Generate a random root password on first boot and print it on the console
        login screen.

        A published image can carry no credential — a baked key belongs to
        whoever built the image, and a fixed default password is the same on
        every unit ever flashed. Without this the box has no local login at all:
        root is locked, so a keyboard on the machine reaches a prompt nobody can
        pass, and the only ways in are Tailscale SSH and a key a published image
        does not have.

        Showing it on the login screen is not a leak. The only person who can
        read it is already at the keyboard, which is exactly what the password
        grants — and that person could read the unencrypted disk regardless.
        Console only: sshd refuses password authentication.

        Turn this off for a box built with your own key baked in, where the extra
        credential buys nothing.
      '';
    };

    namePrefix = mkOption {
      type = types.strMatching "[A-Za-z0-9]+";
      default = "SR";
      description = ''
        Hostname prefix. The unit names itself `<prefix>-<identifier>`, where the
        identifier is the DMI product serial when it is trustworthy, and a hash of
        `/etc/machine-id` otherwise. See {file}`identity.nix`.
      '';
    };

    stateVersion = mkOption {
      type = types.str;
      default = "26.05";
      description = "NixOS state version this appliance image was first built from.";
    };

    network = {
      bridge = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "br0";
        description = ''
          Bridge to put the uplink into, carrying the host address. `null` — the
          default — means plain DHCP on {option}`appliance.network.uplink` with no
          bridge at all, which is what an appliance whose workload is a container
          wants: a bridge only earns its keep when something else (a VM's tap
          device) has to share layer 2 with the LAN.

          Set it to a name and the uplink is enslaved to it, and the
          `bridge-nf-call-*` sysctls are asserted so that a later `br_netfilter`
          load (Docker does this) cannot silently start filtering bridged frames.
        '';
      };
      uplink = mkOption {
        type = types.str;
        default = "eth0";
        description = ''
          Physical NIC. Kernel interface naming is disabled (`net.ifnames=0`) so
          this is predictable across SKUs.
        '';
      };
      lanInterface = mkOption {
        type = types.str;
        internal = true;
        readOnly = true;
        description = ''
          The interface that actually holds the site LAN address: the bridge when
          one is configured, the uplink otherwise. Read by {file}`tailscale.nix`
          for route advertisement and the forward rules, so those two do not each
          re-derive it and drift.
        '';
      };
    };

    ssh.authorizedKeys = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "ssh-ed25519 AAAA... ops@example" ];
      description = "Keys accepted for `root` over both LAN SSH and Tailscale SSH.";
    };

    tailscale = {
      enable = mkEnableOption "Tailscale enrolment and remote administration" // { default = true; };

      authKeyFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/var/lib/secrets/tailscale-authkey";
        description = ''
          Path to a file containing a **reusable, pre-authorized, tagged,
          non-ephemeral** auth key.

          This is deliberately a path and not a string: a literal key would land in
          the world-readable Nix store, identical on every unit built from the same
          image. Keys also expire (90 days max), so it must be provisioned at flash
          time rather than baked at build time.

          `null` — the default — is the published-image case: there is no key to
          bake, so the unit enrols interactively instead. See
          {option}`appliance.tailscale.webLogin.enable`.
        '';
      };

      tags = mkOption {
        type = types.listOf (types.strMatching "tag:[a-zA-Z0-9-]+");
        default = [ ];
        example = [ "tag:appliance" ];
        description = ''
          Tags advertised at enrolment. Passed explicitly rather than relying on the
          auth key's own tags — `autoApprovers` silently does nothing if the tag is
          absent, and a key created out-of-band months ago is not a safe assumption.

          Empty by default, and empty is right for an interactive enrolment: a
          user-owned node cannot advertise tags (tagging transfers ownership to the
          tailnet, which is a fleet operation), so `--advertise-tags` is omitted
          entirely rather than passed empty.
        '';
      };

      webLogin = {
        enable = mkOption {
          type = types.bool;
          default = config.appliance.tailscale.authKeyFile == null;
          defaultText = lib.literalExpression "appliance.tailscale.authKeyFile == null";
          description = ''
            Serve `tailscale web` on the LAN so whoever plugs the box in can log it
            into their own tailnet from a browser, with no key baked into the image
            and no console.

            The unit is deliberately self-limiting in three directions: it refuses
            to start once the backend reports `Running`, a timer stops it as soon
            as login succeeds, and {option}`openFor` closes it even if nobody
            ever enrols. Nothing reopens the window automatically — re-enrolment is
            `sunreye tailscale reset` as root, over Tailscale SSH or the
            console. A published image therefore grants its builder nothing: no key,
            no account, no `authorized_keys` entry.
          '';
        };

        openFor = mkOption {
          type = types.ints.positive;
          default = 30;
          description = ''
            Minutes the login window stays open on a box nobody has enrolled,
            counted from the moment it opens.

            Without a deadline it stays open forever: the unit only closes on the
            transition to `Running`, so a box that is powered on and never
            adopted serves an enrolment page to its LAN indefinitely — and
            anyone who reaches it can enrol the box into THEIR tailnet and own
            the dashboard. Measured on a real unit, that window stood open for
            hours.

            A reboot reopens it, so a missed window costs a power cycle rather
            than a re-flash. Lower this if the box lives on a network you share
            with people you do not; the useful floor is however long it takes you
            to find the box's address and click through the login.
          '';
        };

        port = mkOption {
          type = types.port;
          default = 5252;
          description = "Port `tailscale web` listens on while the login window is open.";
        };
      };

      lan = {
        mode = mkOption {
          type = types.enum [ "none" "direct" "via" "both" ];
          default = "none";
          description = ''
            How much of the site LAN this appliance makes reachable over the tailnet.
            This is what lets you SSH the site's other devices — the inverter's
            Modbus gateway, a heat pump, the router — not just the appliance.

            - `none` — advertise nothing. Smallest blast radius.

            - `direct` — advertise the LAN prefix as-is (`192.168.1.0/24`). You reach
              `192.168.1.50` by its real address. Correct for one site; see the
              warning {file}`tailscale.nix` emits.

            - `via` — advertise only the 4via6 encoding. Each site's `192.168.1.0/24`
              becomes a distinct IPv6 prefix derived from `siteId`, so overlapping
              LANs coexist. Addresses are uglier: `tailscale debug via <id> <ip>`.

            - `both` — advertise the raw prefix *and* the 4via6 encoding. The
              migration path: convenient direct addressing now, and this site's
              4via6 address already works, so a second site costs nothing you have
              already learned.
          '';
        };

        siteId = mkOption {
          type = types.nullOr (types.ints.between 1 65535);
          default = null;
          example = 1;
          description = ''
            Unique per-site integer for 4via6 encoding. Required by `via` and `both`.
            Assign these from a list you keep; reusing one silently recreates the
            collision 4via6 exists to prevent.
          '';
        };

        extraRoutes = mkOption {
          type = types.listOf types.str;
          default = [ ];
          example = [ "192.168.30.0/24" ];
          description = ''
            Additional prefixes to advertise beyond the LAN interface's own subnet —
            a separate IoT or guest VLAN, say. Advertised verbatim in `direct` mode
            and 4via6-encoded in `via`/`both`, exactly like the main prefix.
          '';
        };
      };

      acceptRoutes = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Accept subnet routes advertised by other tailnet nodes. Almost never right
          on a subnet router: the appliance would import another site's
          192.168.1.0/24 and start tunnelling its own LAN traffic.
        '';
      };
    };

    watchdog = {
      enable = mkEnableOption "the hardware watchdog" // { default = true; };
      runtimeTime = mkOption {
        type = types.str;
        default = "30s";
        description = "How long PID 1 may be unresponsive before the SoC resets.";
      };
      rebootTime = mkOption {
        type = types.str;
        default = "10m";
        description = "How long a shutdown may hang before the watchdog forces a reset.";
      };
      requireDevice = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Log loudly at boot when no `/dev/watchdog*` device is present. Many
          N-series BIOSes hide the TCO watchdog; without this check a unit ships
          believing it is protected when it is not.
        '';
      };
    };

    ballast = mkOption {
      type = types.str;
      default = "2G";
      example = "0";
      description = ''
        Size of a preallocated reserve file at {file}`/var/lib/appliance/ballast`,
        deletable to buy breathing room when the disk is full. Set to "0" to disable.

        This exists because a headless box with a 100%-full root is very hard to
        recover remotely: you cannot write a file, nix cannot GC, the journal stops,
        and `nixos-rebuild` needs space it does not have. Deleting the ballast
        (`appliance-ballast release`) instantly returns this much space — enough to
        run a GC and fix the underlying cause over SSH.

        `fallocate` makes it free to create: extents are reserved without writing,
        so there is no flash wear cost.

        It replaces an earlier attempt at an ext4 project quota, abandoned after a
        boot test left the kernel unable to mount the root filesystem at all. A
        reserve file cannot make a machine unbootable. See {file}`ballast.nix`.
      '';
    };

    health = {
      # The built report, exposed so `checks.health-report` can RUN it without
      # booting anything. It is a shell script that only ever executed on a box,
      # which is how `uptime -p` reached an image: coreutils ships its own
      # `uptime`, it sits ahead of procps in the wrapper's PATH, and it rejects
      # the flag.
      package = mkOption {
        type = types.package;
        readOnly = true;
        internal = true;
        description = "The appliance-health-report program this module builds.";
      };

      bannerHeader = mkOption {
        type = types.lines;
        default = "";
        description = ''
          Printed above the report when {option}`appliance.health.loginBanner`
          shows it. Empty by default.

          Named by the layer that owns the product rather than written here:
          this module is the generic appliance base and has no business knowing
          what the box is called or what its logo looks like.
        '';
      };

      loginBanner = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Print the health report when someone opens an interactive shell.

          A Tailscale SSH session otherwise lands on a bare prompt on a machine
          nobody has touched in months — no version, no inverter, no sign that
          anything is wrong. Interactive login shells only, and once per
          session, so `ssh box 'cmd'` is not a status report with the output
          buried in it.
        '';
      };

      publicTlsPort = mkOption {
        type = types.nullOr types.port;
        default = null;
        example = 443;
        description = ''
          Port that is supposed to serve a PUBLICLY-TRUSTED certificate for this
          box's tailnet name. Null means nothing here claims to.

          Named by the layer that owns the proxy, rather than derived here, for
          the same reason as {option}`appliance.health.watchUnits`: this module
          knows nothing about what the box runs.

          The failure it exists for is silent and costs an hour to find.
          Tailscale issues certificates only when HTTPS Certificates are enabled
          for the tailnet — off by default — and when they are not, the proxy
          falls back to its internal CA exactly as designed. The owner sees a
          browser warning on a URL that is supposed to be clean, with nothing
          anywhere saying the cause is one toggle in an admin console.
        '';
      };

      webhook = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/var/lib/secrets/health-webhook-url";
        description = ''
          Path to a file containing a URL to POST the health report to on failure and
          once a day. A path, not a URL, because it usually embeds a token.

          Without this, the only signal a unit is sick is noticing it went offline in
          the Tailscale console — which does not distinguish "someone unplugged it"
          from "the database has been crash-looping for a week". At a relative's
          house nobody is going to tell you.

          Works with ntfy.sh, healthchecks.io, a Slack/Discord webhook, or anything
          that accepts a POST body.
        '';
      };

      watchUnits = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "podman-sunreye-server" ];
        description = ''
          Units whose failure should pull in a health report, and whose state the
          report lists. Each gets `onFailure = [ "appliance-failure@<unit>.service" ]`.

          This replaces the base's hardcoded knowledge of one workload unit: the
          layer that owns the workload names it, and the health module stays generic.
        '';
      };
    };

    autoUpgrade = {
      enable = mkEnableOption "unattended host updates from a pinned flake";
      flake = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "/etc/nixos";
        description = ''
          Flake ref to upgrade from. A path on the box is the appliance case: the
          unit owns its own `/etc/nixos` with one pinned input, so an update is
          "bump that input", not "track someone's branch tip".
        '';
      };
      flags = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "--update-input" "sunreye" ];
        description = ''
          Extra flags for the upgrade's `nixos-rebuild`. With a local flake this is
          where the input bump goes; without one there is nothing to update and the
          timer rebuilds the same closure nightly.
        '';
      };
      dates = mkOption {
        type = types.str;
        default = "04:20";
        description = "When to check. Randomised delay is applied on top.";
      };
    };
  };

  # The one definition of the read-only helper: bridge when there is one, uplink
  # otherwise. Kept here next to the option so the two cannot drift.
  config.appliance.network.lanInterface =
    let net = config.appliance.network; in
    if net.bridge != null then net.bridge else net.uplink;
}
