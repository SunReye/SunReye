# Bootloader, kernel parameters and panic behaviour.
#
# origin: nixos-sh-appliance@2f444121c544 (unchanged).
{ config, lib, ... }:
let
  cfg = config.appliance;
in
lib.mkIf cfg.enable {
  # mkForce, not mkDefault: nixos-generators' raw.nix sets `mkDefault 0` and two
  # equal-priority defaults collide. 0 would also remove the only way to select an
  # older generation from a keyboard, which is the last-resort recovery path when an
  # update bricks a remote unit.
  boot.loader.timeout = lib.mkForce 1;

  boot.kernelParams = [
    # Predictable NIC naming, so `appliance.network.uplink` means something.
    "net.ifnames=0"
    "biosdevname=0"

    # Auto-recover from a kernel crash rather than sitting dark on a customer site.
    "panic=10"
    "panic_on_oops=1"

    # nixos-generators' raw.nix forces `console=ttyS0` and nothing else. On a stick
    # with no exposed serial port that means an HDMI monitor shows *nothing* — not a
    # panic, not a login prompt. Adding tty0 costs nothing and is the difference
    # between "plug in a monitor" and "RMA the unit".
    #
    # The kernel prints to every console= it is given; the last one becomes
    # /dev/console for userspace.
    "console=ttyS0,115200n8"
    "console=tty0"
  ];

  # `quiet` is set by neither us nor the generator. Say so explicitly, because the
  # obvious "tidy up the boot output" change removes the only diagnostic channel a
  # headless unit has.
  boot.consoleLogLevel = lib.mkDefault 4;

  boot.kernel.sysctl = {
    # Belt and braces with the kernel params above; these apply once userspace is
    # up, the params apply during boot, which is when you most need them.
    "kernel.panic" = 10;
    "kernel.panic_on_oops" = 1;

    # Keep dirty page writeback shallow. On flash a large writeback burst is both a
    # latency spike and a long window of unflushed state across a power cut.
    "vm.dirty_background_ratio" = 5;
    "vm.dirty_ratio" = 10;
  };

  # The state version the image was first built from. Declared through
  # `appliance.stateVersion` rather than left to whoever writes a host file: an
  # unset one makes nixpkgs warn and silently adopt the CURRENT release on every
  # build, so a box updated a year later quietly changes the semantics of
  # stateful defaults under itself.
  system.stateVersion = cfg.stateVersion;

  # Grow to fill whatever disk the image was flashed onto.
  boot.growPartition = true;
  fileSystems."/".autoResize = true;
}
