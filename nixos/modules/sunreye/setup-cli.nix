# `sunreye` on the box.
#
# The package itself is ./setup-cli-package.nix, so that `nix flake check` can
# run the CLI without building a system. This module only decides who gets it.
{ config, lib, pkgs, ... }:
let
  cfg = config.appliance.sunreye;
  cli = import ./setup-cli-package.nix { inherit pkgs; };
in
lib.mkIf (config.appliance.enable && cfg.enable) {
  environment.systemPackages = [ cli ];


}
