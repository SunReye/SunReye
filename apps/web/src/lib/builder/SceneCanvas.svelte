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
  import { m } from "../paraglide/messages.js";
  import type { View } from "./camera.ts";
  import type { Geometry } from "./pv.ts";
  import { buildScene, tint, toThree, type Panel } from "./scene.ts";

  let {
    geometry,
    panels = [],
    shares,
    view,
    onview,
    onrender,
  }: {
    geometry: Geometry;
    /** The placed modules. */
    panels?: readonly Panel[];
    /** Live, by panel, its string's share of peak; the modules are tinted by it. */
    shares?: readonly (number | null)[];
    view: View;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
    /** After each draw: where a point of the scene lands on the canvas, or null behind it. */
    onrender?: (project: Projector) => void;
  } = $props();

  /** Metres of ground around the origin. */
  const GROUND = 100;

  function dispose(group: Group): void {
    group.traverse((part) => {
      if (part instanceof Mesh) {
        part.geometry.dispose();
        part.material.dispose();
      }
    });
  }

  /** A sky, a sun from the south-west and the ground. */
  function lit(scene: Scene): Scene {
    const sun = new DirectionalLight(0xffffff, 2);

    const ground = new Mesh(
      new CircleGeometry(GROUND, 48),
      new MeshStandardMaterial({ color: 0xa8b89a }),
    );

    sun.position.set(-20, 40, 30);
    ground.rotation.x = -Math.PI / 2;
    // A hair below the footprints, so the floor never flickers through them.
    ground.position.y = -0.01;
    scene.background = new Color(0xdce6ef);
    scene.add(new HemisphereLight(0xdde8f5, 0x4a4a40, 1.6), sun, ground);

    return scene;
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

  /** Keeps the drawn meshes in step with the geometry and the live tints; returns their disposal. */
  function keep(scene: Scene, render: () => void): () => void {
    let drawn: Group | undefined;

    $effect(() => {
      const next = buildScene(geometry, panels);
      const live = untrack(() => shares);

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
    const scene = lit(new Scene());
    const controls = new OrbitControls(camera, canvas);

    const render = (): void => {
      renderer.render(scene, camera);
      onrender?.(projector(canvas, camera.clone()));
    };

    const resize = fit(canvas, renderer, camera, render);
    const release = keep(scene, render);

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
