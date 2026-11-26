# 32. Views and rendering

Status: accepted (2026-11-26)

## Context

ADR 20 drew the plan and the 3D view as separate canvases with separate navigations (`orbit`, `plan`, `model`), held the plan north up, flew a phone's camera in front of a face to lay modules, and let camera effects and ambient occlusion reach the handles. Editing (ADR 31) needs one editor whose views differ only in the camera.

## Decision

**One editor, two cameras.** 2D is a camera mode of the one editor: orthographic, from above, and rotatable so an eave lies level on screen; turning it turns the camera, never the scene (ADR 30, *Coordinates*). Both views share one selection, one mode and one undo history. A host may show the 2D and the 3D camera side by side, each a canvas of the one editor.

**Navigation.** In Select (ADR 31) a drag orbits in 3D and pans in 2D; a Shift-drag and a held press on a module are ADR 31's. Carried from ADR 20 (2026-11-25): the wheel and a pinch zoom to the cursor; the middle button and Space held pan; the right button opens the menu only when released where it was pressed.

**Editor look.** The model is white. Ambient occlusion and sun shadows fall on the model only. Handles, rings, labels, outlines and every helper are drawn after the model, never in its occlusion or its shadows. Tilt-shift and depth of field are off in the editor; they belong to Home's dashboard alone (ADR 35, *Camera effects*).

**Roof view.** The Equipment filter has none. Clicking a roof face in the Module filter (ADR 31, *Filters*) switches to the roof view:
- an orthographic camera facing the face square on, its eave level at the bottom, the face filling the view with a margin;
- orbiting is locked, and placing happens in the face's plane;
- Back or Esc restores the camera as it was; clicking another face jumps to it.

It replaces ADR 20's flight in front of a face on a phone.

## Open

- **Roof view on a steep or small face.** (step 2) The margin, and what shows of the neighbouring faces.
- **2D's rotation.** (step 2) Whether the 2D camera turns to an eave by a command, by picking an edge, or freely.
- **Roof view while wiring.** (step 2) Whether the Verdrahtung filter opens the roof view, as ADR 20's phone flew onto a face to wire it.
- **Touch navigation.** (step 2) Two-finger pan and pinch are ADR 20's; whether one finger in 2D pans as a mouse drag does.

## Considered options

- **Separate navigations per canvas** (ADR 20, `orbit`, `plan`, `model`), and a studio per canvas (ADR 25, *Two views on one scene*). Replaced by one editor with two cameras.
- **A plan held north up** (ADR 20). Replaced by a 2D camera that turns to an eave.
- **Flying in front of a face on a phone** (ADR 20). Replaced by the roof view.

## Consequences

The builder's consumer no longer picks a navigation.
