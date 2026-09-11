# The boot report CI greps.
#
# This exists because a headless VM run either prints why it failed or tells you
# nothing at all. The earlier version of this harness disabled the workload to
# make the VM boot without KVM — which silently deleted the very units under
# test, and the run reported "Unit could not be found" as a pass. So the rule
# here is: nothing is disabled to make the test pass, and every line the workflow
# greps for is a fact about a service that actually ran.
{ lib, pkgs, ... }:
{
  # No tailnet in CI, and no key: web login is exactly the path a published image
  # takes, so leave it on and assert the login window opened.
  appliance.tailscale.authKeyFile = lib.mkForce null;

  systemd.services.vmtest-report = {
    wantedBy = [ "multi-user.target" ];
    after = [
      "appliance-identity.service"
      "appliance-watchdog-check.service"
      "appliance-seed.service"
      "sunreye-migrate.service"
      "podman-sunreye-server.service"
      "caddy.service"
    ];
    serviceConfig = {
      Type = "oneshot";
      StandardOutput = "journal+console";
      StandardError = "journal+console";
      # The server has to come up through podman, which has to load a ~400 MB
      # image from the store and initialise a fresh Postgres datadir first.
      TimeoutStartSec = "20min";
    };
    path = with pkgs; [ systemd util-linux curl coreutils gnugrep ];
    script = ''
      echo "##### VMTEST REPORT #####"
      echo "rootfs:    $(findmnt -no FSTYPE,OPTIONS /)"
      echo "static:    $(hostnamectl --static || echo ERR)"
      echo "transient: $(hostnamectl --transient || echo ERR)"

      echo "--- ballast ---"
      systemctl is-active appliance-ballast || true
      /run/current-system/sw/bin/appliance-ballast status 2>&1 | head -3 || true
      /run/current-system/sw/bin/appliance-ballast release 2>&1 | head -1 || true
      /run/current-system/sw/bin/appliance-ballast restore 2>&1 | head -1 || true

      echo "--- seed ---"
      echo "etc-nixos: $(ls /etc/nixos 2>&1 | tr '\n' ' ')"
      echo "secrets:   $(test -s /var/lib/sunreye/secrets.env && echo present || echo MISSING)"

      echo "--- cli ---"
      # `show` exercises the read path end to end: parse site.json, print it, ask
      # tailscaled for status and survive not being enrolled.
      /run/current-system/sw/bin/sunreye-setup show 2>&1 | head -20 || true
      echo "setup-show: $(/run/current-system/sw/bin/sunreye-setup show >/dev/null 2>&1 && echo ok || echo FAILED)"

      echo "--- containers ---"
      podman ps --format '{{.Names}} {{.Status}}' 2>&1 || true
      for u in podman-sunreye-postgres sunreye-migrate podman-sunreye-server caddy tailscale-web; do
        echo "$u: $(systemctl is-active "$u" 2>/dev/null || echo inactive)"
      done

      # The two lines the workflow greps. `healthz` round-trips the database, so a
      # 200 proves the image loaded, the datadir initialised, the migrations ran
      # and the server is answering — the whole stack in one fact.
      code=$(curl -s -o /dev/null -w '%{http_code}' --retry 60 --retry-delay 5 --retry-all-errors \
        http://127.0.0.1:3000/healthz || echo 000)
      echo "healthz: $code"
      # And that the enrolment window is open on a box with no key, which is the
      # only way a published image can ever be adopted.
      echo "tailscale-web: $(systemctl is-active tailscale-web 2>/dev/null || echo inactive)"

      echo "--- health report ---"
      /run/current-system/sw/bin/appliance-health-report 2>&1 | head -30 || true

      echo "--- failed units ---"
      systemctl list-units --state=failed --no-legend --plain || true
      echo "##### END REPORT #####"
    '';
  };
}
