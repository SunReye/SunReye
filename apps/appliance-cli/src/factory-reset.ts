/**
 * Return the box to the state it left the flasher in, without a re-flash.
 *
 * What this destroys is not configuration — it is the owner's entire
 * measurement history, which on a box whose only purpose is keeping that
 * history is the worst thing it holds. Years of readings, every account, and
 * the tailnet identity the box is reachable by.
 *
 * The confirmation is therefore the box's own hostname, not a flag. `--yes` is
 * one character from `--yez` and both are one arrow-up in a shell history from
 * a command someone meant to run on a different machine — and the operator of a
 * fleet has several of these open at once. Typing the hostname is the cheapest
 * thing that cannot be done by accident, and it is wrong on exactly the box
 * where being wrong matters.
 */

/**
 * State that makes a box no longer factory-fresh.
 *
 * Order matters on the way out: the tailnet goes first, so a box that fails
 * partway through has already stopped being reachable as its old identity
 * rather than coming back up enrolled with an empty database.
 */
export const FACTORY_RESET_PATHS = [
  // The tailnet identity. First, deliberately — see above.
  "/var/lib/tailscale",
  // The database and the generated secrets together: seed.nix regenerates
  // BETTER_AUTH_SECRET and the Postgres password on the next boot, and a
  // datadir kept across a secret rotation is a datadir nothing can open.
  "/var/lib/sunreye",
  // The console password, so the next boot generates a new one. A box handed on
  // with its old password printed on the screen is one the previous owner can
  // still log into.
  "/var/lib/secrets/console-password",
  // And the marker that says it has been handed out, without which the
  // first-boot window never reopens — leaving a "reset" box with no way in.
  "/var/lib/secrets/console-claimed",
] as const;

export interface FactoryResetRequest {
  /** This box's hostname, as the box itself reports it. */
  hostname: string;
  /** What the operator typed. */
  confirm: string | undefined;
}

export interface FactoryResetPlan {
  proceed: boolean;
  message: string;
}

const describe = (hostname: string) => `This erases ${hostname} back to a first boot.

It destroys, permanently and with no backup taken:

  * the database — every reading this box has ever recorded, and every account
    on it. That is the measurement history, and it is not recoverable.
  * this box's tailnet identity. It leaves your tailnet and has to be enrolled
    again from its login page.
  * the generated secrets, including the console password.

It keeps /etc/nixos/local.nix, which is your own configuration rather than
state this box produced. Delete that yourself if you want it gone.

To go ahead, confirm with this box's own name:

    sunreye-setup factory-reset --confirm ${hostname}
`;

/**
 * Decide whether to proceed, and what to say.
 *
 * Pure: the decision is the whole of the risk here, and the part that must be
 * testable without a box to destroy.
 */
export function factoryResetPlan(request: FactoryResetRequest): FactoryResetPlan {
  const { hostname, confirm } = request;

  // A box that cannot name itself cannot be confirmed. Otherwise an unset
  // shell variable — which expands to the empty string, silently — would
  // confirm it.
  if (hostname === "") {
    return {
      proceed: false,
      message:
        "This box does not know its own hostname yet, so there is nothing to confirm against. Wait for appliance-identity to run, or reboot.",
    };
  }

  // Exact match, no trimming and no case folding: every near miss below is a
  // different box somewhere, and the point of this prompt is that it is wrong
  // precisely where being wrong is expensive.
  if (confirm !== hostname) {
    return { proceed: false, message: describe(hostname) };
  }

  return { proceed: true, message: `Erasing ${hostname}. The box reboots when this finishes.` };
}
