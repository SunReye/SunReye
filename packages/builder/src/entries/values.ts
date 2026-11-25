// The plain values and helpers a consumer's other screens share with the builder (ADRs 21, 25): a
// setting as the value editor edits it, the catalogue's search, the motion's durations and a
// string's colour, and a view turned to a heading. Loads neither Svelte nor three.js, so a unit
// test reaches it.

export {
  clock,
  editable,
  valueText,
  type Editable,
  type EditableSetting,
  type Outcome,
  type Refused,
} from "../components/value-editor/editable.ts";

export { compact, found, queryWords, tokens } from "../search.ts";

export { COUNT_UP_MS, EXIT_MS, FIGURE_GLIDE_MS, SPRINGS } from "../motion/values.ts";

export { STRINGS, UNASSIGNED, stringColour, stringCss } from "../builder/string-colours.ts";

export { headingOf, type View } from "../builder/view.ts";

export { detent, eaveHeading, withHeading } from "../builder/view-turn.ts";

export { angleOf, turnedBy } from "../builder/handles/turning.ts";
