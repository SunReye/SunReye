<script lang="ts">
  import {
    CircleGeometry,
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    WebGLRenderer,
    type Group,
  } from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { m } from "../paraglide/messages.js";
  import type { View } from "./camera.ts";
  import type { Geometry } from "./pv.ts";
  import { buildScene, type Panel } from "./scene.ts";

  let {
    geometry,
    panels = [],
    view,
    onview,
  }: {
    geometry: Geometry;
    /** The placed modules. */
    panels?: readonly Panel[];
    view: View;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
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

  /** Draws on a change of geometry or view, a camera move or a resize; never in a loop (ADR 20). */
  function stage(canvas: HTMLCanvasElement): () => void {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    const camera = new PerspectiveCamera(40, 1, 0.1, 5000);
    const scene = lit(new Scene());
    const controls = new OrbitControls(camera, canvas);

    const render = (): void => {
      renderer.render(scene, camera);
    };

    const resize = fit(canvas, renderer, camera, render);
    let drawn: Group | undefined;

    controls.addEventListener("change", render);
    controls.addEventListener("end", () => {
      onview({ position: camera.position.toArray(), target: controls.target.toArray() });
    });

    $effect(() => {
      const next = buildScene(geometry, panels);

      if (drawn !== undefined) {
        scene.remove(drawn);
        dispose(drawn);
      }

      scene.add(next);
      drawn = next;
      render();
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

      if (drawn !== undefined) dispose(drawn);

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
