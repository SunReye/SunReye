# Can the unattended upgrade COMMIT the lock it just wrote?
#
# `--commit-lock-file` shells out to `git commit`, and git refuses to commit
# without an identity:
#
#   fatal: unable to auto-detect email address (got 'root@sr-…(none)')
#   error: program "git" failed with exit code 128
#
# A freshly flashed box has no git identity, so every upgrade that actually has
# a new revision to lock died at the commit. The lock file is written BEFORE the
# commit is attempted, so the next run found nothing left to update, attempted no
# commit, and succeeded — which is how this hid.
#
# The resulting shape is the dangerous one: the nightly timer fails every night
# it has work to do and succeeds every night it does not. A box left alone never
# updates, and a spot-check on a quiet day looks perfectly healthy. Measured on
# an appliance that sat on 3.3.3 while 3.4.0 was published, with four identical
# failures in one day's journal.
#
# Asserted on the generated unit, because the identity has to reach the git
# process the unit spawns — not the interactive shell of whoever debugs it.
{ pkgs, upgradeUnit }:
pkgs.runCommand "upgrade-commit" { } ''
  unit=${upgradeUnit}
  fail=0
  note() { echo "  ✖ $1"; fail=1; }

  # Both halves. git takes the author from one pair and the committer from the
  # other, and a commit missing EITHER is the same exit 128 — so asserting only
  # the author would leave the bug half-present and the check green.
  for v in GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL; do
    grep -qE "^Environment=\"?$v=" "$unit" || note "no $v — git cannot commit the lock it just wrote"
  done

  if [ $fail -ne 0 ]; then
    echo
    echo "--- nixos-upgrade.service ---"; cat "$unit"
    exit 1
  fi
  echo "the upgrade can commit its own lock file"
  touch $out
''
