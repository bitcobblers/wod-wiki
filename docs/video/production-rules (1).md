# Production Rules — wod.wiki Explainer

Scenes are rendered individually and clipped together. These rules are what makes
seven separate renders feel like one film.

## Canvas & framing
- Master: 16:9, 1920×1080. Landing-page embed may crop to a shorter player, never
  reframe scenes.
- Total assembled runtime: ≈1:33 (90-second class). Per-scene durations are locked in
  the outline timeline; a narration re-take that changes a scene's length by more than
  a second means re-timing that scene's animation spec, not stretching the edit.
- Board background = app page background (see UI guide). No vignettes, no paper
  texture, no drop shadows on the board itself.
- Safe margin 96px on all sides; no text, chip, or annotation crosses it.
- Camera: locked-off per scene; the only moves allowed are slow push-ins/pull-backs
  on the board's plane. One move per scene, except Scene 3 (the statement zoom),
  which is granted two. No pans across scenes, no 3D moves, no handheld shake.

## Transitions (identical everywhere)
- **Scene 2 → 3 → 4 is one continuous shot** rendered in three pieces: the block may
  not move, resize, or restyle across the seams; Scene 4's first frame must equal
  Scene 3's last frame.
- All other cuts are hard cuts on a settled frame (nothing mid-motion at a seam),
  except Scene 6 → 7 (pull-back reveal) as written in the scene files.
- Clicks: the CHAR-3 ripple + click sound is the only "UI transition effect." No
  swooshes, sparkles, or screen flashes anywhere.

## Annotation system
- Marker annotations (CHAR-2) are for emphasis only: underlines, one bracket set in
  Scene 3, short phrases (≤5 words). Max 3 per scene. Marker ink never labels UI
  permanently — if a label must persist, it's app text (Inter/JetBrains Mono).
- Arrows point; they never cross the Athlete or the timer digits.

## Audio
- One narrator: Sergei (see `characters.md`). Same mic, room, distance, and gain in
  all scenes; record in one session where possible, and use the logged setup for any
  re-take. VO is mixed over a single shared music bed — same track, same level
  (−18 dB under VO) for the whole film; music never swells except a slight lift under
  Scene 7's end card.
- **Sound effects are the app's own:** the timer bell is the actual bell sound from
  the build; the click is one recorded click reused everywhere; keystrokes in Scene 2
  are one sample set. Borrowed stock SFX are a consistency break.
- Silence is allowed: Scene 1's final beat and Scene 6's settle use it on purpose.

## Files & naming
- Renders: `scene-0N-<slug>-v<k>.mp4` beside the scene's `.md` file in `scenes/`.
- Masters + the assembled cut live in this folder: `explainer-master-v<k>.mp4`.
- Any change to a canonical asset (characters, UI guide, dataset T-1) bumps a note in
  that file's header and triggers a re-check of every scene that uses it.

## Per-render consistency checklist (run before accepting any scene)
- [ ] Athlete proportions, outfit, and pose match `characters.md`
- [ ] Any workout text parses under the real grammar; numbers match dataset T-1
- [ ] UI screens traced from the current build (Inter / JetBrains Mono, accent sampled)
- [ ] Clicks use the standard ripple + click; bell is the app's bell
- [ ] ≤3 marker annotations, correct ink color, ≤5 words each
- [ ] One camera move (two for Scene 3); seams land on settled frames
- [ ] VO is the locked narrator voice/settings; music bed level unchanged
- [ ] Scene's first/last frames match its neighbors' continuity notes
