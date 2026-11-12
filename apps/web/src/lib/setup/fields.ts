// The setup forms' shared classes: a field is its label above its control, as in Settings.

/** A label wrapping its control. */
export const FIELD = "flex flex-col gap-1.5 text-sm";

/** A native select dressed as the vendored input, for long lists such as every timezone. */
export const SELECT =
  "h-9 w-full min-w-0 rounded-md text-foreground border border-input bg-transparent px-2 text-base bevel-well outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";
