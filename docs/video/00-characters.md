# Stable Characters & Props — wod.wiki Explainer

Every scene is rendered separately, then clipped together. These sheets are the
contract that keeps the cast identical across renders. If a render disagrees with this
document, the render is wrong.

## CHAR-1 — The Athlete ("the user")
One character for the whole video. He is the visitor: a home-gym trainee who types his
own workouts. No name, no dialogue, no mascot energy.

- **Build:** simple flat figure, ~5.5 heads tall, rounded limbs, no fingers, no facial
  detail beyond two dot eyes and a short line mouth. Silhouette must read at 10% scale.
- **Outfit (never changes):** dark charcoal tee, app-accent shorts, plain trainers.
  No logos, no headband, no watch (a watch would fight Scene 5's "phone stays down").
- **Skin/hair:** mid-tone skin, short dark hair block. Keep abstract; he is an avatar
  of the user, not a portrait of anyone.
- **Standard poses:**
  - **P1** — seated at laptop, three-quarter view, typing. (Scenes 1–2)
  - **P2** — standing, phone in one hand at waist height. (Scene 5 open)
  - **P3a / P3b** — burpee pair: standing tall / prone on floor. Two frames only,
    looped; never in-between frames. (Scene 4)
  - **P4** — close hand holding the remote, thumb on the split button. (Scene 5)
  - **P5** — standing facing the TV, back three-quarter to camera, mid-set stance.
    (Scene 5)
- **Don'ts:** no smiling/frowning arcs (mouth stays a line; emotion comes from posture
  — the Scene 1 slump is a 4° shoulder drop, nothing more). No extra characters ever.
  No photoreal rendering of the athlete in any scene.

## CHAR-2 — The Hand (whiteboard annotation only)
- A simple cartoon hand holding a thick marker; enters from the nearest board edge,
  writes/underlines, leaves. It **annotates**; it never operates the app (that's the
  Cursor's job) and never touches the Athlete.
- Marker ink: one warm red-orange (distinct from the app accent — see UI guide) so
  hand-drawn emphasis can never be mistaken for UI. Stroke width and slight wobble
  identical in every scene; max 3 annotations per scene.

## CHAR-3 — The Cursor
- Standard OS arrow, rendered at 150% with a soft shadow. Every click, in every scene,
  is identical: arrow settles → one accent-colored ripple ring expands and fades →
  the app's click state. Same ripple, same 300ms timing, same soft click sound.
- The cursor never types (text types itself, keystroke sound only) and never appears
  in gym scenes (5) — there, hands and remotes act.

## Props (fixed designs)
- **PROP-1 Laptop:** thin silver slab, screen = UI screens; wod.wiki screens only,
  generic apps only in Scene 1.
- **PROP-2 Phone:** black slab, minimal bezel; states: editor, timer, "casting" dim.
- **PROP-3 TV:** wall-mounted rectangle, thin black frame; shows UI-2 at scale.
- **PROP-4 Remote:** small dark wand, few buttons. **One** button — the split button —
  carries a permanent app-accent ring. Same button, same ring, every frame, every
  render. This prop is effectively a character; treat changes as casting changes.
- **PROP-5 Bluetooth keyboard:** compact, no numpad, space-gray; appears only in
  Scene 5's inset beat, same angle both beats.
- **PROP-6 Kettlebell silhouette:** one, in the gym wide shot, as set dressing only.

## Narrator (locked 2026-10-20: Sergei himself)
- Sergei narrates all 7 scenes in his own voice. No AI voice, no hired VO.
- Register: the founder explaining his own product — plain-spoken, coach-engineer,
  conversational pace (~150 wpm), zero hype-adjectives, no "revolutionary."
- The consistency risk moves from voice choice to recording setup: same microphone,
  same room, same distance and gain for every scene; record all seven scenes in one
  session where possible, and log the setup here before the first take:
  `MIC/SETUP: TBD — fill in at recording`.
- If a scene is ever re-recorded later, match the logged setup and A/B the first line
  against the original take before recording the rest.
- Narration scripts in the scene files are written to one sentence rhythm on purpose —
  preserve it when editing, and re-time the scene if the word count changes.
