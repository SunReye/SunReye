// PROTOTYPE: view settings shared by the route, the hero and the dev bar
// (URL: scene=studio|sky, lowPower=1, scene3d=fail|hold|nogl; the hero mode is kept per browser).
function storedHero(): "3d" | "2d" {
  try {
    return localStorage.getItem("proto.hero") === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

export const view = $state({
  scene: "studio" as "studio" | "sky",
  lowPower: false,
  hero: storedHero(),
  /** Prototype only: makes the 3D load fail, never finish, or find no WebGL2, so each state can be seen. */
  scene3d: "" as "" | "fail" | "hold" | "nogl",
});

export function setHero(mode: "3d" | "2d"): void {
  view.hero = mode;
  try {
    localStorage.setItem("proto.hero", mode);
  } catch {
    // Kept for this session only.
  }
}
