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

  cases = [
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
    ${lib.concatMapStringsSep "\n" (c: "echo 'refused: ${c.name}'") cases}
    touch $out
  ''
  else throw ''
    These configurations were not refused as expected:
    ${lib.concatMapStringsSep "\n" (c: "  • ${c.name}: ${c.detail}") broken}
  ''
)
