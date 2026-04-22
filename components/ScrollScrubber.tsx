"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import ChapterOverlay from "@/components/ChapterOverlay"
import { useIsMobile } from "@/hooks/useIsMobile"
import { CHAPTERS, SCROLL_MULTIPLIER, TOTAL_FRAMES, type Chapter } from "@/data/chapters"

gsap.registerPlugin(ScrollTrigger, useGSAP)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a scroll progress [0–1] to a normalized video/frame progress [0–1],
 * clamping at dwell zones so the animation pauses at keyframes.
 */
function scrollToFrameProgress(scrollP: number): number {
  let frameP = scrollP

  for (const ch of CHAPTERS) {
    if (scrollP >= ch.dwellStart && scrollP <= ch.dwellEnd) {
      // Inside dwell — lock to chapter's keyframe
      return ch.videoProgress
    }
    if (scrollP > ch.dwellEnd) {
      // Past this dwell: we need to compress the remaining play zones.
      // The dead scroll space of all preceding dwells shifts the mapping.
    }
  }

  // Remap play zones: strip out dwell widths accumulated so far.
  // Total dwell width = CHAPTERS.length * dwell_per_chapter
  // We compute effective play progress by subtracting passed-dwell time.
  let accumulatedDwell = 0
  let prevChVideoP = 0
  let prevChDwellEnd = 0

  for (const ch of CHAPTERS) {
    const dwellWidth = ch.dwellEnd - ch.dwellStart

    if (scrollP < ch.dwellStart) {
      // In a play zone leading to this chapter
      const playStart = prevChDwellEnd
      const playEnd = ch.dwellStart
      const playWidth = playEnd - playStart
      const videoPlayWidth = ch.videoProgress - prevChVideoP
      const t = (scrollP - playStart) / playWidth
      return prevChVideoP + t * videoPlayWidth
    }

    accumulatedDwell += dwellWidth
    prevChVideoP = ch.videoProgress
    prevChDwellEnd = ch.dwellEnd
  }

  // Final play zone (after last chapter's dwell to scroll end)
  const lastCh = CHAPTERS[CHAPTERS.length - 1]
  const playStart = lastCh.dwellEnd
  const playWidth = 1 - playStart
  const videoPlayWidth = 1 - lastCh.videoProgress
  const t = Math.min((scrollP - playStart) / playWidth, 1)
  return lastCh.videoProgress + t * videoPlayWidth
}

/** Return the chapter whose dwell zone contains scrollP, or null */
function getActiveChapter(scrollP: number): Chapter | null {
  return CHAPTERS.find(
    (ch) => scrollP >= ch.dwellStart && scrollP <= ch.dwellEnd
  ) ?? null
}

/** Clamp a number between lo and hi */
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// PNG sequence loader
// ---------------------------------------------------------------------------

type FrameCache = (HTMLImageElement | null)[]

function buildFrameCache(total: number): FrameCache {
  return new Array(total).fill(null)
}

const CDN_BASE = "https://floeztbeqtdehjvurcwg.supabase.co/storage/v1/object/public/mclaren-frames"

function framePath(index: number, isMobile: boolean): string {
  const padded = String(index).padStart(3, "0")
  if (isMobile) {
    return `${CDN_BASE}/mobile/Zeno Home Page Mobile SLOWED${padded}.png`
  }
  return `${CDN_BASE}/horizontal/Zeno Home Page Desktop SLOWER${padded}.png`
}

function loadFrame(
  index: number,
  cache: FrameCache,
  isMobile: boolean
): Promise<HTMLImageElement> {
  if (cache[index]) return Promise.resolve(cache[index]!)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      cache[index] = img
      resolve(img)
    }
    img.onerror = reject
    img.src = framePath(index, isMobile)
  })
}

/** Eagerly pre-load a window of frames around the current index */
function prefetchWindow(
  currentIndex: number,
  cache: FrameCache,
  isMobile: boolean,
  radius = 20
) {
  const lo = Math.max(0, currentIndex - radius)
  const hi = Math.min(TOTAL_FRAMES - 1, currentIndex + radius)
  for (let i = lo; i <= hi; i++) {
    if (!cache[i]) {
      loadFrame(i, cache, isMobile).catch(() => undefined)
    }
  }
}

// ---------------------------------------------------------------------------
// Progress bar component
// ---------------------------------------------------------------------------

function ProgressDots({ scrollP }: { scrollP: number }) {
  return (
    <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-3 pointer-events-none">
      {CHAPTERS.map((ch) => {
        const active = scrollP >= ch.dwellStart && scrollP <= ch.dwellEnd
        const passed = scrollP > ch.dwellEnd
        return (
          <div
            key={ch.id}
            className="w-1.5 h-1.5 rounded-full transition-all duration-300"
            style={{
              background: active
                ? "rgba(255,255,255,0.95)"
                : passed
                ? "rgba(255,255,255,0.4)"
                : "rgba(255,255,255,0.15)",
              transform: active ? "scale(1.8)" : "scale(1)",
            }}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScrollScrubber() {
  const isMobile = useIsMobile()
  const sectionRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const frameCacheRef = useRef<FrameCache>(buildFrameCache(TOTAL_FRAMES))
  const currentFrameRef = useRef(0)
  const scrollPRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const isScrollLockedRef = useRef(false)
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null)
  const [scrollP, setScrollP] = useState(0)

  // Reset cache when orientation changes
  useEffect(() => {
    frameCacheRef.current = buildFrameCache(TOTAL_FRAMES)
  }, [isMobile])

  // Draw a frame to canvas
  const drawFrame = useCallback(
    (index: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cache = frameCacheRef.current

      const draw = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Cover-fit: maintain aspect ratio, fill canvas
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const cw = canvas.width
        const ch = canvas.height
        const scale = Math.max(cw / iw, ch / ih)
        const sw = iw * scale
        const sh = ih * scale
        const ox = (cw - sw) / 2
        const oy = (ch - sh) / 2
        ctx.drawImage(img, ox, oy, sw, sh)
      }

      if (cache[index]) {
        draw(cache[index]!)
      } else {
        loadFrame(index, cache, isMobile).then(draw).catch(() => undefined)
      }
    },
    [isMobile]
  )

  // Resize canvas to match window
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    drawFrame(currentFrameRef.current)
  }, [drawFrame])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    return () => window.removeEventListener("resize", resizeCanvas)
  }, [resizeCanvas])

  // Preload first ~30 frames immediately
  useEffect(() => {
    prefetchWindow(0, frameCacheRef.current, isMobile, 30)
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Scroll lock: freeze body scroll when entering a dwell zone
  // Releases after the user scrolls again (via wheel/touch)
  // ---------------------------------------------------------------------------
  const releaseLock = useCallback(() => {
    isScrollLockedRef.current = false
    if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current)
  }, [])

  useEffect(() => {
    // Wheel handler: allow scroll to break out of dwell lock
    const onWheel = (e: WheelEvent) => {
      if (isScrollLockedRef.current) {
        // Absorb first wheel tick within dwell to "acknowledge" the pause
        // then release so subsequent ticks scroll normally
        releaseLock()
      }
    }
    window.addEventListener("wheel", onWheel, { passive: true })
    return () => window.removeEventListener("wheel", onWheel)
  }, [releaseLock])

  // ---------------------------------------------------------------------------
  // GSAP ScrollTrigger: drives progress
  // ---------------------------------------------------------------------------
  useGSAP(
    () => {
      if (!sectionRef.current) return

      const progressObj = { value: 0 }

      const st = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: `+=${window.innerHeight * SCROLL_MULTIPLIER}`,
        scrub: 1.5,
        onUpdate: (self) => {
          const sp = clamp(self.progress, 0, 1)
          scrollPRef.current = sp
          setScrollP(sp)

          const fp = scrollToFrameProgress(sp)
          const frameIndex = clamp(
            Math.round(fp * (TOTAL_FRAMES - 1)),
            0,
            TOTAL_FRAMES - 1
          )

          if (frameIndex !== currentFrameRef.current) {
            currentFrameRef.current = frameIndex
            drawFrame(frameIndex)
            prefetchWindow(frameIndex, frameCacheRef.current, isMobile)
          }

          const chapter = getActiveChapter(sp)
          setActiveChapter(chapter)

          // Engage lock when first entering a dwell zone
          if (chapter && !isScrollLockedRef.current) {
            isScrollLockedRef.current = true
            // Auto-release after 800ms so user doesn't get stuck
            if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current)
            lockTimeoutRef.current = setTimeout(releaseLock, 800)
          }
        },
      })

      return () => st.kill()
    },
    { scope: sectionRef, dependencies: [isMobile, drawFrame, releaseLock] }
  )

  const sectionHeight = `${(SCROLL_MULTIPLIER + 1) * 100}vh`

  return (
    <section
      ref={sectionRef}
      style={{ height: sectionHeight }}
      className="relative bg-black"
    >
      {/* Sticky viewport-height stage */}
      <div
        ref={stickyRef}
        className="sticky top-0 w-full overflow-hidden"
        style={{ height: "100vh" }}
      >
        {/* Canvas: renders current PNG frame */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: "block" }}
        />

        {/* Dark gradient to improve text legibility */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)",
          }}
        />

        {/* Chapter text overlay */}
        <ChapterOverlay chapter={activeChapter} dwellProgress={0} />

        {/* Navigation dots */}
        <ProgressDots scrollP={scrollP} />

        {/* Scroll hint (only before first chapter) */}
        {scrollP < CHAPTERS[0].dwellStart && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
            <span className="text-white/40 text-xs uppercase tracking-widest">
              Scroll
            </span>
            <span className="block w-px h-8 bg-white/20 animate-pulse" />
          </div>
        )}
      </div>
    </section>
  )
}
