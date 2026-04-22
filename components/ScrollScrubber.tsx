"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import ChapterOverlay from "@/components/ChapterOverlay"
import { useIsMobile } from "@/hooks/useIsMobile"
import {
  PAUSE_POINTS,
  TOTAL_FRAMES,
  SCROLL_MULTIPLIER,
  PAUSE_LOCK_MS,
  type PausePoint,
} from "@/data/pausePoints"

gsap.registerPlugin(ScrollTrigger, useGSAP)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad a frame index to 3 digits */
function pad(index: number): string {
  return String(index).padStart(3, "0")
}

/** Map scroll progress [0–1] to frame index [0–TOTAL_FRAMES-1] */
function scrollToFrameIndex(scrollP: number): number {
  return Math.round(scrollP * (TOTAL_FRAMES - 1))
}

/** Find which pause point (if any) a frame index falls into */
function getActivePause(
  frameIndex: number
): PausePoint | null {
  for (const pp of PAUSE_POINTS) {
    if (frameIndex === pp.frame) return pp
  }
  return null
}

// ---------------------------------------------------------------------------
// Frame cache + loader
// ---------------------------------------------------------------------------

type FrameCache = (HTMLImageElement | null)[]

function buildFrameCache(): FrameCache {
  return new Array(TOTAL_FRAMES).fill(null)
}

const CDN_BASE =
  "https://floeztbeqtdehjvurcwg.supabase.co/storage/v1/object/public/mclaren-frames"

function frameUrl(index: number, isMobile: boolean): string {
  const p = pad(index)
  if (isMobile) {
    return `${CDN_BASE}/mobile/Zeno Home Page Mobile SLOWED${p}.webp`
  }
  return `${CDN_BASE}/horizontal/Zeno Home Page Desktop SLOWER${p}.webp`
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
    img.src = frameUrl(index, isMobile)
  })
}

function prefetchWindow(
  currentIndex: number,
  cache: FrameCache,
  isMobile: boolean,
  radius = 30
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
// Progress dots
// ---------------------------------------------------------------------------

function ProgressDots({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-3 pointer-events-none">
      {PAUSE_POINTS.map((pp, i) => {
        const active = activeIndex === pp.frame
        return (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full transition-all duration-500"
            style={{
              background: active
                ? "rgba(255,255,255,0.95)"
                : activeIndex > pp.frame
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
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const frameCacheRef = useRef<FrameCache>(buildFrameCache())
  const currentFrameRef = useRef(0)

  // Pause lock state
  const isLockedRef = useRef(false)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingScrollRef = useRef<number | null>(null)

  const [activePause, setActivePause] = useState<PausePoint | null>(null)
  const [scrollP, setScrollP] = useState(0)

  // Hide body scrollbar for the page
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Reset cache on mobile/desktop switch
  useEffect(() => {
    frameCacheRef.current = buildFrameCache()
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Canvas draw
  // ---------------------------------------------------------------------------
  const drawFrame = useCallback(
    (index: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cache = frameCacheRef.current

      const draw = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const cw = canvas.width
        const ch = canvas.height
        const scale = Math.max(cw / iw, ch / ih)
        ctx.drawImage(img, 0, 0, iw * scale, ih * scale)
      }

      if (cache[index]) {
        draw(cache[index]!)
      } else {
        loadFrame(index, cache, isMobile).then(draw).catch(() => undefined)
      }
    },
    [isMobile]
  )

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

  // Preload first frames
  useEffect(() => {
    prefetchWindow(0, frameCacheRef.current, isMobile, 40)
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Release lock after dwell timeout
  // ---------------------------------------------------------------------------
  const releaseLock = useCallback(() => {
    isLockedRef.current = false
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
    lockTimerRef.current = null
    // Apply pending scroll if one accumulated
    if (pendingScrollRef.current !== null && sectionRef.current) {
      const targetY =
        sectionRef.current.offsetTop +
        pendingScrollRef.current * (sectionRef.current.offsetHeight - window.innerHeight)
      window.scrollTo({ top: targetY })
      pendingScrollRef.current = null
    }
  }, [])

  // ---------------------------------------------------------------------------
  // GSAP ScrollTrigger — scrub drives frame index
  // ---------------------------------------------------------------------------
  useGSAP(
    () => {
      if (!sectionRef.current) return

      let lastPauseFrame: number | null = null

      const st = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: `+=${window.innerHeight * SCROLL_MULTIPLIER}`,
        scrub: true, // native feel, smooth interpolation
        onUpdate: (self) => {
          const sp = self.progress // 0–1

          // --- Lock logic ---
          if (isLockedRef.current && pendingScrollRef.current === null) {
            // User is trying to scroll while locked — store intent and clamp
            pendingScrollRef.current = sp
            // Clamp back to the locked pause frame
            if (lastPauseFrame !== null) {
              const clampedProgress = lastPauseFrame / (TOTAL_FRAMES - 1)
              // Force back by setting progress on the trigger
              st.scroll(
                st.start +
                  clampedProgress * (st.end - st.start)
              )
            }
            return
          }

          const rawFrame = scrollToFrameIndex(sp)
          const pause = getActivePause(rawFrame)

          if (pause) {
            // Enforce the exact pause frame
            const pauseProgress = pause.frame / (TOTAL_FRAMES - 1)
            if (lastPauseFrame !== pause.frame) {
              // Just entered this pause
              lastPauseFrame = pause.frame
              isLockedRef.current = true
              setActivePause(pause)
              setScrollP(sp)

              // Snap to pause frame
              st.scroll(
                st.start + pauseProgress * (st.end - st.start)
              )

              // Draw the locked frame
              currentFrameRef.current = pause.frame
              drawFrame(pause.frame)
              prefetchWindow(pause.frame, frameCacheRef.current, isMobile)

              // Start unlock timer
              if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
              lockTimerRef.current = setTimeout(releaseLock, PAUSE_LOCK_MS)
            }
            pendingScrollRef.current = null
          } else {
            lastPauseFrame = null
            pendingScrollRef.current = null
            if (!isLockedRef.current) {
              setActivePause(null)
              setScrollP(sp)

              if (rawFrame !== currentFrameRef.current) {
                currentFrameRef.current = rawFrame
                drawFrame(rawFrame)
                prefetchWindow(rawFrame, frameCacheRef.current, isMobile)
              }
            }
          }
        },
      })

      return () => st.kill()
    },
    { scope: sectionRef, dependencies: [isMobile, drawFrame, releaseLock] }
  )

  // ---------------------------------------------------------------------------
  // Wheel handler: absorb wheel events during lock
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (isLockedRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener("wheel", onWheel, { passive: false })
    return () => window.removeEventListener("wheel", onWheel)
  }, [releaseLock])

  const sectionHeight = `${(SCROLL_MULTIPLIER + 1) * 100}vh`

  return (
    <section
      ref={sectionRef}
      style={{ height: sectionHeight }}
      className="relative bg-black"
    >
      {/* Sticky canvas stage */}
      <div
        className="sticky top-0 w-full overflow-hidden"
        style={{ height: "100vh" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: "block" }}
        />

        {/* Chapter text overlay */}
        <ChapterOverlay pause={activePause} />

        {/* Progress dots */}
        <ProgressDots
          activeIndex={activePause ? activePause.frame : -1}
        />

        {/* Scroll hint (only before first pause) */}
        {scrollP < 0.02 && (
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
