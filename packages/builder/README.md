# @sunreye/builder

SunReye's 3D house builder: the scene canvas, its frame, and the parts its consumer's other screens share with it (ADRs 20, 25). Home is its first consumer.

This file is the package's public interface. A consumer imports the entries below and nothing else; a breaking change to one is a major version.

## Using it

- Svelte and TypeScript sources: compile them with Svelte's Vite plugin, and point Tailwind's `@source` at the package beside `@sunreye/ui`'s sheet.
- Peers: Svelte, three.js, `@lucide/svelte`, Bits UI, `@internationalized/date`, `@sunreye/scene`, `@sunreye/pv-wasm`, `@sunreye/ui`, `@sunreye/catalogue`.
- Its words are its own Paraglide project, in German and English, compiled by the package's `i18n` script ("Installing it by path").
- The locale is Paraglide's local-storage key, where Home keeps it, unless the consumer sets it with `speak`.

## Installing it by path

Until the packages are published, a consumer beside this repository's checkout, at `../home`, installs them by path (ADR 25). `fixtures/consumer` is such a consumer, and the gate builds and runs it (`scripts/consumer.ts`); copy from it.

1. In `../home`: `bun install`, then the builder's `i18n` and `@sunreye/pv-wasm`'s `wasm` scripts. Then install the consumer: Bun links each file it finds in a package folder at install, so a file generated later is missing. The fixture's `shared` script runs both.
2. `package.json`: each package by path, and the same path as an override for each package another one names as a peer, since Bun fills a peer from the registry, never from a folder. Svelte, three.js, Bits UI, `@lucide/svelte`, `@internationalized/date` and Tailwind at versions the peers' ranges take.

   ```json
   "dependencies": {
     "@sunreye/builder": "file:../home/packages/builder",
     "@sunreye/catalogue": "file:../home/packages/catalogue",
     "@sunreye/pv-wasm": "file:../home/packages/pv-wasm",
     "@sunreye/scene": "file:../home/packages/scene",
     "@sunreye/tokens": "file:../home/packages/tokens",
     "@sunreye/ui": "file:../home/packages/ui"
   },
   "overrides": {
     "@sunreye/catalogue": "file:../home/packages/catalogue",
     "@sunreye/pv-wasm": "file:../home/packages/pv-wasm",
     "@sunreye/scene": "file:../home/packages/scene",
     "@sunreye/ui": "file:../home/packages/ui"
   }
   ```

3. `tsconfig.json`: `"preserveSymlinks": true`, so the packages' imports resolve from the consumer's install, not this repository's.
4. `vite.config.ts`: the same for the bundle, and one copy of each `@sunreye` package, as the builder's own folder links its siblings too. Without `preserveSymlinks` the builder reads three.js, Bits UI and the rest from this repository's install; without `dedupe` a second `@sunreye/scene` loads.

   ```ts
   optimizeDeps: { exclude: ["@sunreye/builder", "@sunreye/ui"] },
   resolve: {
     preserveSymlinks: true,
     dedupe: ["@sunreye/catalogue", "@sunreye/pv-wasm", "@sunreye/scene", "@sunreye/ui"],
   },
   ```

   The `exclude` keeps the dev server from pre-bundling the packages' Svelte and TypeScript sources.
5. The sheet:

   ```css
   @import "tailwindcss";
   @import "@sunreye/ui/theme.css";
   @import "@sunreye/tokens/tokens.css";

   @source "../node_modules/@sunreye/ui/src";
   @source "../node_modules/@sunreye/builder/src";
   ```

Publishing to npm drops the overrides, `preserveSymlinks`, the `dedupe` and the first step.

## `@sunreye/builder`

The scene canvas. Loads three.js: import it where a scene is drawn, or lazily.

- `SceneCanvas`: one studio showing one scene. Two canvases may show the same scene.
  - Scene: `geometry`, `panels`, `cars`, `around` (the aerial image and the neighbours).
  - Light: `sun` (`sunAt` gives it at an instant), `diffuse`, `weather`.
  - A view's style and layers are these props: one left out is switched off.
  - Camera: `view` and `onview`; `locked` keeps it still.
  - Name and picking: `label` names the canvas; `onpick` answers a click with a `Hit`.
  - A roof face, in and out: given the crate's `roofs`, it marks the face whose `@sunreye/scene` key is `selected`, and `onselect` answers a click on a roof or a module with the face's block and face, or null off every roof. Two views of one scene take one key.
  - Lifecycle: `onrender`, `onready`, `onerror`.
  - Editing: `editing` and `roofwork` carry the editing tools' handles and roof gestures.
  - Tracing a roof (ADR 20): `tracing`, a `Tracing`, switches the canvas to tracing, alongside the roof gestures; give the view from above (`presetView("top", …)`). Clicks are traced over whatever is drawn, the `around` aerial image included:
    - `scene`: the scene traced on. Each click joins the last and snaps within `reach` pixels (12 without) to a traced point, else a traced line; the snap is named, and the line being drawn shows its length, in a chip beside the pointer. A click back on the chain's first point closes the loop; one on its last point, or Escape, ends the chain.
    - `ontrace(scene, edit)`: each edit's next scene, made by `@sunreye/scene`'s operations, and the `TraceEdit` itself (`{ kind: "add", from, to }` or `{ kind: "move", block, line, by }`), so a consumer that keeps the scene elsewhere may run the same operation there. The consumer keeps the scene and hands it back; the canvas changes nothing itself.
    - `line` and `onpickline`: a tap on a traced line with no chain picks it (a `LineRef`, or undefined off every line); the consumer holds it and may remove it with `removeLine`. A press on a traced line dragged moves it.
- Camera: `presetView` (a preset, turned to a compass heading), `headingOf` (the bearing a view looks toward, for a compass), `parseView`, and the types `View` and `Preset`.
- Language: `speak` sets the locale of every entry's words, `Locale`; a change shows without a reload.
- `panels`, the modules a layout draws; `sunAt`, the sun's direction at an instant.
- Types the props name: `Around`, `Aerial`, `Editing`, `Hit`, `Panel`, `Projector`, `Roofwork`, `Tracing`, `TraceEdit`, `LineRef`.

## `@sunreye/builder/frame`

The frame around a canvas. Loads three.js, so a screen that only shows the scene imports the root instead.

- `Builder`: a canvas, the time slider and the inspector of one editing session; its Buildings group traces a roof with the canvas's tracing mode, one undo step per line. Props:
  - `pv`: the engine, from `@sunreye/pv-wasm`.
  - `core: Keeper`: takes the session's two writes, a layout change and an added module type.
  - `records?: Records`: what the frame reads besides the scene, each optional.
  - `host: Host`: a refusal's code in the consumer's words, the toast that confirms a save, where an uploaded car body is stored.
  - `start`, `types`, `moduleTypes`, `devices`, `location`, `limits`, `inputs`: the layout in force and what its checks read.
  - `aerial`, `neighbours`: an aerial image and the bodies around the plant, supplied by the consumer; never saved.
- `BUILDER_SIZE`: the frame's height classes, for a placeholder while it loads.
- The draft: `emptyDraft`, `Draft`; `Limits`, what its checks hold it to.
- The host's shapes: `Keeper`, `Records`, `Host`, `ModelLoader`, `LayoutChange`, `Device`, `Corrections`, `Interval`, `Span`, `Problem`.

## `@sunreye/builder/canvas`

What screens read of the canvas before it loads, or without it. Loads neither three.js nor Svelte.

- `sceneWeather`, `Weather`, `SceneWeather`, `Plant`, `snowLies`, `codeKind`: an instant's weather in the builder's shape, and the scene's weather drawn from it.
- `parked`, `Parked`: the cars standing at the scene's car places, from the live values.
- `fetchPv`: fetches the engine `@sunreye/pv-wasm` ships and instantiates it.
- `warm`, `idle`, `rememberWebgl2`, `rememberedWebgl2`, `SceneFailure`: warming the studio up ahead of a scene, and remembering whether the browser draws one.
- `backdropAt`, `Linear`: the stand-in's backdrop.

## `@sunreye/builder/motion`

The motion tier and motion every screen shares; one store measures the whole page. Loads no three.js.

- `motion`, `MotionTier`, `MOTION_SETTINGS`, `MotionSetting`.
- `ease`, `fade`, `MOTION_EASE`, `MOTION_MS`, `motionMs`.
- `spring`, `tween`, `VelocityTracker`.

## `@sunreye/builder/settings`

The scene's settings a settings screen offers. Loads no three.js.

- `quality`, `QUALITIES`, `Quality`.
- `frameLimit`, `FRAME_LIMITS`, `FrameLimit`.
- `focusEffects`, `weatherEffects`.

## `@sunreye/builder/controls`

The parts with words of their own that screens share with the builder. Loads no three.js.

- `ValueRow`, `DateField`, `DrawerSheet`, `ResponsiveSheet`, `ProblemAlert`.
- `DrillHeader`, `DrillPush`, `DrillRow`, `DrillGroup`, `Push`.
- `ValueEditor`.
- `input`, `ShellLayout`: the input a page is used with.
- `answered`, `refusedInline`: the haptic a refusal plays as it lands.

## `@sunreye/builder/values`

Plain values and helpers. Loads neither three.js nor Svelte, so a unit test reaches them.

- `editable`, `valueText`, `clock`, `Editable`, `EditableSetting`, `Outcome`, `Refused`: a setting as the value editor edits it.
- `compact`, `found`, `queryWords`, `tokens`: the catalogue's search.
- `COUNT_UP_MS`, `EXIT_MS`, `FIGURE_GLIDE_MS`, `SPRINGS`: motion durations.
