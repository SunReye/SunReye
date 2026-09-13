/*
  The banner an operator sees on the way in.

  Every guard on it fails closed — a tty test, a once-per-session flag, and
  NixOS's own `if [ -n "$PS1" ]` wrapper around interactiveShellInit — so a
  banner that never fires looks exactly like one that was never configured, and
  nothing anywhere goes red.

  This runs the GENERATED /etc/bashrc, which is the file a login shell actually
  reaches (via /etc/profile, line `. /etc/bashrc`). Asserting on the module's
  option text instead would prove only that we wrote a string: the wrapper that
  decides whether it executes is added by nixpkgs, below our text, and is
  exactly where this went wrong.

  Seconds, no VM. The boot test covers the other half — that the report it
  prints is true of a running box.
*/
{ pkgs, bashrc }:
pkgs.runCommand "login-banner-shows"
{
  nativeBuildInputs = [ pkgs.bashInteractive pkgs.util-linux ];
} ''
  set -o pipefail

  # A pty, because the banner refuses to draw where nobody is looking — and
  # `[ -t 1 ]` is false under a build's redirected stdout.
  printed=$(script -qec "bash --rcfile ${bashrc} -i -c true" /dev/null </dev/null 2>&1 | tr -d '\r' || true)

  case "$printed" in
    *"S U N R E Y E"*) ;;
    *)
      echo "the login banner did not appear in an interactive shell:" >&2
      printf '%s\n' "$printed" | head -30 >&2
      exit 1
      ;;
  esac

  # The logo alone is decoration. The point of putting it here is the status
  # underneath it — a box nobody has touched in months, saying what it is.
  case "$printed" in
    *"appliance health:"*) ;;
    *)
      echo "the banner drew the logo but not the health report:" >&2
      printf '%s\n' "$printed" | head -30 >&2
      exit 1
      ;;
  esac

  touch "$out"
''
