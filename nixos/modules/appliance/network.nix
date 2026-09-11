# Site networking: DHCP on the uplink, optionally through a bridge.
#
# origin: nixos-sh-appliance@2f444121c544, where this module ALWAYS built a
# bridge — the HAOS guest needed broadcast and multicast (mDNS, SSDP/UPnP,
# ESPHome discovery) on the physical LAN, and NAT would have broken exactly the
# integrations that box was bought for. A containerised workload has no tap
# device to put on layer 2, so a bridge here would be a MAC-learning hop and a
# second netfilter surface bought for nothing. `appliance.network.bridge = null`
# is now the default and a layer that needs one names it.
{ config, lib, ... }:
let
  cfg = config.appliance;
  br = cfg.network.bridge;
  bridged = br != null;
in
lib.mkIf cfg.enable {
  networking = {
    useDHCP = false;
    bridges = lib.optionalAttrs bridged { ${br}.interfaces = [ cfg.network.uplink ]; };
    interfaces.${cfg.network.lanInterface}.useDHCP = true;

    firewall = {
      enable = true;
      trustedInterfaces = [ "tailscale0" ];
      # Return packets for routed subnets arrive on an interface the strict RPF
      # check does not expect, and get dropped.
      checkReversePath = "loose";
    };
  };

  # Bridged guest traffic must not be filtered by the host's netfilter rules; a
  # bridged VM is a peer on the LAN, not a client behind us. This is the kernel
  # default, asserted here so loading br_netfilter (as Docker does) cannot
  # silently change it. Only meaningful when there is a bridge.
  boot.kernel.sysctl = lib.optionalAttrs bridged {
    "net.bridge.bridge-nf-call-iptables" = lib.mkDefault 0;
    "net.bridge.bridge-nf-call-ip6tables" = lib.mkDefault 0;
    "net.bridge.bridge-nf-call-arptables" = lib.mkDefault 0;
  };

  # Cheap sticks often have no RTC battery and boot at the epoch. A wrong clock
  # breaks TLS handshakes, Tailscale enrolment, and every day/month boundary the
  # workload cuts. mkDefault so a VM/test harness that runs its own clock can
  # override.
  services.timesyncd.enable = lib.mkDefault true;
  systemd.services.systemd-timesyncd.wantedBy =
    lib.mkIf config.services.timesyncd.enable [ "multi-user.target" ];
}
