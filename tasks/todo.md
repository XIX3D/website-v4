# Website v4 — Init & GSAP Scroll-Scrubbing Foundation

## Plan

### Phase 1: Project Init ✅
- [x] Initialize Next.js (App Router, TS, Tailwind, ESLint)
- [x] Install `gsap` and `@gsap/react`
- [x] Verify build compiles without errors

### Phase 2: Scroll-Scrubbing Scaffold ✅
- [x] Create `data/chapters.ts` — keyframes with `videoProgress`, `dwellStart`, `dwellEnd`
- [x] Create `components/ScrollScrubber.tsx` — canvas PNG sequence, GSAP ScrollTrigger, dwell-zone mapping
- [x] Create `components/ChapterOverlay.tsx` — text reveals per chapter
- [x] Create `hooks/useIsMobile.ts` — responsive variant selection
- [x] Wire into `app/page.tsx` via `ScrollScrubberClient` (ssr: false wrapper)
- [x] Global CSS: dark background, `overscroll-behavior: none`, no flash

### Phase 3: Mechanics (foundation) ✅
- [x] `scrollToFrameProgress()` maps scroll [0–1] → frame [0–1], clamping at dwell zones
- [x] Chapter overlays fade in during dwell windows (soft scroll-lock feel)
- [x] `prefetchWindow()` loads ±20 frames around current position
- [x] Reverse scroll reverses (ScrollTrigger + scrub default)

---

## Phase 4: Next Steps

- [ ] Deploy to Vercel — `vercel --prod` — verify live
- [ ] Test in browser: canvas renders, chapters reveal, mobile variant loads
- [ ] Tune `prefetchWindow` radius for performance
- [ ] Implement hard scroll lock at dwell zone entry (intercept wheel + touch)
- [ ] Add chapter progress bar (optional)

## Notes
- Do NOT deploy anywhere other than Vercel per global rules.
- PNG sequences (505 frames each) used directly via canvas — video files are unused fallback.

## Review
- Build: ✅ TypeScript clean, `next build` succeeds
- Files < 250 lines each, typed, immutable patterns
