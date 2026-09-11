# origin: nixos-sh-appliance@2f444121c544. One change: the empty-keys check is a
# warning rather than an assertion when Tailscale is on.
#
# In the fleet image an auth key was baked in at flash time, so enrolment either
# worked or the unit was dead on arrival and LAN SSH was the only way back —
# hence an assertion. A published image enrols interactively through
# `tailscale web`, which brings up Tailscale SSH for the tailnet owner with no
# `authorized_keys` at all. Asserting here would make the normal path unbuildable
# and push people into baking a key they do not need.
{ config, lib, ... }:
let
  cfg = config.appliance;
  noKeys = cfg.ssh.authorizedKeys == [ ];
  tailscaled = cfg.tailscale.enable;
in
lib.mkIf cfg.enable {
  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
    };
    # Deliberately reachable on the LAN as well as the tailnet: if Tailscale
    # enrolment fails on site, this is the only way back in short of a visit.
    # Key-only, so the exposure is bounded.
    openFirewall = true;
  };

  users.users.root.openssh.authorizedKeys.keys = cfg.ssh.authorizedKeys;

  warnings = lib.optional (noKeys && tailscaled) ''
    appliance.ssh.authorizedKeys is empty. Remote access therefore depends
    entirely on Tailscale SSH, and the only local fallback is a keyboard and
    monitor on the box itself. That is the intended shape of a published image,
    but if this unit is going somewhere you cannot physically reach, add a key.
  '';

  assertions = [{
    assertion = !(noKeys && !tailscaled);
    message = ''
      appliance.ssh.authorizedKeys is empty and appliance.tailscale.enable is
      false. With password auth disabled and root login restricted to keys, this
      image would have no remote access path at all — and it is headless.
    '';
  }];
}
