"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useIsMobile } from "@/hooks/useIsMobile"
import {
  PAUSE_POINTS,
  TOTAL_FRAMES,
  SCROLL_MULTIPLIER,
  PAUSE_LOCK_MS,
  type PausePoint,
} from "@/data/pausePoints"

function pad(index: number): string {
  return String(index).padStart(3, "0")
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// Frame cache
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
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const frameCacheRef = useRef<FrameCache>(buildFrameCache())
  const currentFrameRef = useRef(0)

  // Playback state — all driven by scroll accumulation
  const scrollAccumRef = useRef(0)     // accumulated wheel delta (positive = forward)
  const isLockedRef = useRef(false)    // pause lock — wheel is blocked
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartYRef = useRef<number | null>(null)

  const [activePause, setActivePause] = useState<PausePoint | null>(null)
  const [scrollStarted, setScrollStarted] = useState(false)

  // Hide scrollbars globally
  useEffect(() => {
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = ""
      document.body.style.overflow = ""
    }
  }, [])

  useEffect(() => {
    frameCacheRef.current = buildFrameCache()
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Draw a frame
  // ---------------------------------------------------------------------------
  const drawFrame = useCallback(
    (index: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cache = frameCacheRef.current
      const doDraw = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const scale = Math.max(canvas.width / iw, canvas.height / ih)
        ctx.drawImage(img, 0, 0, iw * scale, ih * scale)
      }
      if (cache[index]) {
        doDraw(cache[index]!)
      } else {
        loadFrame(index, cache, isMobile).then(doDraw).catch(() => undefined)
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

  useEffect(() => {
    prefetchWindow(0, frameCacheRef.current, isMobile, 40)
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Advance one frame (called by RAF during playback)
  // ---------------------------------------------------------------------------
  const advanceFrame = useCallback(
    (direction: 1 | -1) => {
      if (isLockedRef.current) return

      const next = clamp(currentFrameRef.current + direction, 0, TOTAL_FRAMES - 1)
      currentFrameRef.current = next
      drawFrame(next)
      prefetchWindow(next, frameCacheRef.current, isMobile)

      // Check if we've landed on a pause frame
      const isPause = PAUSE_POINTS.some((pp) => pp.frame === next)
      if (isPause) {
        isLockedRef.current = true
        const pp = PAUSE_POINTS.find((p) => p.frame === next)!
        setActivePause(pp)
        scrollAccumRef.current = 0

        if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
        lockTimerRef.current = setTimeout(() => {
          isLockedRef.current = false
        }, PAUSE_LOCK_MS)
      } else {
        setActivePause(null)
      }
    },
    [drawFrame, isMobile]
  )

  // ---------------------------------------------------------------------------
  // RAF playback loop — smooth, continuous frame stepping driven by accumulator
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let lastTime = 0
    const FRAME_STEP_PX = 80 // pixels of wheel delta per frame step

    const loop = (time: number) => {
      if (!isLockedRef.current && scrollAccumRef.current !== 0) {
        // Determine how many frames to advance this tick
        const framesToStep = Math.floor(Math.abs(scrollAccumRef.current) / FRAME_STEP_PX)

        if (framesToStep > 0) {
          const dir: 1 | -1 = scrollAccumRef.current > 0 ? 1 : -1
          // Cap at 3 frames per RAF tick for smooth fast scrolling
          for (let i = 0; i < Math.min(framesToStep, 3); i++) {
            advanceFrame(dir)
          }
          // Decay the accumulator
          scrollAccumRef.current -= dir * framesToStep * FRAME_STEP_PX
        }
      }
      lastTime = time
      requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
  }, [advanceFrame])

  // ---------------------------------------------------------------------------
  // Wheel → accumulate scroll distance (no direct frame jumping)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScrollStarted(true)

      if (isLockedRef.current) return

      // Accumulate — no clamping so fast scrolls carry momentum
      scrollAccumRef.current += e.deltaY
    }

    window.addEventListener("wheel", onWheel, { passive: false })
    return () => window.removeEventListener("wheel", onWheel)
  }, [])

  // ---------------------------------------------------------------------------
  // Touch → same accumulation pattern
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (isLockedRef.current) return
      if (touchStartYRef.current === null) return
      const delta = touchStartYRef.current - e.touches[0].clientY
      touchStartYRef.current = e.touches[0].clientY
      setScrollStarted(true)
      scrollAccumRef.current += delta
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
    }
  }, [])

  return (
    <div
      className="relative bg-black select-none"
      style={{ height: `${SCROLL_MULTIPLIER * 100}vh`, touchAction: "none" }}
    >
      <div
        className="sticky top-0 w-full overflow-hidden"
        style={{ height: "100vh" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: "block" }}
        />

        {activePause && (
          <div className="absolute inset-0 flex items-end justify-start pointer-events-none">
            <div className="mb-16 ml-10 md:ml-20 max-w-xl text-white">
              {activePause.eyebrow && (
                <p className="text-sm md:text-base uppercase tracking-[0.3em] text-white/60 mb-2 font-medium">
                  {activePause.eyebrow}
                </p>
              )}
              <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-none mb-3">
                {activePause.title}
              </h2>
              <p className="text-base md:text-lg text-white/65 leading-relaxed font-light max-w-sm">
                {activePause.body}
              </p>
              <div className="mt-5">
                <button className="pointer-events-auto border border-white/30 rounded-full px-6 py-2.5 text-sm font-medium tracking-wider hover:bg-white hover:text-black transition-colors duration-300 cursor-pointer">
                  Learn More
                </button>
              </div>
            </div>
          </div>
        )}

        <ProgressDots activeIndex={activePause ? activePause.frame : -1} />

        {!scrollStarted && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
            <span className="text-white/40 text-xs uppercase tracking-widest">Scroll</span>
            <span className="block w-px h-8 bg-white/20 animate-pulse" />
          </div>
        )}
      </div>
    </div>
  )
}
