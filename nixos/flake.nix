{
  description = "SunReye appliance — a flashable NixOS image for an x86 mini PC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    nixos-generators = {
      url = "github:nix-community/nixos-generators";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixos-generators }:
    let
      # x86_64 only, deliberately: these are mini PCs. An arm64 image would need
      # its own boot story per board and there is no arm64 appliance to test on.
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      base = [
        ./modules/appliance
        ./modules/sunreye
      ];

      /*
        Build an appliance system.

        Exported so the box's own /etc/nixos/flake.nix — seeded from ./template —
        can call it with its site.nix and local.nix. That is what makes the image
        and the live box the same evaluation: the image below is built from the
        template through this same function, so a `nixos-rebuild switch` on a
        remote box is running an expression whose shape was already proven at
        image-build time.
      */
      mkAppliance = { modules ? [ ], ... }@args:
        nixpkgs.lib.nixosSystem (
          (builtins.removeAttrs args [ "modules" ]) // {
            inherit system;
            modules = base ++ modules;
          }
        );

      # The template IS the image's configuration, not a copy of it. Evaluating
      # the template's own site.nix here is what stops the shipped defaults and
      # the built image drifting apart.
      image-config = [ ./template/site.nix ./template/local.nix ];
    in
    {
      lib = { inherit mkAppliance; };

      # Exported so a second appliance (or a fleet host) can import the generic
      # base without this repo's workload. The extraction into its own repo was
      # considered and rejected — it would buy a tag-and-bump loop and no second
      # consumer — but the module boundary is real and this keeps it honest.
      nixosModules = {
        appliance = ./modules/appliance;
        sunreye = ./modules/sunreye;
      };

      nixosConfigurations.appliance = mkAppliance { modules = image-config; };

      packages.${system} = {
        default = self.packages.${system}.image;

        # The flashable artifact. Pinned through flake.lock, so two units built a
        # month apart are the same system.
        image = nixos-generators.nixosGenerate {
          inherit system;
          modules = base ++ image-config;
          format = "raw-efi";
        };

        # Boots the built system under QEMU. Nothing is disabled to make it pass:
        # the containers really start, the migrations really run, and the report
        # the CI greps is a statement about services that actually came up.
        vmTest = nixos-generators.nixosGenerate {
          inherit system;
          modules = base ++ image-config ++ [
            ./tests/vmtest-report.nix
            {
              # Podman loading two images and initialising a datadir needs room
              # and cores that the 1 GB / 1 vCPU default does not have.
              virtualisation.vmVariant.virtualisation = {
                memorySize = 4096;
                cores = 2;
                diskSize = 12288;
              };
            }
          ];
          format = "vm-nogui";
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ qemu jq nixos-rebuild skopeo nix-prefetch-docker ];
      };

      checks.${system} = {
        # Evaluating the toplevel is the check: it runs every assertion in both
        # module layers and every option type, and needs no KVM — which is what
        # makes it the gate that runs on every PR.
        eval = self.nixosConfigurations.appliance.config.system.build.toplevel;

        # The assertions are behaviour, so they get a test of their own: a
        # configuration that must NOT evaluate. Without this, deleting an
        # assertion is invisible — `checks.eval` gets greener, not redder.
        assertions = import ./tests/assertions.nix {
          inherit (nixpkgs) lib;
          inherit pkgs mkAppliance;
        };
      };
    };
}
