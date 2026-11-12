<!--
  PROTOTYPE: the plant as a realistic architectural render (ADR 20 Look/Motion/Labels, ADR 21).
  Procedural PBR materials, a Sky-driven PMREM environment, sun shadows and one GTAO pass.
  No continuous loop: it renders on a tick, on an orbit change, and while a short tween runs.

  The hero imports this component only once the dashboard is in use, and the scene then builds
  behind it in short tasks: textures in a worker, the plant in sections, shaders compiled in
  parallel. The first frame is drawn hidden; the layer fades in when it is on screen, labels
  included. The car loads after the house and fades in on its own.
-->
<script lang="ts">
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { Sky } from "three/addons/objects/Sky.js";
  import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
  import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
  import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
  import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
  import { onMount, tick } from "svelte";
  import Sun from "@lucide/svelte/icons/sun";
  import Cpu from "@lucide/svelte/icons/cpu";
  import BatteryCharging from "@lucide/svelte/icons/battery-charging";
  import Car from "@lucide/svelte/icons/car";
  import type { LiveSim } from "./sim.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { easeInOut, reducedMotion } from "./animate";
  import { haptics } from "./haptics";
  import { buildPlant, type Plant } from "./scene/house";
  import { warm } from "./scene/warm";
  import { motion } from "./motion/tier.svelte";
  import { view } from "./view.svelte";
  import { scrollFade } from "./scrollFade";

  let {
    sim,
    dark,
    tod,
    onselect,
    onready,
    onerror,
  }: {
    sim: LiveSim;
    dark: boolean;
    tod: string;
    onselect?: (id: string) => void;
    /** The first frame is on screen and the layer has started to fade in. */
    onready?: () => void;
    /** The scene could not be built ("webgl2": this browser has none); the hero falls back to the 2D flow. */
    onerror?: (reason: unknown) => void;
  } = $props();

  /** three.js state exists: effects may touch it. */
  let live = $state(false);
  /** The first frame is on screen: the layer is visible, labels included. */
  let shown = $state(false);
  /** The picture without the car, held over the canvas while the car fades in beneath it. */
  let ghost: HTMLCanvasElement | undefined = $state();
  let ghosting = $state<"off" | "hold" | "fade">("off");

  let host: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);

  type ChipId = "s1" | "s2" | "s3" | "inverter" | "battery" | "ev";
  interface Chip {
    id: ChipId;
    ax: number;
    ay: number;
    x: number;
    y: number;
    hidden: boolean;
  }
  let chips = $state<Chip[]>(
    (["s1", "s2", "s3", "inverter", "battery", "ev"] as ChipId[]).map((id) => ({ id, ax: 0, ay: 0, x: 0, y: 0, hidden: true })),
  );
  const chipEls: Record<ChipId, HTMLElement | null> = $state({ s1: null, s2: null, s3: null, inverter: null, battery: null, ev: null });

  // three.js state, outside Svelte's reactivity.
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let composer: EffectComposer;
  let gtao: GTAOPass;
  let sunLight: THREE.DirectionalLight;
  let fill: THREE.HemisphereLight;
  let sky: Sky;
  let envSky: Sky;
  let envScene: THREE.Scene;
  let pmrem: THREE.PMREMGenerator;
  let envTarget: THREE.WebGLRenderTarget | undefined;
  let plant: Plant;
  const tint: Record<string, { from: number; to: number; now: number }> = {};

  /** Resolves any CSS colour (oklch included) to linear RGB via a 1px canvas. */
  function cssColour(expr: string): THREE.Color {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    // A CPU canvas: reading a GPU one back waits behind whatever the GPU is still drawing.
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const probe = document.createElement("span");
    probe.style.color = expr;
    document.body.appendChild(probe);
    ctx.fillStyle = getComputedStyle(probe).color;
    probe.remove();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
  }

  // ACES as three applies it, so the studio backdrop can be pre-inverted to land on the page colour.
  const EXPOSURE = 0.62;
  const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  function untone(linear: number, exposure: number): number {
    let lo = 0, hi = 60;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (rrt((mid * exposure) / 0.6) < linear) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Studio backdrop: a soft vignette that lands on the page colour after tone mapping. */
  function studioBackdrop(page: THREE.Color, exposure: number): THREE.DataTexture {
    const N = 64;
    const data = new Float32Array(N * N * 4);
    const centre = page.clone().lerp(new THREE.Color(dark ? 0.06 : 1, dark ? 0.065 : 1, dark ? 0.075 : 1), dark ? 0.4 : 0.55);
    const edge = page.clone().multiplyScalar(dark ? 0.7 : 0.93);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const d = Math.min(1, Math.hypot(x / N - 0.5, (y / N - 0.42) * 1.15) * 1.6);
        const t = d * d * (3 - 2 * d);
        const c = t < 0.5 ? centre.clone().lerp(page, t * 2) : page.clone().lerp(edge, (t - 0.5) * 2);
        const i = (y * N + x) * 4;
        data[i] = untone(c.r, exposure);
        data[i + 1] = untone(c.g, exposure);
        data[i + 2] = untone(c.b, exposure);
        data[i + 3] = 1;
      }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.flipY = true;
    t.needsUpdate = true;
    return t;
  }

  /** Sun direction from compass azimuth (0 = N, 90 = E) and elevation, in scene axes (x east, z south). */
  function sunDir(azDeg: number, elDeg: number): THREE.Vector3 {
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  // The plant at 15:00 is the noon setting; the dev control moves the sun through the day.
  const SUNS: Record<string, { az: number; el: number; colour: string; i: number; env: number; fog: [string, string] }> = {
    dawn: { az: 75, el: 7, colour: "#ffc48a", i: 2.2, env: 0.7, fog: ["#e7c9b0", "#5b4a48"] },
    noon: { az: 238, el: 42, colour: "#fff4e5", i: 3.4, env: 1, fog: ["#c8d6e4", "#3c4a5c"] },
    dusk: { az: 285, el: 5, colour: "#ff9c66", i: 2.0, env: 0.65, fog: ["#e3ad92", "#4a3540"] },
    night: { az: 320, el: -9, colour: "#9db0ff", i: 0.35, env: 0.35, fog: ["#28324a", "#0e121c"] },
  };

  async function build(): Promise<void> {
    scene = new THREE.Scene();
    plant = await buildPlant(pause);
    scene.add(plant.root);
    for (const id of Object.keys(plant.strings)) tint[id] = { from: 0, to: 0, now: 0 };

    sunLight = new THREE.DirectionalLight("#fff4e5", 3);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sc = sunLight.shadow.camera;
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
    sc.near = 1;
    sc.far = 120;
    sunLight.shadow.bias = -0.00025;
    sunLight.shadow.normalBias = 0.035;
    sunLight.shadow.radius = 3.5;
    sunLight.shadow.blurSamples = 16;
    sunLight.target.position.set(1.5, 0, 2);
    scene.add(sunLight, sunLight.target);
    // A faint sky/ground bounce on top of the image-based light.
    fill = new THREE.HemisphereLight("#cfe0ff", "#4b5b35", 0.15);
    scene.add(fill);

    sky = new Sky();
    sky.scale.setScalar(4000);
    envSky = new Sky();
    envSky.scale.setScalar(1000);
    envScene = new THREE.Scene();
    envScene.add(envSky);
    for (const s of [sky, envSky]) {
      const u = s.material.uniforms;
      u.mieCoefficient!.value = 0.004;
      u.mieDirectionalG!.value = 0.82;
      u.cloudCoverage!.value = 0.32;
      u.cloudDensity!.value = 0.35;
      u.time!.value = 120;
    }
    envSky.material.uniforms.showSunDisc!.value = 0;
  }

  /** Sun, sky, environment, background and fog for the time of day, theme and mode. */
  function applyLight(): void {
    const s = SUNS[tod] ?? SUNS.noon!;
    const dir = sunDir(s.az, s.el);
    sunLight.position.copy(sunLight.target.position).addScaledVector(dir, 60);
    sunLight.color.set(s.colour);
    sunLight.intensity = s.el > 0 ? s.i : 0;
    sunLight.castShadow = s.el > 0;
    // Night: a moon from the north-west, lights on behind the panes.
    if (s.el <= 0) {
      sunLight.position.copy(sunLight.target.position).addScaledVector(sunDir(300, 35), 60);
      sunLight.intensity = 0.45;
      sunLight.color.set("#9fb2ff");
      sunLight.castShadow = true;
    }
    plant.panes.emissiveIntensity = tod === "night" ? 0.9 : tod === "dusk" ? 0.25 : 0;

    for (const k of [sky, envSky]) {
      const u = k.material.uniforms;
      u.sunPosition!.value.copy(dir);
      // Dark theme: a deeper, moodier sky at the same sun.
      u.turbidity!.value = dark ? 6 : s.el < 10 ? 5 : 2.4;
      u.rayleigh!.value = dark ? 2.4 : s.el < 10 ? 2.2 : 1.1;
    }
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 0.1, 2000);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = s.env * (dark ? 0.75 : 1);

    const page = cssColour("var(--background)");
    const exposure = EXPOSURE * (dark ? 0.82 : 1);
    renderer.toneMappingExposure = exposure;
    for (const tw of Object.values(tint)) tw.from = tw.now;
    tintT0 = performance.now() - 400;
    tinting = true;
    if (view.scene !== shownScene) {
      shownScene = view.scene;
      lens();
      placeCamera(preset);
    }
    if (view.scene === "sky") {
      if (!sky.parent) scene.add(sky);
      scene.background = null;
      plant.fade.uniform.value = 0;
      scene.fog = new THREE.Fog(s.fog[dark ? 1 : 0], 70, 520);
    } else {
      sky.removeFromParent();
      scene.background = studioBackdrop(page, exposure);
      plant.fade.uniform.value = 1;
      scene.fog = null;
    }
    requestRender();
  }

  // Cell glow follows the light it stands for: faint at low sun, off at night.
  const DAYLIGHT: Record<string, number> = { dawn: 0.3, noon: 1, dusk: 0.25, night: 0 };

  // Camera presets: spherical angles around a target; "Dach" is a close-up of the south roof.
  const TARGET = new THREE.Vector3(1.2, 3.4, 1.0);
  const PRESETS: Record<string, { theta: number; phi: number; r?: number; target?: THREE.Vector3 }> = {
    N: { theta: Math.PI, phi: 1.2 },
    O: { theta: Math.PI / 2, phi: 1.2 },
    S: { theta: 0, phi: 1.25 },
    W: { theta: -Math.PI / 2, phi: 1.2 },
    Oben: { theta: 0, phi: 0.02 },
    Iso: { theta: 0.62, phi: 1.08 },
    Dach: { theta: 0.42, phi: 0.98, r: 19, target: new THREE.Vector3(0.2, 6.9, 2.6) },
    CarSide: { theta: Math.PI / 2, phi: 1.5, r: 9, target: new THREE.Vector3(11.2, 0.75, 3.6) },
    CarFront: { theta: 0.35, phi: 1.4, r: 9, target: new THREE.Vector3(11.2, 0.75, 3.6) },
    Auto: { theta: 0.7, phi: 1.28, r: 15, target: new THREE.Vector3(11.2, 0.75, 3.4) },
  };
  let preset = $state("Iso");

  function fitRadius(): number {
    const aspect = width / Math.max(1, height);
    const base = 42 * (view.scene === "sky" ? 0.85 : 1);
    return Math.min(78, base * Math.max(1, 1.15 / aspect) ** 0.7);
  }

  // Sky mode frames like an architectural shot: a low eye point and a shifted lens, so the horizon shows.
  let shownScene = "";
  function phiOf(name: string): number {
    const p = PRESETS[name]!;
    return view.scene === "sky" && name !== "Oben" && name !== "Dach" ? 1.3 : p.phi;
  }
  function lens(): void {
    if (view.scene === "sky") camera.setViewOffset(width, height, 0, -height * 0.1, width, height);
    else camera.clearViewOffset();
  }

  function placeCamera(name: string): void {
    const p = PRESETS[name]!;
    const t = p.target ?? TARGET;
    controls.target.copy(t);
    camera.position.setFromSpherical(new THREE.Spherical(p.r ?? fitRadius(), phiOf(name), p.theta)).add(t);
    camera.lookAt(t);
  }

  // Animation loop that runs only while something moves.
  let flight: { t0: number; from: THREE.Spherical; to: THREE.Spherical; target0: THREE.Vector3; target1: THREE.Vector3 } | undefined;
  let tintT0 = 0;
  let tinting = false;
  let frame = 0;
  const frameMs: number[] = [];

  /** Nothing is drawn before the first frame: a half-built scene would compile its shaders twice. */
  let drawable = false;
  function requestRender(): void {
    if (frame || !drawable) return;
    frame = requestAnimationFrame(loop);
  }

  function draw(): void {
    const t0 = performance.now();
    if (gtao) gtao.enabled = !view.lowPower;
    composer.render();
    // A 1 px readback blocks until the GPU is done; finish() alone may not.
    if (perf) {
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    frameMs.push(performance.now() - t0);
    if (frameMs.length > 120) frameMs.shift();
    (window as unknown as { __sceneFrameMs: number[] }).__sceneFrameMs = frameMs;
  }

  function loop(now: number): void {
    frame = 0;
    let again = false;
    if (flight) {
      ghosting = "off";
      const t = Math.min(1, (now - flight.t0) / 600);
      const e = easeInOut(t);
      const r = flight.from.radius + (flight.to.radius - flight.from.radius) * e;
      const phi = flight.from.phi + (flight.to.phi - flight.from.phi) * e;
      const theta = flight.from.theta + (flight.to.theta - flight.from.theta) * e;
      controls.target.lerpVectors(flight.target0, flight.target1, e);
      camera.position.setFromSpherical(new THREE.Spherical(r, phi, theta)).add(controls.target);
      camera.lookAt(controls.target);
      if (t < 1) again = true;
      else flight = undefined;
    }
    if (tinting) {
      const t = Math.min(1, (now - tintT0) / 400);
      const e = easeInOut(t);
      for (const [id, tw] of Object.entries(tint)) {
        tw.now = tw.from + (tw.to - tw.from) * e;
        // The cells glow amber by share of peak; the glass stays blue-black.
        plant.strings[id]!.emissiveIntensity = tw.now * tw.now * 0.1 * (DAYLIGHT[tod] ?? 1);
      }
      if (t < 1) again = true;
      else tinting = false;
    }
    draw();
    placeChips();
    if (again) requestRender();
  }

  function fly(name: string): void {
    preset = name;
    haptics.selection();
    const p = PRESETS[name]!;
    const target1 = (p.target ?? TARGET).clone();
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let theta = p.theta;
    while (theta - from.theta > Math.PI) theta -= 2 * Math.PI;
    while (theta - from.theta < -Math.PI) theta += 2 * Math.PI;
    const to = new THREE.Spherical((p.r ?? fitRadius()) * (name === "Oben" ? 1.05 : 1), phiOf(name), theta);
    if (reducedMotion()) {
      controls.target.copy(target1);
      camera.position.setFromSpherical(to).add(target1);
      camera.lookAt(target1);
      requestRender();
      return;
    }
    flight = { t0: performance.now(), from, to, target0: controls.target.clone(), target1 };
    requestRender();
  }

  // Ticks: ease string tints for ~400 ms.
  $effect(() => {
    const shares = sim.strings.map((s) => [s.id, s.kw / s.peak] as const);
    if (!live) return;
    for (const [id, share] of shares) {
      const tw = tint[id];
      if (!tw) continue;
      tw.from = tw.now;
      tw.to = share;
    }
    // Reduced motion lands on the new tint in the next frame instead of easing to it.
    tintT0 = performance.now() - (reducedMotion() ? 400 : 0);
    tinting = true;
    requestRender();
  });

  $effect(() => {
    void dark;
    void tod;
    void view.scene;
    if (live) applyLight();
  });

  $effect(() => {
    void view.lowPower;
    if (live) requestRender();
  });

  const perf = typeof location !== "undefined" && location.hash.includes("perf=1");
  const px = new Uint8Array(4);

  // Labels: project, then push apart so they never overlap, and keep them inside the canvas.
  const v = new THREE.Vector3();
  function placeChips(): void {
    if (!width || !height) return;
    const boxes = chips.map((c) => {
      v.copy(plant.anchors[c.id]).project(camera);
      const ax = (v.x * 0.5 + 0.5) * width;
      const ay = (-v.y * 0.5 + 0.5) * height;
      const el = chipEls[c.id];
      const w = el?.offsetWidth ?? 90;
      const h = el?.offsetHeight ?? 28;
      return { c, ax, ay, w, h, x: ax, y: ay - 42, hidden: v.z > 1 };
    });
    const pad = 6;
    for (let iter = 0; iter < 40; iter++) {
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const ox = (a.w + b.w) / 2 + pad - Math.abs(dx);
          const oy = (a.h + b.h) / 2 + pad - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (oy < ox) {
              const s = (dy === 0 ? (i < j ? -1 : 1) : Math.sign(dy)) * (oy / 2);
              a.y -= s;
              b.y += s;
            } else {
              const s = (dx === 0 ? 1 : Math.sign(dx)) * (ox / 2);
              a.x -= s;
              b.x += s;
            }
          }
        }
      for (const b of boxes) {
        b.x = Math.max(b.w / 2 + 8, Math.min(width - b.w / 2 - 8, b.x));
        b.y = Math.max(b.h / 2 + 8, Math.min(height - b.h / 2 - 8, b.y));
      }
    }
    for (const b of boxes) {
      b.c.ax = b.ax;
      b.c.ay = b.ay;
      b.c.x = b.x;
      b.c.y = b.y;
      b.c.hidden = b.hidden;
    }
  }

  /** Gives the main thread back between two steps of the build, so input is never held up. */
  let sliceT0 = 0;
  const pause = async (): Promise<void> => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    await (s?.yield ? s.yield() : new Promise((r) => setTimeout(r)));
    sliceT0 = performance.now();
  };
  /** Inside a loop of small steps: pauses once the current task has run for a few milliseconds. */
  const breathe = (): Promise<void> | undefined => (performance.now() - sliceT0 > 6 ? pause() : undefined);
  const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

  /**
   * Resolves once the GPU has finished what was sent to it, without waiting on it: a fence, polled.
   * Any call that asks the GPU a question (a program's first use, a read-back) blocks the main
   * thread until everything queued before it is drawn. Asked only after this, such a call returns
   * at once, on a fast GPU and under software rendering alike.
   */
  function gpuIdle(): Promise<void> {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((resolve) => {
      const poll = () => {
        if (!fence || gl.isContextLost() || gl.clientWaitSync(fence, 0, 0) !== gl.TIMEOUT_EXPIRED) {
          gl.deleteSync(fence);
          resolve();
        } else setTimeout(poll, 8);
      };
      poll();
    });
  }

  /**
   * Compiles what `object` needs without blocking, for the target the scene pass draws into.
   * Writing a program's source is main-thread work, so `parts` are prepared a few per task; the
   * GPU then compiles them in parallel and this resolves when they are ready.
   */
  async function compile(object: THREE.Object3D, parts: THREE.Object3D[] = []): Promise<void> {
    // A program differs by its target's colour space and tone mapping: compile for the composer's.
    for (const part of [...parts, object]) {
      renderer.setRenderTarget(composer.readBuffer);
      const ready = part === object ? renderer.compileAsync(object, camera, scene) : renderer.compile(part, camera, scene);
      renderer.setRenderTarget(null);
      await (part === object ? ready : breathe());
    }
  }

  /**
   * A program's first use asks the GPU for its uniforms and waits for the answer, behind whatever
   * the GPU is still drawing. Asked here, a few per task and before a frame is queued, the answer
   * is immediate.
   */
  let touched = 0;
  async function touchPrograms(gone: () => boolean): Promise<boolean> {
    const programs = renderer.info.programs ?? [];
    for (; touched < programs.length; touched++) {
      programs[touched]!.getUniforms();
      programs[touched]!.getAttributes();
      await breathe();
      if (gone()) return false;
    }
    return true;
  }

  /** One shadow pass and a scene pass into a few pixels: makes the programs only a frame creates. */
  function warmShadows(): void {
    const tiny = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(tiny);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    tiny.dispose();
  }

  function resize(): void {
    if (!host) return;
    width = host.clientWidth;
    height = host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    lens();
    camera.updateProjectionMatrix();
    if (preset) placeCamera(preset);
    requestRender();
  }

  // How long each stage of the background load took, for the smoothness journey (ADR 21).
  const stages: Record<string, number> = {};
  let loadT0 = 0;

  /** Builds the scene in short tasks. Resolves false when the component went away meanwhile. */
  async function init(gone: () => boolean): Promise<boolean> {
    const t0 = (loadT0 = performance.now());
    stages.start = Math.round(t0);
    (window as unknown as { __sceneLoad: Record<string, number> }).__sceneLoad = stages;
    const step = async (name: string): Promise<boolean> => {
      stages[name] = Math.round(performance.now() - t0);
      await pause();
      return !gone();
    };

    await warm().textures;
    if (!(await step("textures"))) return false;

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch {
      throw "webgl2";
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    // r187 dropped PCFSoftShadowMap; PCF with a radius gives the soft edge.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    pmrem = new THREE.PMREMGenerator(renderer);
    camera = new THREE.PerspectiveCamera(32, 1, 0.3, 9000);
    if (!(await step("renderer"))) return false;

    await build();
    if (!(await step("plant"))) return false;

    // Post: multisampled HDR target -> GTAO -> tone mapping and sRGB.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
    composer.addPass(new OutputPass());

    controls = new OrbitControls(camera, canvas);
    controls.target.copy(TARGET);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.addEventListener("change", requestRender);
    controls.addEventListener("start", () => {
      flight = undefined;
      preset = "";
      ghosting = "off";
    });

    const initial = typeof location !== "undefined" ? new URLSearchParams(location.hash.split("?")[1] ?? "").get("cam") : null;
    if (initial && PRESETS[initial]) preset = initial;
    resize();
    if (!(await step("post"))) return false;

    // The environment map's own programs, compiled in parallel and first used on a map of a few
    // pixels, so the real one below never waits on a compile.
    await compile(envScene);
    if (!(await touchPrograms(gone))) return false;
    pmrem.fromScene(envScene, 0, 0.1, 2000, { size: 16 }).dispose();
    if (!(await step("environment"))) return false;

    // The effects take over from here: light, sky and environment for the time of day.
    live = true;
    await tick();
    if (!(await step("light"))) return false;

    // Upload the textures one per task, then compile the programs in parallel.
    const textures = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : [])
        for (const key of ["map", "normalMap", "roughnessMap", "emissiveMap"] as const) {
          const t = (mat as THREE.MeshStandardMaterial)[key];
          if (t) textures.add(t);
        }
    });
    for (const t of textures) {
      renderer.initTexture(t);
      await breathe();
      if (gone()) return false;
    }
    if (!(await step("upload"))) return false;
    // Mesh by mesh: writing one program's source is the smallest step there is.
    const meshes: THREE.Object3D[] = [];
    plant.root.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes.push(o)));
    await compile(scene, meshes);
    // The environment map and the uploads are still being drawn: ask nothing until they are done.
    await gpuIdle();
    if (!(await touchPrograms(gone))) return false;
    if (!(await step("compile"))) return false;

    // Warm-up frames of a few pixels: the shadow pass and then every post pass create and first
    // use their programs while there is next to nothing to rasterise, so the real frame after
    // them never waits on the GPU.
    warmShadows();
    await gpuIdle();
    if (gone()) return false;
    renderer.setSize(4, 4, false);
    composer.setSize(4, 4);
    draw();
    resize();
    if (!(await step("warmup"))) return false;

    // The first frame, drawn hidden, with the tints already where they belong: the layer fades
    // in once it has been presented.
    for (const s of sim.strings) {
      const tw = tint[s.id];
      if (tw) tw.now = tw.from = tw.to = s.kw / s.peak;
    }
    tinting = true;
    tintT0 = performance.now() - 400;
    drawable = true;
    loop(performance.now());
    // Not before the GPU has drawn it: a fade over a frame still being rasterised is a cut.
    await gpuIdle();
    await nextFrame();
    if (gone()) return false;
    placeChips();
    stages.frame = Math.round(performance.now() - t0);
    shown = true;
    return true;
  }

  /** The car body: loaded once the house is on screen, then faded in on its own. */
  async function addCar(gone: () => boolean): Promise<void> {
    const { loadCar } = await import("./scene/car");
    const car = await loadCar(pause);
    if (gone()) return;
    // Compiled where it will stand, so its programs see the scene's lights and shadows.
    // Hidden until it is ready to fade in: a live tick may draw the scene meanwhile.
    car.visible = false;
    plant.car.slot.add(car);
    await compile(car);
    // Frames are still being drawn: ask the GPU nothing until it is idle, then everything at once.
    await gpuIdle();
    if (gone()) return;
    const programs = renderer.info.programs ?? [];
    for (; touched < programs.length; touched++) {
      programs[touched]!.getUniforms();
      programs[touched]!.getAttributes();
    }
    // The car's shadow program is made by its first shadow pass: run one into a few pixels, so
    // the frames below never wait for it behind a full frame.
    car.visible = plant.car.cable.visible = true;
    warmShadows();
    car.visible = plant.car.cable.visible = false;
    const fade = !motion.still && !flight && ghost !== undefined;
    if (fade) {
      // Hold the picture without the car over the canvas; the car is drawn beneath it and the
      // held picture fades out: an opacity-only crossfade, with no render loop.
      cancelAnimationFrame(frame);
      frame = 0;
      loop(performance.now());
      const still = createImageBitmap(canvas!);
      ghost!.getContext("bitmaprenderer")!.transferFromImageBitmap(await still);
      if (gone()) return;
      ghosting = "hold";
    }
    car.visible = true;
    plant.car.cable.visible = true;
    requestRender();
    stages.car = Math.round(performance.now() - loadT0);
    if (!fade) return;
    // The frame with the car must be on the canvas before the held picture starts to go.
    await nextFrame();
    await gpuIdle();
    await nextFrame();
    if (ghosting === "hold") ghosting = "fade";
  }

  onMount(() => {
    let dead = false;
    const gone = () => dead;
    const ro = new ResizeObserver(() => {
      if (live) resize();
    });
    ro.observe(host!);
    let carTimer: ReturnType<typeof setTimeout> | undefined;
    init(gone)
      .then((ok) => {
        if (!ok) return;
        onready?.();
        // After the fade, when nothing else is waiting.
        carTimer = setTimeout(() => {
          const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 50));
          idle(() => void addCar(gone).catch(() => {}), { timeout: 2000 });
        }, 450);
      })
      .catch((e: unknown) => {
        if (!dead) onerror?.(e);
      });
    return () => {
      dead = true;
      clearTimeout(carTimer);
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls?.dispose();
      composer?.dispose();
      envTarget?.dispose();
      pmrem?.dispose();
      renderer?.dispose();
    };
  });

  const strings = $derived(Object.fromEntries(sim.strings.map((s) => [s.id, s])));
  // A chip shows only when its role exists (ADR 21).
  const visibleChips = $derived(
    chips.filter((c) => (c.id === "battery" ? sim.has.battery : c.id === "ev" ? sim.has.ev : c.id === "inverter" || strings[c.id] !== undefined)),
  );
  function short(name: string): string {
    return name.replace("MPPT", "M").replace(" Süd", " S").replace(" Nord", " N");
  }
</script>

<!-- Hidden and inert until the first frame is on screen; then the whole layer fades in, labels included. -->
<div bind:this={host} class={["layer absolute inset-0 overflow-hidden", shown && "shown", motion.still && "instant"]} inert={!shown}>
  <canvas bind:this={canvas} class="absolute inset-0 size-full touch-none outline-none"></canvas>
  <canvas bind:this={ghost} class={["ghost pointer-events-none absolute inset-0 size-full", ghosting]} ontransitionend={() => (ghosting = "off")} aria-hidden="true"></canvas>
  {#if view.scene === "sky"}
    <!-- The hero figure sits over the sky; a page-colour scrim keeps it legible at any sun. -->
    <div class="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-linear-to-b from-background/85 via-background/40 to-transparent"></div>
  {/if}

  <!-- Leader lines from each marker to its chip. -->
  <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
    {#each visibleChips as c (c.id)}
      {#if !c.hidden}
        <line x1={c.ax} y1={c.ay} x2={c.x} y2={c.y} class="stroke-foreground/35" stroke-width="1" />
        <circle cx={c.ax} cy={c.ay} r="3" class="fill-background stroke-foreground/60" stroke-width="1.25" />
      {/if}
    {/each}
  </svg>

  {#each visibleChips as c (c.id)}
    <Button
      variant="ghost"
      size="sm"
      bind:ref={chipEls[c.id]}
      onclick={() => onselect?.(c.id)}
      class={[
        "glass-ambient absolute top-0 left-0 h-7 gap-1.5 px-2 text-xs ring-1 ring-border/60 elevation-1",
        c.hidden && "opacity-0",
      ]}
      style="transform: translate({c.x}px, {c.y}px) translate(-50%, -50%)"
      aria-label="Details {c.id}"
    >
      {#if c.id === "s1" || c.id === "s2" || c.id === "s3"}
        <span class="size-1.5 rounded-full bg-solar"></span>
        <Sun class="size-3.5 text-solar" />
        <span class="text-muted-foreground">{short(strings[c.id]!.name)}</span>
        <!-- A string sharing its MPPT input is an estimate (ADR 17, ADR 20). -->
        <span>{#if sim.readings[`pv.string.power[${c.id}]`]?.est}<span class="me-0.5 text-muted-foreground">≈</span>{/if}<AnimatedNumber value={strings[c.id]!.kw} digits={1} /> <span class="text-muted-foreground">kW</span></span>
      {:else if c.id === "inverter"}
        <span class="size-1.5 rounded-full bg-solar"></span>
        <Cpu class="size-3.5 text-muted-foreground" />
        <span><AnimatedNumber value={sim.inverter} /> <span class="text-muted-foreground">kW AC</span></span>
      {:else if c.id === "battery"}
        <span class="size-1.5 rounded-full bg-battery"></span>
        <BatteryCharging class="size-3.5 text-battery" />
        <span>↑ <AnimatedNumber value={sim.battery} /> <span class="text-muted-foreground">kW</span></span>
        <span class="text-muted-foreground"><AnimatedNumber value={sim.soc} digits={0} /> %</span>
      {:else}
        <span class="size-1.5 rounded-full bg-ev"></span>
        <Car class="size-3.5 text-ev" />
        <span><AnimatedNumber value={sim.ev} /> <span class="text-muted-foreground">kW</span></span>
        <span class="text-muted-foreground"><AnimatedNumber value={sim.evSoc} digits={0} /> %</span>
      {/if}
    </Button>
  {/each}

  <!-- Camera presets: one scrolling row whose edge fades where more waits (ADR 21). -->
  <div {@attach scrollFade} class="glass-ambient absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] overflow-x-auto rounded-md p-0.5 ring-1 ring-border/60 elevation-1 no-scrollbar">
    <ToggleGroup.Root type="single" size="sm" spacing={1} bind:value={() => preset, (v: string) => v && fly(v)} class="w-max" aria-label="Kamera">
      {#each Object.keys(PRESETS) as name (name)}
        <ToggleGroup.Item value={name} class="px-2 text-xs">{name}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  </div>
</div>

<style>
  /* Opacity only (ADR 21). An entrance, eased out; reduced motion and the still tier show it at once. */
  .layer {
    opacity: 0;
    transition: opacity 350ms var(--motion-ease, ease-out);
  }
  .layer.shown {
    opacity: 1;
  }
  .ghost {
    opacity: 0;
  }
  .ghost.hold {
    opacity: 1;
  }
  .ghost.fade {
    transition: opacity 350ms var(--motion-ease, ease-out);
  }
  .layer.instant,
  .layer.instant .ghost {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .layer,
    .ghost.fade {
      transition: none;
    }
  }
</style>
