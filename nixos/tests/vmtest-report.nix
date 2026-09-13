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

  # The run is over when both reports have been printed.
  #
  # nixos-image.yml has always said "the guest powers itself off after the
  # report", and nothing ever did: there is no poweroff anywhere in this
  # configuration. Every boot test therefore ran until the workflow's 25-minute
  # ceiling and was killed there — passing runs included, since the assertions
  # read a log the guest had finished writing twenty minutes earlier. A job that
  # sits silent for 25 minutes is indistinguishable from one that hung, which is
  # exactly how it was read.
  #
  # After BOTH reporting units: `vmtest-report` waits on the workload and
  # usually finishes first, while `vmtest-diagnose` deliberately runs on its own
  # 120-second clock. Powering off when the first one ends would cut the other
  # off mid-sentence. Ordering does not require success, so a failed report
  # still ends the run rather than stranding it.
  systemd.services.vmtest-poweroff = {
    wantedBy = [ "multi-user.target" ];
    after = [ "vmtest-report.service" "vmtest-diagnose.service" ];
    wants = [ "vmtest-report.service" "vmtest-diagnose.service" ];
    path = [ pkgs.systemd ];
    serviceConfig = {
      Type = "oneshot";
      StandardOutput = "journal+console";
    };
    # --no-block: a unit that waits for the shutdown transaction it is part of
    # deadlocks against itself.
    script = ''
      echo "##### VMTEST COMPLETE — powering off #####"
      systemctl --no-block poweroff
    '';
  };

  # A second unit, deliberately NOT ordered after the workload.
  #
  # `vmtest-report` waits on the containers so its facts are about services that
  # finished starting — which means that when one of them hangs, the report hangs
  # with it and the run produces NOTHING. That is how a 25-minute CI job ended
  # with an empty artifact and four assertions blamed on an appliance whose
  # actual defect was never printed. This one runs on a clock of its own and
  # reports whatever is true at that moment, including a unit still activating.
  systemd.services.vmtest-diagnose = {
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      StandardOutput = "journal+console";
      StandardError = "journal+console";
      TimeoutStartSec = "5min";
    };
    path = with pkgs; [ systemd coreutils podman iproute2 ];
    script = ''
      # Long enough for a ~400 MB image load to have got somewhere, short enough
      # to land well inside any CI timeout.
      sleep 120
      echo "##### VMTEST DIAGNOSE #####"
      for u in podman-sunreye-postgres sunreye-migrate podman-sunreye-server; do
        echo "== $u: $(systemctl is-active "$u" 2>/dev/null || echo inactive) =="
        systemctl show "$u" -p ActiveState -p SubState -p ExecMainStatus -p NRestarts \
          --no-pager 2>&1 | tr '\n' ' ' || true
        echo
        journalctl -u "$u" --no-pager -n 30 2>&1 | tail -30 || true
      done
      echo "== caddy: $(systemctl is-active caddy 2>/dev/null || echo inactive) =="
      journalctl -u caddy --no-pager -n 40 2>&1 | tail -40 || true
      echo "-- listening --"
      ss -lntp 2>/dev/null | head -20 || true
      echo "-- caddy config --"
      cat /etc/caddy/caddy_config 2>/dev/null | head -40 || true
      echo "-- images --"
      podman images --format '{{.Repository}}:{{.Tag}} {{.Size}}' 2>&1 | head -5 || true
      echo "-- ps --"
      podman ps -a --format '{{.Names}} {{.Status}}' 2>&1 | head -5 || true
      echo "##### END DIAGNOSE #####"
    '';
  };

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
      # image from the store and initialise a fresh Postgres datadir first — but
      # this ceiling must also stay INSIDE the workflow's 25-minute boot budget,
      # or a report that hangs stalls the job silently instead of failing it with
      # whatever it had managed to print. The healthz retry budget below is 7
      # minutes, so 10 covers the honest case with room to spare.
      TimeoutStartSec = "10min";
    };
    # podman included because the report asks it what is running: without it the
    # container section was `podman: command not found` and the reader was left
    # to infer the state of the workload from the unit list alone.
    path = with pkgs; [ systemd util-linux curl coreutils gnugrep gawk git podman openssl ];
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
      code=$(curl -s -o /dev/null -w '%{http_code}' --retry 60 --retry-delay 5 --retry-all-errors --max-time 420 --connect-timeout 10 \
        http://127.0.0.1:3000/healthz || echo 000)
      echo "healthz: $code"
      # And that the enrolment window is open on a box with no key, which is the
      # only way a published image can ever be adopted.
      echo "tailscale-web: $(systemctl is-active tailscale-web 2>/dev/null || echo inactive)"

      # The FRONT DOOR, which is the only address a household ever types. Until
      # this existed the test proved the server answers on 127.0.0.1:3000 and
      # nothing at all about the path in front of it: `caddy: active` says
      # systemd started a process, not that it terminates TLS or proxies to
      # anything. A box that boots to a browser error is a broken box however
      # healthy port 3000 is.
      #
      # --resolve, because `tls internal` issues per-name certificates and curl
      # sends no SNI for a bare IP: the request has to carry the name the box
      # actually answers to.
      name=$(hostnamectl --transient 2>/dev/null || echo localhost)
      echo "proxy-redirect: $(curl -s -o /dev/null -w '%{http_code}' --max-time 15         "http://127.0.0.1/" || echo 000)"
      echo "proxy-https: $(curl -s -k -o /dev/null -w '%{http_code}' --max-time 30         --resolve "$name:443:127.0.0.1" "https://$name/healthz" || echo 000)"
      # The certificate the LAN door presents, so a change of issuer is visible
      # rather than silent.
      # `timeout`, because nothing in this report may be able to block it:
      # s_client has no deadline of its own and does not always return on stdin
      # EOF, and a report that never ends is a VM that never powers off, a job
      # that runs to its 25-minute ceiling, and a guard that then blames the
      # appliance for a harness that hung.
      echo "proxy-issuer: $(timeout 20 openssl s_client -connect 127.0.0.1:443 -servername "$name" </dev/null 2>/dev/null | timeout 10 openssl x509 -noout -issuer 2>/dev/null || echo NONE)"

      # The one-shot password window, through the proxy that publishes it — and
      # the property that makes it worth having: the SECOND read must fail. A
      # timed window with unlimited reads leaves nobody able to tell afterwards
      # whether anyone else looked, so "closes on first read" is the behaviour,
      # not an optimisation.
      first=$(curl -s -k --max-time 20 --resolve "$name:443:127.0.0.1" "https://$name/first-boot" || echo "")
      second_code=$(curl -s -k -o /dev/null -w '%{http_code}' --max-time 20 \
        --resolve "$name:443:127.0.0.1" "https://$name/first-boot" || echo 000)
      case "$first" in
        *"root / "*) echo "first-boot-window: served" ;;
        *) echo "first-boot-window: NOTHING SERVED" ;;
      esac
      if [ "$second_code" = "410" ]; then
        echo "first-boot-reread: refused"
      else
        echo "first-boot-reread: STILL OPEN ($second_code)"
      fi

      # Can anyone actually log in at the keyboard? The image shipped for weeks
      # with root locked — no password, no key, `allowNoPasswordLogin = false` —
      # while the docs offered "a keyboard on the box" as the fallback. Nothing
      # noticed, because every other probe here talks to the box over TCP.
      hash=$(awk -F: '$1 == "root" { print $2 }' /etc/shadow 2>/dev/null || echo "")
      case "$hash" in
        ""|"!"*|"*") echo "console-login: LOCKED" ;;
        *) echo "console-login: usable" ;;
      esac
      # …and the one thing that makes a generated password usable: it has to be
      # on the screen in front of whoever is standing there.
      if grep -q "root / ." /etc/issue 2>/dev/null; then
        echo "console-banner: names the password"
      else
        echo "console-banner: MISSING"
      fi

      # The unit that makes an enrolled box reachable at all. On THIS box nobody
      # has enrolled anything, so the only thing provable here is the half that
      # regresses silently: it must run and exit 0 on an unenrolled box rather
      # than failing. A failed unit here pages daily about a machine behaving
      # exactly as intended, and `Restart=on-failure` would retry it forever.
      echo "tailscale-settings: $(systemctl show appliance-tailscale-settings -p Result --value 2>/dev/null || echo unknown)"

      # Can this box rebuild itself at all? Everything above is the system the
      # IMAGE baked; this is the only question about the system the box will
      # build NEXT, and for a while the answer was no — `nixos/template/` shipped
      # a site.json and a local.nix and no flake.nix, so `nixos-rebuild --flake
      # /etc/nixos` had nothing to evaluate, `sunreye-setup apply` could not
      # work, and seed.nix's `[ ! -e /etc/nixos/flake.nix ]` guard never became
      # false — every boot copied the template back over the owner's settings.
      # Every gate we had was green throughout: the image builds and boots fine.
      #
      # Fetching the input needs a network this VM does not have, so this is the
      # offline half — the file is there, git can see it (nixos-rebuild ignores
      # what git does not track, which presents as "my setting did nothing"), and
      # the attribute the nightly timer rebuilds is one the flake declares.
      # The flags are NOT in the unit file: a systemd service with a `script`
      # gets an ExecStart pointing at a generated start script in the store, and
      # the command line lives inside that. Reading only `systemctl cat` finds
      # nothing and reports a broken box that is fine.
      start=$(systemctl show -p ExecStart --value nixos-upgrade.service 2>/dev/null \
        | sed -n 's|.*path=\([^ ;]*\).*|\1|p' | head -1)
      attr=$( { systemctl cat nixos-upgrade.service 2>/dev/null; cat "$start" 2>/dev/null; } \
        | sed -n 's|.*--flake /etc/nixos#\([A-Za-z0-9_-]*\).*|\1|p' | head -1)
      if [ ! -e /etc/nixos/flake.nix ]; then
        echo "config-tree: no flake.nix — this box cannot rebuild itself"
      elif ! git -C /etc/nixos ls-files --error-unmatch flake.nix >/dev/null 2>&1; then
        echo "config-tree: flake.nix is untracked, so the rebuild cannot see it"
      elif [ -z "$attr" ]; then
        echo "config-tree: the nightly upgrade names no flake attribute"
      elif ! grep -q "nixosConfigurations.$attr" /etc/nixos/flake.nix; then
        echo "config-tree: nightly rebuilds #$attr, which the flake does not declare"
      else
        echo "config-tree: ok (#$attr)"
      fi

      echo "--- health report ---"
      /run/current-system/sw/bin/appliance-health-report 2>&1 | head -30 || true

      echo "--- failed units ---"
      systemctl list-units --state=failed --no-legend --plain || true

      # Why, not just that. A unit line saying `failed` sends whoever reads this
      # log back to a twenty-minute rebuild to find out what it said; the run
      # that exposed this had `sunreye-migrate: failed` and no reason anywhere in
      # the artifact. Anything that did not reach `active` explains itself here.
      echo "--- why ---"
      for u in podman-sunreye-postgres sunreye-migrate podman-sunreye-server caddy; do
        state=$(systemctl is-active "$u" 2>/dev/null || echo inactive)
        [ "$state" = "active" ] && continue
        echo "== $u ($state) =="
        systemctl status "$u" --no-pager --lines=0 2>&1 | sed -n '1,6p' || true
        journalctl -u "$u" --no-pager -n 40 2>&1 | tail -40 || true
      done
      echo "##### END REPORT #####"
    '';
  };
}
