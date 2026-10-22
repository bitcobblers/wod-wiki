# Chromecast receiver CSS — the Chromium 92 floor

The Cast Android TV receiver runs on the Cast engine's Chromium 92 (CrKey UA,
verified on a real device). The engine **silently drops** any CSS feature it
does not implement — no error, no warning, the declaration just disappears.
A layout built on a dropped declaration collapses.

Three Chromium-92 floors bite this app:

| Feature | Chrome | Effect when dropped |
|---|---|---|
| `@layer` blocks | 99 | Tailwind v4 emits every rule inside `@layer` — the receiver renders with **no styling at all** |
| Container queries (`cqw`, `container-type`) | 105 | The TV timer surface sizes its padding, gaps, clock type and buttons in `cqw` — every size vanishes, the timer has **no alignment** |
| Individual transform properties (`translate`/`rotate`/`scale`) | 104 | Tailwind v4 emits transforms as individual properties — offset and scaled elements lose their transform |
| Dynamic viewport units (`dvh`, `svh`) | 108 | Full-height panes collapse |

## The lowering pass

`apps/playground/src/build/legacyReceiverCss.ts` lowers the built receiver
stylesheet, in order:

1. **postcss**
   - unwrap `@layer` blocks in document order (single cascade order, so the
     semantics survive),
   - drop `@property` registrations,
   - drop `:has()` rules (the engine drops the whole rule anyway, including
     the other selectors in its list),
   - drop `container-type` / `container-name` (inert without container queries),
   - rewrite container-query units → viewport units (`cqw` → `vw`, `cqh` → `vh`),
   - rewrite dynamic viewport units → `vh` / `vw`,
   - fold the individual transform properties into the `transform` shorthand,
     in the order the spec applies them (translate → rotate → scale, then the
     shorthand).
2. **lightningcss** at chrome 87 — lowers `oklch`/`lab` colors to hex/rgb
   fallbacks, keeping modern values behind `@supports` upgrades.

Only declaration *values* are rewritten. Selectors keep their spelling:
Tailwind escapes units into class names (`.h-\[100dvh\]`), and those class
names have to keep matching the markup.

### `cqw` → `vw` is faithful on the receiver, not exact

The receiver's timer surface is full-bleed (`h-screen w-screen`), so its
container is the viewport and `1cqw ≈ 1vw`. A container-query unit resolves
against the container's *content* box (inside the surface's own padding)
while `vw` resolves against the viewport, so the legacy sizes land ~9% larger
on a 1280px screen. The layout is correct and nothing overflows; the scale is
a shade off the design.

## The guard

```bash
bun run check:receiver-css                       # checks the built receiver stylesheet
bun scripts/check-receiver-css-compat.cjs <file>  # checks a specific stylesheet
```

The checker parses the built stylesheet and fails when it finds a feature
Chromium 92 lacks. Support data comes from `caniuse-lite`, so the floor is
not hand-maintained. It runs in CI right after the receiver build
(`.github/workflows/_verify.yml`).

## When the timer looks wrong on the TV

1. Rebuild the receiver — the artifact the TV loads is the built one:
   `bun x vite build --config apps/playground/vite.receiver.config.ts --outDir dist`
2. Run the checker against `apps/playground/dist/assets/receiver-*.css`.
3. If the checker is clean but the layout is still off, the source is using a
   modern unit that resolves to something the engine ignores — add it to
   `UNIT_REWRITES` in `apps/playground/src/build/legacyReceiverCss.ts` and
   cover it in `legacyReceiverCss.test.ts`.
