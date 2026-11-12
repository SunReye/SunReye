// The scene's background load in short tasks (ADR 20 Loading), ported from the prototype: the main
// thread is given back between steps, and the GPU is asked nothing until it is idle.
import {
  HalfFloatType,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { Studio } from "./studio.ts";

/** When the current task started, for `breathe`. */
let sliceStart = 0;

interface Yielding {
  readonly scheduler?: { readonly yield?: () => Promise<void> };
}

/** Gives the main thread back, so input is never held up. */
export async function pause(): Promise<void> {
  const { scheduler }: Yielding = globalThis;

  await (scheduler?.yield === undefined
    ? new Promise((resolve) => {
        setTimeout(resolve);
      })
    : scheduler.yield());
  sliceStart = performance.now();
}

/** Inside a run of small steps: pauses once the current task has run a few milliseconds. */
async function breathe(): Promise<void> {
  if (performance.now() - sliceStart > 6) await pause();
}

/** Runs `step` on each item, a few per task; false once `gone`. */
export async function sliced<T>(
  items: readonly T[],
  step: (item: T) => void,
  gone: () => boolean,
): Promise<boolean> {
  const [first, ...rest] = items;

  if (first === undefined) return !gone();

  step(first);
  await breathe();

  return gone() ? false : sliced(rest, step, gone);
}

/** Runs `run` once the main thread has nothing better to do, `timeout` ms at the latest. */
export function idle(run: () => void, timeout: number): void {
  if ("requestIdleCallback" in globalThis) requestIdleCallback(run, { timeout });
  else setTimeout(run, 50);
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Resolves once the GPU has finished what was sent to it, without waiting on it: a fence, polled.
 * A call that asks the GPU a question (a program's first use, a read-back) blocks the main thread
 * until everything queued before it is drawn; asked after this, it returns at once.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's renderer.
export function gpuIdle(renderer: WebGLRenderer): Promise<void> {
  const gl = renderer.getContext();

  if (!(gl instanceof WebGL2RenderingContext)) return Promise.resolve();

  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);

  gl.flush();

  return new Promise((resolve) => {
    const poll = (): void => {
      if (
        fence === null ||
        gl.isContextLost() ||
        gl.clientWaitSync(fence, 0, 0) !== gl.TIMEOUT_EXPIRED
      ) {
        gl.deleteSync(fence);
        resolve();
      } else setTimeout(poll, 8);
    };

    poll();
  });
}

/** What a scene draws: its meshes and their materials. */
interface Drawn {
  readonly parts: Object3D[];
  readonly materials: unknown[];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene.
function drawn(root: Object3D): Drawn {
  const parts: Object3D[] = [];
  const materials: unknown[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part.
  root.traverse((part) => {
    if (part instanceof Mesh) {
      const material: unknown = part.material;

      parts.push(part);
      materials.push(...[material].flat());
    }
  });

  return { parts, materials };
}

/** Every texture the materials use. */
function textures(materials: readonly unknown[]): Texture[] {
  const found = new Set<Texture>();

  for (const material of materials) {
    if (material instanceof MeshStandardMaterial) {
      const { map, normalMap, roughnessMap, emissiveMap } = material;

      for (const texture of [map, normalMap, roughnessMap, emissiveMap]) {
        if (texture !== null) found.add(texture);
      }
    }
  }

  return [...found];
}

/** Programs whose first use was asked for already, by renderer. */
const touched = new WeakMap<WebGLRenderer, number>();

/**
 * Compiles and first uses what the studio's scene added since, mesh by mesh, and draws its shadow
 * once, small: the frame after it never waits on a compile. False once `gone`.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
export async function ahead(studio: Studio, gone: () => boolean): Promise<boolean> {
  const { renderer, scene } = studio;

  // Writing one program's source is the smallest step there is.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js compiles it.
  const compile = (part: Object3D): void => {
    studio.compile(part);
  };

  if (!(await sliced(drawn(scene).parts, compile, gone))) return false;

  await studio.compileAsync();
  await gpuIdle(renderer);

  // A program's first use asks the GPU for its uniforms and waits behind whatever it still draws.
  const programs = renderer.info.programs ?? [];
  const from = touched.get(renderer) ?? 0;

  touched.set(renderer, programs.length);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's program.
  const first = (program: (typeof programs)[number]): void => {
    program.getUniforms();
    program.getAttributes();
  };

  if (!(await sliced(programs.slice(from), first, gone))) return false;

  // One shadow pass and a scene pass into a few pixels: the programs only a frame creates.
  const tiny = new WebGLRenderTarget(4, 4, { type: HalfFloatType });

  renderer.setRenderTarget(tiny);
  renderer.render(scene, studio.camera);
  renderer.setRenderTarget(null);
  tiny.dispose();
  await gpuIdle(renderer);

  return !gone();
}

/**
 * Readies everything the studio's first frame needs, in short tasks: the environment, the
 * textures' uploads, every program, and a warm-up frame of a few pixels. False once `gone`.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
export async function prepare(studio: Studio, gone: () => boolean): Promise<boolean> {
  await studio.environ();
  await pause();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js uploads it.
  const upload = (texture: Texture): void => {
    studio.renderer.initTexture(texture);
  };

  if (!(await sliced(textures(drawn(studio.scene).materials), upload, gone))) return false;

  if (!(await ahead(studio, gone))) return false;

  // The post passes make and first use their programs on next to nothing to rasterise.
  studio.warm();
  await gpuIdle(studio.renderer);

  return !gone();
}
