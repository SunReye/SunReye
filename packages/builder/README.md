# @sunreye/builder

SunReye's 3D house builder: its frame, the scene canvas, and the parts its consumer's other screens share with it (ADRs 20, 25). Home is its first consumer.

This file is the package's public interface. A consumer imports the entries below and nothing else; a breaking change to one is a major version.

## Using it

- Svelte and TypeScript sources: compile them with Svelte's Vite plugin, and point Tailwind's `@source` at the package beside `@sunreye/ui`'s sheet.
- Peers: Svelte, three.js, `@lucide/svelte`, Bits UI, `@internationalized/date`, `@sunreye/scene`, `@sunreye/pv-wasm`, `@sunreye/ui`, `@sunreye/catalogue`.
- Its words are its own Paraglide project, in German and English. A consumer that installs the package by path runs `bun run i18n` in it before building.
- The locale is Paraglide's local-storage key, where Home keeps it, unless the consumer sets it with `speak`.

## `@sunreye/builder`

Loads three.js: import it where a scene is drawn, or lazily.

- `Builder`: the frame. A canvas, the time slider and the inspector of one editing session. Props:
  - `pv`: the engine, from `@sunreye/pv-wasm`.
  - `core: Keeper`: takes the session's two writes, a layout change and an added module type.
  - `records?: Records`: what the frame reads besides the scene, each optional.
  - `host: Host`: a refusal's code in the consumer's words, the toast that confirms a save, where an uploaded car body is stored.
  - `start`, `types`, `moduleTypes`, `devices`, `location`, `limits`, `inputs`: the layout in force and what its checks read.
  - `aerial`, `neighbours`: an aerial image and the bodies around the plant, supplied by the consumer; never saved.
- `BUILDER_SIZE`: the frame's height classes, for a placeholder while it loads.
- `SceneCanvas`: one studio showing one scene. Two canvases may show the same scene.
  - Scene: `geometry`, `panels`, `cars`, `around` (the aerial image and the neighbours).
  - Light: `sun` (`sunAt` gives it at an instant), `diffuse`, `weather`.
  - A view's style and layers are these props: one left out is switched off.
  - Camera: `view` and `onview`; `locked` keeps it still.
  - Name and picking: `label` names the canvas; `onpick` answers a click with a `Hit`.
  - Lifecycle: `onrender`, `onready`, `onerror`.
  - Editing: `editing` and `roofwork` carry the editing tools' handles and roof gestures.
- Camera: `presetView` (a preset, turned to a compass heading), `headingOf` (the bearing a view looks toward, for a compass), `parseView`, and the types `View` and `Preset`.
- Language: `speak` sets the locale of every entry's words, `Locale`; a change shows without a reload.
- The draft: `emptyDraft`, `panels`, `Draft`; `sunAt`, the sun's direction at an instant.
- Types the props name: `Around`, `Aerial`, `Editing`, `Hit`, `Panel`, `Projector`, `Roofwork`, `Limits`.
- The host's shapes: `Keeper`, `Records`, `Host`, `LayoutChange`, `Device`, `Corrections`, `Interval`, `Span`, `Problem`.

## `@sunreye/builder/canvas`

What screens read of the canvas before it loads, or without it. Loads neither three.js nor Svelte.

- `sceneWeather`, `Weather`, `SceneWeather`, `Plant`, `snowLies`, `codeKind`: an instant's weather in the builder's shape, and the scene's weather drawn from it.
- `parked`, `Parked`: the cars standing at the scene's car places, from the live values.
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
