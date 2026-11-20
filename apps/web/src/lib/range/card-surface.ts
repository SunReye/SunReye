// The range card a finger drags its range on (ADR 21): its pane and its stepper find it here, so
// one gesture has one owner. A pane outside a card does not drag; an arrow's step still morphs it.
import { createContext } from "svelte";

export interface CardSurface {
  readonly el: HTMLElement | null;
}

const [getCard, setCard, hasCard] = createContext<CardSurface>();

/** For a range card, as it is set up. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it holds the card's element.
export const markCard = (card: CardSurface): void => {
  setCard(card);
};

/** At setup: the card this stands in, if any. */
export const cardOf = (): CardSurface | null => (hasCard() ? getCard() : null);
