# The refusals, asserted.
#
# `checks.eval` proves a good configuration builds. It cannot prove a BAD one is
# refused — and every assertion in these modules exists because some combination
# of options produces a box that looks configured and does not work: an inverter
# that polls nothing, a subnet route nobody approved, a certificate no issuer can
# sign. Deleting one of those assertions makes `checks.eval` greener, not redder,
# which is exactly the wrong gradient.
#
# So each case here is evaluated with `builtins.tryEval` and must fail with a
# message that names the option. Matching on the message, not just on failure:
# an assertion that fires for the wrong reason is not the one under test.
{ lib, pkgs, mkAppliance }:
let
  # Assertions are collected by the module system and raised when the toplevel is
  # forced, so `tryEval` has to force something deep enough to trigger them.
  # `deepSeq` on the assertion list itself is cheaper than building a toplevel and
  # fails for the same reason.
  evaluate = modules:
    let
      system = mkAppliance { modules = [ { appliance.enable = true; } ] ++ modules; };
      failures = lib.filter (a: !a.assertion) system.config.assertions;
    in
    builtins.tryEval (
      if failures == [ ]
      then throw "expected this configuration to be refused, and it was accepted"
      else lib.concatMapStringsSep "\n" (a: a.message) failures
    );

  # A refusal is correct when it happened AND the message names the option, so
  # whoever hits it knows which setting to change.
  refuses = name: needle: modules:
    let result = evaluate modules; in
    {
      inherit name;
      ok = result.success && lib.hasInfix needle result.value;
      detail = if result.success then result.value else "configuration was accepted";
    };

  # Some settings are refused by the option's *type* rather than by an assertion
  # — a number outside a declared range, say. The module system raises those with
  # `throw`, and `builtins.tryEval` reports that it fired but not what it said,
  # so there is no message left to match on. "It failed" on its own is a weak
  # test: it passes just as happily when the configuration is broken for some
  # reason that has nothing to do with the option under test. So a type refusal
  # is always asserted as a PAIR — the bad value rejected by `rejectsByType`,
  # the neighbouring good value accepted by `accepts`. Together they say the
  # boundary sits exactly where we think it does.
  evaluateStrict = modules:
    let
      system = mkAppliance { modules = [ { appliance.enable = true; } ] ++ modules; };
    in
    builtins.tryEval (
      builtins.deepSeq (map (a: a.assertion) system.config.assertions) "evaluated"
    );

  rejectsByType = name: modules:
    let result = evaluateStrict modules; in
    {
      inherit name;
      ok = !result.success;
      detail = "configuration was accepted";
    };

  # The other half of that pair: this configuration must evaluate AND raise no
  # assertion. Without it, tightening a range until it refuses everything —
  # including the values operators are supposed to type — would read as progress.
  accepts = name: modules:
    let
      system = mkAppliance { modules = [ { appliance.enable = true; } ] ++ modules; };
      result = builtins.tryEval (
        lib.concatMapStringsSep "\n" (a: a.message)
          (lib.filter (a: !a.assertion) system.config.assertions)
      );
    in
    {
      inherit name;
      ok = result.success && result.value == "";
      detail =
        if result.success
        then "refused with: ${result.value}"
        else "configuration did not evaluate at all";
    };

  cases = [
    # A wildcard site address stands for exactly one label, so `*.ts.net` can
    # never match `<host>.<tailnet>.ts.net`. The request does not fail — it
    # matches a different site and is served the wrong certificate, which is why
    # this shipped and enrolled before anyone noticed.
    # nixpkgs only ever runs `tailscale up` from `tailscaled-autoconnect`, which
    # exists only when an auth key is set. On a keyless box these flags are text
    # nothing executes — which is how a published image shipped with Tailscale
    # SSH silently off, and therefore with no way in at all.
    (refuses "up-flags on a box that will never run `tailscale up`" "extraUpFlags" [{
      services.tailscale.extraUpFlags = [ "--ssh" ];
    }])

    (refuses "a Caddy site address no MagicDNS name can ever match" "wildcard" [{
      services.caddy.virtualHosts."https://*.ts.net".extraConfig = "respond 200";
    }])

    (refuses "an inverter that is neither configured nor simulated" "inverter.host" [{
      appliance.sunreye.inverter.simulate = false;
    }])

    (refuses "HA discovery with no MQTT transport to publish it over" "mqtt.enable" [{
      appliance.sunreye.mqtt.haDiscovery = true;
      appliance.sunreye.mqtt.enable = false;
    }])

    (refuses "a ts.net certificate on a box with no tailscale" "tls" [{
      appliance.tailscale.enable = false;
      appliance.sunreye.tls = "tailscale";
      appliance.ssh.authorizedKeys = [ "ssh-ed25519 AAAA ops@example" ];
    }])

    (refuses "4via6 routing with no site id to derive the prefix from" "siteId" [{
      appliance.tailscale.lan.mode = "via";
    }])

    # The serial is only ever put on the wire inside a Solarman v5 envelope, so a
    # box that carries one under `tcp` or `rtu-over-tcp` is a box whose owner
    # typed the number off the sticker, saw the option accepted, and is now
    # waiting for readings from a framing that never sends it.
    (refuses "a logger serial no framing ever puts on the wire" "loggerSerial" [{
      appliance.sunreye.inverter.transport = "tcp";
      appliance.sunreye.inverter.loggerSerial = 1234567890;
    }])

    # 0 is not a serial. It is the DISCOVERY serial on the Solarman v5 wire —
    # the value a request carries while it is still asking the stick who it is —
    # so every schema that consumes this number floors at 1: the server's
    # `INVERTER_LOGGER_SERIAL`, `modbusParamsSchema` and `inverterConfigSchema`
    # all do. This option accepted 0 anyway, and 0 is the obvious "none" to type
    # into a field whose documented range starts there. The result was a clean
    # `nix flake check`, a clean `nixos-rebuild switch`, and then a server that
    # refused to start over an environment variable the operator never set by
    # hand. Leaving the option unset is how you say "none" — that is what makes
    # SunReye discover the serial off the stick.
    (rejectsByType "a logger serial of 0, which is the discovery serial and not a serial" [{
      appliance.sunreye.inverter.transport = "solarman-v5";
      appliance.sunreye.inverter.loggerSerial = 0;
    }])

    (accepts "the lowest logger serial the server will actually boot on" [{
      appliance.sunreye.inverter.transport = "solarman-v5";
      appliance.sunreye.inverter.loggerSerial = 1;
    }])

    (accepts "the highest logger serial the uint32 wire field can carry" [{
      appliance.sunreye.inverter.transport = "solarman-v5";
      appliance.sunreye.inverter.loggerSerial = 4294967295;
    }])

    (rejectsByType "a logger serial one past the uint32 wire field" [{
      appliance.sunreye.inverter.transport = "solarman-v5";
      appliance.sunreye.inverter.loggerSerial = 4294967296;
    }])

    (refuses "a site id that no mode ever reads" "never uses it" [{
      appliance.tailscale.lan.mode = "direct";
      appliance.tailscale.lan.siteId = 3;
    }])

    (refuses "an unattended enrolment with no tag for autoApprovers to match" "tags" [{
      appliance.tailscale.authKeyFile = "/var/lib/secrets/tailscale-authkey";
      appliance.tailscale.tags = [ ];
    }])

    (refuses "no key and no login window: a box that can never enrol" "webLogin" [{
      appliance.tailscale.webLogin.enable = false;
    }])

    (refuses "no tailscale and no SSH key: a headless box with no way in" "authorizedKeys" [{
      appliance.tailscale.enable = false;
      appliance.sunreye.tls = "internal";
    }])

    (refuses "an auto-upgrade with no flake to upgrade from" "autoUpgrade.flake" [{
      appliance.autoUpgrade.enable = true;
      appliance.autoUpgrade.flake = null;
    }])
  ];

  broken = lib.filter (c: !c.ok) cases;
in
pkgs.runCommand "appliance-assertions"
{
  passthru.cases = cases;
} (
  if broken == [ ]
  then ''
    ${lib.concatMapStringsSep "\n" (c: "echo 'checked: ${c.name}'") cases}
    touch $out
  ''
  else throw ''
    These configurations did not behave as expected:
    ${lib.concatMapStringsSep "\n" (c: "  • ${c.name}: ${c.detail}") broken}
  ''
)
