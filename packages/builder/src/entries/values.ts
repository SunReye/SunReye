// The plain values and helpers a consumer's other screens share with the builder (ADRs 21, 25): a
// setting as the value editor edits it, the catalogue's search and the motion's durations. Loads
// neither Svelte nor three.js, so a unit test reaches it.

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
