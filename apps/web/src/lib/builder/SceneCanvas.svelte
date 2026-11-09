<script lang="ts" module>
  import type { Point } from "./pv.ts";

  /** Pixels from the canvas's top left corner. */
  export type Projector = (point: Point) => readonly [number, number] | null;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import {
    CircleGeometry,
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
    type Group,
  } from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { garage, type ModelLoader } from "../cars/garage.ts";
  import type { Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import type { View } from "./camera.ts";
  import type { Geometry } from "./pv.ts";
  import { buildScene, tint, toThree, type Panel } from "./scene.ts";

  let {
    geometry,
    panels = [],
    shares,
    cars = [],
    sun,
    model,
    view,
    onview,
    onrender,
  }: {
    geometry: Geometry;
    /** The placed modules. */
    panels?: readonly Panel[];
    /** Live, by panel, its string's share of peak; the modules are tinted by it. */
    shares?: readonly (number | null)[];
    /** The connected cars; drawn again only when one comes, goes or changes body. */
    cars?: readonly Parked[];
    /** Toward the sun, east, north, up: it lights and shadows the scene; null for a fixed sun.
     * Without it nothing casts a shadow. */
    sun?: Point | null | undefined;
    /** Reads an uploaded car body. */
    model?: ModelLoader | undefined;
    view: View;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
    /** After each draw: where a point of the scene lands on the canvas, or null behind it. */
    onrender?: (project: Projector) => void;
  } = $props();

  /** Metres of ground around the origin. */
  const GROUND = 100;

  /** Metres from the origin to the sun light, beyond the tallest tree. */
  const SUN_DISTANCE = 80;

  /** The fixed sun's place, from the south-west. */
  const SOUTH_WEST: readonly [number, number, number] = [-20, 40, 30];

  const SUN_INTENSITY = 2;

  function dispose(group: Group): void {
    group.traverse((part) => {
      if (part instanceof Mesh) {
        part.geometry.dispose();
        part.material.dispose();
      }
    });
  }

  /** A sky, a sun from the south-west and the ground; the sun is returned to move. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds in place.
  function lit(scene: Scene): DirectionalLight {
    const light = new DirectionalLight(0xffffff, SUN_INTENSITY);

    const ground = new Mesh(
      new CircleGeometry(GROUND, 48),
      new MeshStandardMaterial({ color: 0xa8b89a }),
    );

    light.position.set(...SOUTH_WEST);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // A hair below the footprints, so the floor never flickers through them.
    ground.position.y = -0.01;
    scene.background = new Color(0xdce6ef);
    scene.add(new HemisphereLight(0xdde8f5, 0x4a4a40, 1.6), light, ground);

    return light;
  }

  /** Sets the light toward `toward`, dark below the horizon; a null sun stays south-west. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js moves it in place.
  function shine(light: DirectionalLight, toward: Point | null): void {
    if (toward === null) {
      light.position.set(...SOUTH_WEST);
      light.intensity = SUN_INTENSITY;

      return;
    }

    const [east, north, up] = toward;

    light.position.set(...toThree([east * SUN_DISTANCE, north * SUN_DISTANCE, up * SUN_DISTANCE]));
    light.intensity = up > 0 ? SUN_INTENSITY : 0;
  }

  /** Lets the light cast shadows over the ground's middle. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
  function shadowing(renderer: WebGLRenderer, light: DirectionalLight): void {
    const half = GROUND / 2;

    renderer.shadowMap.enabled = true;
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    light.shadow.camera.far = SUN_DISTANCE * 2;
    light.shadow.camera.updateProjectionMatrix();
  }

  function projector(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Projector {
    return (point) => {
      const at = new Vector3(...toThree(point)).project(camera);

      return at.z > 1
        ? null
        : [((at.x + 1) / 2) * canvas.clientWidth, ((1 - at.y) / 2) * canvas.clientHeight];
    };
  }

  /** Fits the drawing buffer and the camera to the canvas whenever its size changes. */
  function fit(
    canvas: HTMLCanvasElement,
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    render: () => void,
  ): ResizeObserver {
    const resize = new ResizeObserver(() => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      camera.updateProjectionMatrix();
      render();
    });

    resize.observe(canvas);

    return resize;
  }

  /** Moves the light with the sun, if given one; whether the scene casts shadows. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
  function follow(renderer: WebGLRenderer, light: DirectionalLight, render: () => void): boolean {
    // Shadows cost a pass per draw: only a scene given a sun casts them.
    const shadowed = untrack(() => sun !== undefined);

    if (shadowed) shadowing(renderer, light);

    $effect(() => {
      if (sun !== undefined) {
        shine(light, sun);
        render();
      }
    });

    return shadowed;
  }

  /** Keeps the drawn meshes in step with the geometry and the live tints; returns their disposal. */
  function keep(scene: Scene, render: () => void, shadowed: boolean): () => void {
    let drawn: Group | undefined;

    $effect(() => {
      const next = buildScene(geometry, panels);
      const live = untrack(() => shares);

      if (shadowed) {
        next.traverse((part) => {
          part.castShadow = true;
          part.receiveShadow = true;
        });
      }

      if (live !== undefined) tint(next, live);

      if (drawn !== undefined) {
        scene.remove(drawn);
        dispose(drawn);
      }

      scene.add(next);
      drawn = next;
      render();
    });

    // A live tick recolours the modules it already drew: one draw, nothing rebuilt.
    $effect(() => {
      if (shares !== undefined && drawn !== undefined) {
        tint(drawn, shares);
        render();
      }
    });

    return () => {
      if (drawn !== undefined) dispose(drawn);
    };
  }

  /** Draws on a change of geometry or view, a camera move or a resize; never in a loop (ADR 20). */
  function stage(canvas: HTMLCanvasElement): () => void {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    const camera = new PerspectiveCamera(40, 1, 0.1, 5000);
    const scene = new Scene();
    const controls = new OrbitControls(camera, canvas);

    const render = (): void => {
      renderer.render(scene, camera);
      onrender?.(projector(canvas, camera.clone()));
    };

    const resize = fit(canvas, renderer, camera, render);
    const release = keep(scene, render, follow(renderer, lit(scene), render));

    const parking = garage(
      scene,
      render,
      untrack(() => model),
    );

    $effect(() => {
      parking.park(cars);
    });

    controls.addEventListener("change", render);
    controls.addEventListener("end", () => {
      onview({ position: camera.position.toArray(), target: controls.target.toArray() });
    });

    $effect(() => {
      camera.position.set(...view.position);
      controls.target.set(...view.target);
      // Dispatches "change", which draws.
      controls.update();
    });

    return () => {
      resize.disconnect();
      controls.dispose();
      release();
      parking.dispose();
      renderer.dispose();
    };
  }
</script>

<canvas aria-label={m.builder_scene()} {@attach stage}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 20rem;
    touch-action: none;
  }
</style>
