# Your configuration. Nothing overwrites this file.
#
# `site.nix` is generated from `site.json` by `sunreye-setup` and will be
# replaced; this one is yours. It is a normal NixOS module, so everything in
# nixpkgs is available — the examples below are the three things people actually
# add to a SunReye box.
#
# After editing: `sunreye-setup apply`.
{ config, lib, pkgs, ... }:

{
  ## ── A second person's SSH key, or a different hostname prefix ──────────────
  # appliance.namePrefix = "SR";

  ## ── Health beacon ──────────────────────────────────────────────────────────
  # A file containing a URL that gets the health report daily, and on any failed
  # unit. Without one, the only signal this box is sick is noticing it went
  # offline in the Tailscale console — which does not distinguish "unplugged" from
  # "the database has been crash-looping for a week". ntfy.sh works, so does
  # healthchecks.io or a Slack webhook. A path, not a URL, because it has a token
  # in it and this file is world-readable in the Nix store.
  #
  #   printf 'https://ntfy.sh/my-secret-topic' > /var/lib/secrets/health-webhook
  #   chmod 600 /var/lib/secrets/health-webhook
  #
  # appliance.health.webhook = "/var/lib/secrets/health-webhook";

  ## ── evcc, for EV charging ──────────────────────────────────────────────────
  # SunReye and evcc both poll the inverter. Most RS485-to-Ethernet gateways
  # accept ONE TCP client at a time and simply refuse the second — so if your
  # inverter is behind a gateway, point evcc at SunReye's own API instead of at
  # the gateway, or expect one of the two to show no data.
  #
  # services.evcc = {
  #   enable = true;
  #   settings = {
  #     network.port = 7070;
  #     meters = [
  #       {
  #         name = "grid";
  #         type = "custom";
  #         power.source = "http";
  #         power.uri = "http://127.0.0.1:3000/api/v1/live";
  #         power.jq = ".grid.power";
  #         power.headers = [ { "X-API-Key" = "<an API key from SunReye's settings>"; } ];
  #       }
  #     ];
  #     site = { title = "Home"; meters.grid = "grid"; };
  #   };
  # };

  ## ── Home Assistant on this box ─────────────────────────────────────────────
  # Home Assistant *Core*, not HAOS: no Supervisor, so no add-ons and no
  # Supervisor backups — everything that would have been an add-on is a NixOS
  # service instead. The inverter arrives over MQTT discovery, which the SunReye
  # server already publishes, so there is no YAML to write for it.
  #
  # services.mosquitto = {
  #   enable = true;
  #   listeners = [{
  #     address = "127.0.0.1";
  #     users.sunreye = { acl = [ "readwrite #" ]; password = "change-me"; };
  #   }];
  # };
  #
  # appliance.sunreye.mqtt = {
  #   enable = true;
  #   brokerUrl = "mqtt://127.0.0.1:1883";
  #   haDiscovery = true;
  # };
  #
  # services.home-assistant = {
  #   enable = true;
  #   extraComponents = [ "mqtt" "default_config" "met" ];
  #   config = {
  #     default_config = { };
  #     http.server_port = 8123;
  #   };
  # };
  # networking.firewall.allowedTCPPorts = [ 8123 ];

  ## ── Anything else in a container ───────────────────────────────────────────
  # virtualisation.oci-containers.containers.my-thing = {
  #   image = "docker.io/library/nginx:alpine";
  #   ports = [ "127.0.0.1:8080:80" ];
  # };
}
