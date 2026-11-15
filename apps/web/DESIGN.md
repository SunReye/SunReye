# SPA design

`src/lib/components/ui`, `theme.css`, `motion.ts` and `components.json` come from kbase `73f4cab` (ADR 11) by way of the `prototype/look-feel` branch; SunReye owns them, kbase updates are manual diffs.

Checklist for every screen ([ADR 21](../../docs/adr/0021-look-feel-and-navigation.md)):

- [ ] Built on `components/ui`, the whole shadcn-svelte registry (ADR 11); no native control outside it (`bun scripts/native-controls.ts`). `#/gallery` under `vite dev` shows every component; `bun run gallery` writes its screenshots.
- [ ] Corners from `--radius` (2 px); no component sets a larger one.
- [ ] Dark first; checked in light too.
- [ ] Glass: overlays use `glass`/`glass-modal`, rail, bar, cards and chips `glass-ambient`; nothing blurs live content.
- [ ] Opaque under `prefers-reduced-transparency` and `html[data-low-power]`.
- [ ] Brand blue marks controls only, never data; flows use the energy colours.
- [ ] A card does something; summary figures sit in a hairline strip; a list is one surface with dividers.
- [ ] No visible scrollbars; edges fade where content waits.
- [ ] Data loads before the page shows; sizes are reserved; numbers use tabular figures.
- [ ] Motion: `--motion-ease-in-out` between resting places, kbase's ease-out for entrances, ease-in exits; only `transform` and `opacity` animate; interruptible motion uses `Spring`/`Tween` or CSS transitions.
- [ ] Reduced motion and the low-power switch make everything still.
