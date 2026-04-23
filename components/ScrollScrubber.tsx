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
  isMobile: boolean,
  retries = 3,
  delayMs = 300
): Promise<HTMLImageElement> {
  if (cache[index]) return Promise.resolve(cache[index]!)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = frameUrl(index, isMobile)
    img.onload = () => {
      cache[index] = img
      resolve(img)
    }
    img.onerror = () => {
      if (retries > 0) {
        setTimeout(() => {
          loadFrame(index, cache, isMobile, retries - 1, delayMs * 2)
            .then(resolve)
            .catch(reject)
        }, delayMs)
      } else {
        reject(new Error(`Failed to load frame ${index} after retries`))
      }
    }
  })
}

/**
 * Load a frame, retry on failure, and return the best available frame.
 * If the target frame can't load, try nearest neighbors.
 */
function loadFrameWithFallback(
  index: number,
  cache: FrameCache,
  isMobile: boolean
): Promise<HTMLImageElement> {
  return loadFrame(index, cache, isMobile).catch(() => {
    // Try nearest frames within a 10-frame radius
    for (let delta = 1; delta <= 10; delta++) {
      const lo = index - delta
      const hi = index + delta
      if (lo >= 0) {
        const cached = cache[lo]
        if (cached) return Promise.resolve(cached)
      }
      if (hi < TOTAL_FRAMES) {
        const cached = cache[hi]
        if (cached) return Promise.resolve(cached)
      }
    }
    return Promise.reject(new Error(`No fallback frame available near ${index}`))
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

  // Playback state machine: idle | playing | locked
  const playbackStateRef = useRef<'idle' | 'playing' | 'locked'>('idle')
  const targetFrameRef = useRef<number | null>(null)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartYRef = useRef<number | null>(null)

  // RAF refs — local to the effect, kept alive by the closure
  const rafIdRef = useRef<number | null>(null)
  const rafLastRef = useRef<number>(0)

  // Live refs — always point to current callbacks, no stale closures
  const drawFrameRef = useRef<((index: number) => void) | null>(null)
  const isMobileRef = useRef(isMobile)

  const [activePause, setActivePause] = useState<PausePoint | null>(PAUSE_POINTS[0] ?? null)
  const [scrollStarted, setScrollStarted] = useState(false)

  // ---------------------------------------------------------------------------
  // Draw a frame
  // ---------------------------------------------------------------------------
  const drawFrame = useCallback(
    (index: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cache = frameCacheRef.current
      const doDraw = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
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
        loadFrameWithFallback(index, cache, isMobile)
          .then(doDraw)
          .catch(() => undefined)
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

  // ---------------------------------------------------------------------------
  // Keep live refs in sync (no deps — runs after every render)
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    drawFrameRef.current = drawFrame
    isMobileRef.current = isMobile
  })

  // ---------------------------------------------------------------------------
  // Hide scrollbars
  // ---------------------------------------------------------------------------
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

  useEffect(() => {
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    return () => window.removeEventListener("resize", resizeCanvas)
  }, [resizeCanvas])

  useEffect(() => {
    prefetchWindow(0, frameCacheRef.current, isMobile, 40)
  }, [isMobile])

  // ---------------------------------------------------------------------------
  // Enter locked state — pure function, no hooks, called from RAF or handlers
  // ---------------------------------------------------------------------------
  const enterLocked = useCallback((target: number) => {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current)
      lockTimerRef.current = null
    }

    playbackStateRef.current = 'locked'
    targetFrameRef.current = null
    currentFrameRef.current = target
    drawFrameRef.current?.(target)
    prefetchWindow(target, frameCacheRef.current, isMobileRef.current)

    const pp = PAUSE_POINTS.find((p) => p.frame === target) ?? null
    setActivePause(pp)

    lockTimerRef.current = setTimeout(() => {
      playbackStateRef.current = 'idle'
    }, PAUSE_LOCK_MS)
  }, [])

  // ---------------------------------------------------------------------------
  // RAF playback loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const TARGET_FPS = 30
    const FRAME_INTERVAL_S = 1 / TARGET_FPS

    const loop = (time: number) => {
      rafIdRef.current = requestAnimationFrame(loop)

      // Always reschedule — even when idle/locked we keep the RAF alive
      if (playbackStateRef.current !== 'playing') {
        rafLastRef.current = 0 // reset so next play starts fresh
        return
      }

      // Bootstrap on first tick of a play session
      if (rafLastRef.current === 0) {
        rafLastRef.current = time
        return
      }

      const dt = (time - rafLastRef.current) / 1000
      rafLastRef.current = time

      if (dt > 0.1) return // reject huge time steps (tab switch, sleep, etc.)

      const target = targetFrameRef.current
      const current = currentFrameRef.current

      if (target === null) {
        playbackStateRef.current = 'locked'
        return
      }

      const remaining = target - current

      if (remaining === 0) {
        playbackStateRef.current = 'locked'
        return
      }

      if (Math.abs(remaining) === 1) {
        enterLocked(remaining > 0 ? current + 1 : current - 1)
        return
      }

      // Clamp dt so we never step more than 3 frames per tick
      const steps = Math.min(Math.round(dt / FRAME_INTERVAL_S), 3)
      const step = Math.sign(remaining)
      for (let i = 0; i < steps; i++) {
        const next = currentFrameRef.current + step
        if (next < 0 || next >= TOTAL_FRAMES) break
        currentFrameRef.current = next
        drawFrameRef.current?.(next)
      }

      prefetchWindow(currentFrameRef.current, frameCacheRef.current, isMobileRef.current)
    }

    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [enterLocked])

  // ---------------------------------------------------------------------------
  // Wheel
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScrollStarted(true)

      const state = playbackStateRef.current

      // During playback: backward scroll reverses direction
      if (state === 'playing') {
        if (e.deltaY < 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            targetFrameRef.current = prevPause.frame
            rafLastRef.current = 0
          }
        }
        return
      }

      // During locked: backward scroll reverses, forward is blocked
      if (state === 'locked') {
        if (e.deltaY < 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
            lockTimerRef.current = null
            playbackStateRef.current = 'playing'
            targetFrameRef.current = prevPause.frame
            setActivePause(null)
            rafLastRef.current = 0
          }
        }
        return
      }

      // Idle: start playback
      const current = currentFrameRef.current

      if (e.deltaY > 0) {
        const nextPause = PAUSE_POINTS.find((pp) => pp.frame > current)
        if (nextPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = nextPause.frame
          setActivePause(null)
        } else {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = TOTAL_FRAMES - 1
          setActivePause(null)
        }
      } else if (e.deltaY < 0) {
        const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
        if (prevPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = prevPause.frame
          setActivePause(null)
        } else {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = 0
          setActivePause(null)
        }
      }
    }

    window.addEventListener("wheel", onWheel, { passive: false })
    return () => window.removeEventListener("wheel", onWheel)
  }, [])

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (touchStartYRef.current === null) return
      const delta = touchStartYRef.current - e.touches[0].clientY
      touchStartYRef.current = e.touches[0].clientY
      if (delta === 0) return
      setScrollStarted(true)

      const state = playbackStateRef.current

      if (state === 'playing') {
        if (delta > 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            targetFrameRef.current = prevPause.frame
            rafLastRef.current = 0
          }
        }
        return
      }

      if (state === 'locked') {
        if (delta > 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
            lockTimerRef.current = null
            playbackStateRef.current = 'playing'
            targetFrameRef.current = prevPause.frame
            setActivePause(null)
            rafLastRef.current = 0
          }
        }
        return
      }

      const current = currentFrameRef.current
      if (delta > 0) {
        const nextPause = PAUSE_POINTS.find((pp) => pp.frame > current)
        if (nextPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = nextPause.frame
          setActivePause(null)
        }
      } else {
        const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
        if (prevPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = prevPause.frame
          setActivePause(null)
        } else {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = 0
          setActivePause(null)
        }
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    // capture:true so we intercept BEFORE Safari's native scroll gesture starts
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove, { capture: true })
    }
  }, [])

  return (
    <div
      className="relative bg-black select-none"
      style={{ height: `${SCROLL_MULTIPLIER * 100}vh` }}
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