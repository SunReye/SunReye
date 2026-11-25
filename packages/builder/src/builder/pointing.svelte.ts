// The canvas's pointer beyond a click (ADR 20 "Navigation"): a context menu asked for by a right
// click or a long press, and in an editor's navigation the face under the mouse outlined, the cursor
// telling what a press does, and Space held panning.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { RoofFaceId } from "@sunreye/scene";
import type { Group, OrthographicCamera, PerspectiveCamera, Scene as Studio } from "three";
import { ContextPress, whereOn, type Asked } from "./context-press.ts";
import type { Editing } from "./handles/grabbing.ts";
import { Hover } from "./hover.svelte.ts";
import type { Navigation } from "./navigation.ts";
import type { RoofFace } from "./pv.ts";
import { faceOf, marked } from "./roof-select.svelte.ts";
import { strike, type Hit, type Panel } from "./scene.ts";
import { watchSpace } from "./space.ts";

/** A right click or a long press: what it struck, the roof face it is on, and where on the page. */
export type OnContext = (
  hit: Hit | null,
  face: RoofFaceId | null,
  at: readonly [number, number],
) => void;

/** SceneCanvas's props this reads, when needed. */
export interface PointingProps {
  readonly roofs?: readonly RoofFace[] | undefined;
  /** The selected face's key. */
  readonly selected?: string | undefined;
  readonly editing?: Editing | undefined;
  /** Hovering stops while the canvas traces. */
  readonly tracing?: unknown;
  readonly oncontext?: OnContext | undefined;
  /** A primary press, before anything else hears it: what it struck and its roof face. A consumer
   * that picks what was struck here lets the same drag move it. */
  readonly onpress?: OnPress | undefined;
}

/** A primary press: what it struck and the roof face it is on. */
export type OnPress = (hit: Hit | null, face: RoofFaceId | null) => void;

export interface Pointing {
  readonly navigation: Navigation;
  readonly drawn: () => Group | undefined;
  readonly panels: () => readonly Panel[];
  readonly props: () => PointingProps;
}

/** Asks for the menu with what the press struck, once someone listens. */
function asking(camera: PerspectiveCamera | OrthographicCamera, sources: Pointing, faceAt: FaceAt) {
  return (): ((asked: Asked) => void) | undefined => {
    const ask = sources.props().oncontext;

    return (
      ask &&
      (({ client, ndc }) => {
        const group = sources.drawn();

        camera.updateMatrixWorld();

        const hit = group === undefined ? null : strike(group, sources.panels(), camera, ndc);

        ask(hit, faceAt(hit), client);
      })
    );
  };
}

type FaceAt = (hit: Hit | null) => RoofFaceId | null;

/** Tells the consumer of each primary press first, in the capture phase; returns the removal. */
function pressing(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera | OrthographicCamera,
  sources: Pointing,
  faceAt: FaceAt,
): () => void {
  const press = (event: PointerEvent): void => {
    const told = sources.props().onpress;
    const group = sources.drawn();

    if (told === undefined || group === undefined || event.button !== 0) return;

    camera.updateMatrixWorld();

    const hit = strike(group, sources.panels(), camera, whereOn(canvas, event).ndc);

    told(hit, faceAt(hit));
  };

  canvas.addEventListener("pointerdown", press, { capture: true });

  return () => {
    canvas.removeEventListener("pointerdown", press, { capture: true });
  };
}

/** Listens on `canvas`, after the handles; returns the removal. */
export function pointing(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera | OrthographicCamera,
  studio: Studio,
  render: () => void,
  sources: Pointing,
): () => void {
  const faceAt: FaceAt = (hit) => faceOf(hit, sources.props().roofs ?? [], sources.panels());
  const press = new ContextPress(canvas, asking(camera, sources, faceAt));
  const unpress = pressing(canvas, camera, sources, faceAt);

  if (sources.navigation === "orbit") {
    return () => {
      press.dispose();
      unpress();
    };
  }

  const hover = new Hover();

  const unhover = hover.attach(canvas, camera, {
    active: () => sources.props().tracing === undefined,
    drawn: sources.drawn,
    panels: sources.panels,
    editing: () => sources.props().editing,
    faceOf: faceAt,
  });

  // Outlined only where a press would pick something new.
  const unmark = marked(
    studio,
    () => sources.props().roofs,
    () => (hover.key === sources.props().selected ? undefined : hover.key),
    render,
    "var(--muted-foreground)",
  );

  const unwatch = watchSpace();

  return () => {
    press.dispose();
    unpress();
    unhover();
    unmark();
    unwatch();
  };
}
