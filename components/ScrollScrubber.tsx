"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { gsap } from "gsap"
import { useIsMobile } from "@/hooks/useIsMobile"
import {
  PAUSE_POINTS,
  TOTAL_FRAMES,
  SCROLL_MULTIPLIER,
  PAUSE_LOCK_MS,
  type PausePoint,
} from "@/data/pausePoints"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(index: number): string {
  return String(index).padStart(3, "0")
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function getActivePause(frameIndex: number): PausePoint | null {
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
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const frameCacheRef = useRef<FrameCache>(buildFrameCache())
  const currentFrameRef = useRef(0)
  const progressRef = useRef(0) // 0–1 virtual scroll progress
  const rafRef = useRef<number | null>(null)
  const isLockedRef = useRef(false)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetProgressRef = useRef(0)

  const [activePause, setActivePause] = useState<PausePoint | null>(null)

  // Hide all scrollbars site-wide
  useEffect(() => {
    const style = document.createElement("style")
    style.textContent = `
      html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
    `
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
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
      if (!cache[index]) return

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const img = cache[index]!
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      const scale = Math.max(canvas.width / iw, canvas.height / ih)
      ctx.drawImage(img, 0, 0, iw * scale, ih * scale)
    },
    []
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
  // Update display from current progressRef
  // ---------------------------------------------------------------------------
  const syncToProgress = useCallback(
    (rawProgress: number) => {
      const frameIndex = clamp(
        Math.round(rawProgress * (TOTAL_FRAMES - 1)),
        0,
        TOTAL_FRAMES - 1
      )

      if (frameIndex !== currentFrameRef.current) {
        currentFrameRef.current = frameIndex
        drawFrame(frameIndex)
        prefetchWindow(frameIndex, frameCacheRef.current, isMobile)
      }
    },
    [drawFrame, isMobile]
  )

  // ---------------------------------------------------------------------------
  // Wheel handler — pure wheel-to-progress, no native scroll
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const WHEEL_SENSITIVITY = 0.0008 // smaller = slower scroll

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (isLockedRef.current) return

      const delta = e.deltaY * WHEEL_SENSITIVITY
      const newProgress = clamp(progressRef.current + delta, 0, 1)
      progressRef.current = newProgress
      targetProgressRef.current = newProgress

      const frameIndex = Math.round(newProgress * (TOTAL_FRAMES - 1))
      const pause = getActivePause(frameIndex)

      if (pause) {
        // Lock to this pause frame
        isLockedRef.current = true
        progressRef.current = pause.frame / (TOTAL_FRAMES - 1)
        targetProgressRef.current = progressRef.current
        currentFrameRef.current = pause.frame
        drawFrame(pause.frame)
        prefetchWindow(pause.frame, frameCacheRef.current, isMobile)
        setActivePause(pause)

        // Auto-unlock after dwell timeout
        if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
        lockTimerRef.current = setTimeout(() => {
          isLockedRef.current = false
        }, PAUSE_LOCK_MS)
      } else {
        setActivePause(null)
        if (frameIndex !== currentFrameRef.current) {
          currentFrameRef.current = frameIndex
          drawFrame(frameIndex)
          prefetchWindow(frameIndex, frameCacheRef.current, isMobile)
        }
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener("wheel", onWheel, { passive: false })
      return () => container.removeEventListener("wheel", onWheel)
    }
  }, [drawFrame, isMobile])

  // ---------------------------------------------------------------------------
  // Render loop for smooth animation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const current = progressRef.current
      // Smooth interpolation toward target
      const delta = (targetProgressRef.current - current) * 0.12
      if (Math.abs(delta) > 0.0001) {
        progressRef.current = clamp(current + delta, 0, 1)
        syncToProgress(progressRef.current)
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [syncToProgress])

  return (
    <div
      ref={containerRef}
      className="relative bg-black select-none"
      style={{
        height: `${(SCROLL_MULTIPLIER + 1) * 100}vh`,
        cursor: "default",
        touchAction: "none",
      }}
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

        {/* Chapter text overlay */}
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
                <button
                  className="
                    pointer-events-auto
                    border border-white/30 rounded-full
                    px-6 py-2.5 text-sm font-medium tracking-wider
                    hover:bg-white hover:text-black transition-colors duration-300
                    cursor-pointer
                  "
                >
                  Learn More
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Progress dots */}
        <ProgressDots
          activeIndex={activePause ? activePause.frame : -1}
        />

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
          <span className="text-white/40 text-xs uppercase tracking-widest">
            Scroll
          </span>
          <span className="block w-px h-8 bg-white/20 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
