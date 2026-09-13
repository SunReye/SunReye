# This box's configuration.
#
# Seeded from the image on first boot and then owned by you: `sunreye-setup`
# commits here, and nothing in a later update overwrites it. The single input
# below is the whole update mechanism — `sunreye-setup apply` and the nightly
# timer both rebuild THIS flake, and the nightly one bumps that input first.
#
# It follows the SunReye repo's `stable` branch rather than a tag, because
# `stable` is fast-forwarded only once the container images for that version are
# in the registry. A box can therefore never pull a configuration that asks
# podman for an image tag which does not exist yet.
#
# To pin this box to a specific version instead, change the ref and apply:
#
#   sunreye = github:SunReye/SunReye/v3.1.1?dir=nixos
#
# nixpkgs is not an input here on purpose. It comes through the SunReye flake's
# own lock, so the nixpkgs this box builds against is the one that version was
# tested with — two units updated a month apart converge on the same closure.
{
  description = "A SunReye appliance";

  inputs.sunreye.url = "github:SunReye/SunReye/stable?dir=nixos";

  outputs = { self, sunreye }: {
    # Named, not derived from the hostname: every box generates its own hostname
    # at first boot (see modules/appliance/identity.nix), so an attribute set
    # named after this one would not exist on the next. `sunreye-setup apply`
    # and the nightly upgrade both rebuild `/etc/nixos#appliance`.
    nixosConfigurations.appliance = sunreye.lib.mkAppliance {
      modules = [ ./site.nix ./local.nix ];
    };
  };
}
