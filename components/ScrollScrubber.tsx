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

  // Playback state machine: idle | playing | locked
  const playbackStateRef = useRef<'idle' | 'playing' | 'locked'>('idle')
  const targetFrameRef = useRef<number | null>(null)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartYRef = useRef<number | null>(null)
  // Expose RAF state so we can reset it from enterLocked
  const rafAccumRef = useRef<number>(0)
  const rafLastRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)

  const [activePause, setActivePause] = useState<PausePoint | null>(null)
  const [scrollStarted, setScrollStarted] = useState(false)

  // Hide scrollbars
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
  // Refs so RAF loop always has fresh callbacks
  // ---------------------------------------------------------------------------
  const drawFrameRef = useRef(drawFrame)
  const isMobileRef = useRef(isMobile)
  useEffect(() => {
    drawFrameRef.current = drawFrame
    isMobileRef.current = isMobile
  })

  // ---------------------------------------------------------------------------
  // Enter locked state at a target frame
  // ---------------------------------------------------------------------------
  const enterLocked = useCallback((target: number) => {
    // Stop any pending timer
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current)
      lockTimerRef.current = null
    }

    // Stop the RAF accumulation completely — prevents any frame stepping
    rafAccumRef.current = 0
    rafLastRef.current = 0

    playbackStateRef.current = 'locked'
    targetFrameRef.current = null
    currentFrameRef.current = target
    drawFrameRef.current(target)
    prefetchWindow(target, frameCacheRef.current, isMobileRef.current)

    const pp = PAUSE_POINTS.find((p) => p.frame === target) ?? null
    setActivePause(pp)

    // After dwell time, transition to idle (overlay stays, user must scroll to proceed)
    lockTimerRef.current = setTimeout(() => {
      playbackStateRef.current = 'idle'
      // overlay stays visible — setActivePause NOT called
    }, PAUSE_LOCK_MS)
  }, [])

  // ---------------------------------------------------------------------------
  // RAF playback loop — 30fps constant rate
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const PLAYBACK_FPS = 30

    const loop = (time: number) => {
      // Only advance when in 'playing' state
      if (playbackStateRef.current === 'playing') {
        // Bootstrap on first tick
        if (rafLastRef.current === 0) {
          rafLastRef.current = time
          rafAccumRef.current = 0
        }

        const elapsed = (time - rafLastRef.current) / 1000
        rafLastRef.current = time
        rafAccumRef.current += elapsed * PLAYBACK_FPS

        // Step exactly one frame per tick at 30fps
        if (rafAccumRef.current >= 1) {
          rafAccumRef.current -= 1

          const target = targetFrameRef.current
          if (target === null) {
            playbackStateRef.current = 'locked'
            break
          }

          const current = currentFrameRef.current
          const remaining = target - current

          if (remaining === 0) {
            playbackStateRef.current = 'locked'
          } else if (Math.abs(remaining) === 1) {
            // Land exactly on target — enterLocked will stop the RAF accumulation
            enterLocked(target)
          } else {
            const step = Math.sign(remaining) * 1
            currentFrameRef.current += step
            drawFrameRef.current(currentFrameRef.current)
            prefetchWindow(currentFrameRef.current, frameCacheRef.current, isMobileRef.current)
          }
        }
      } else {
        // Reset timing so next play starts cleanly
        rafLastRef.current = 0
        rafAccumRef.current = 0
      }

      rafIdRef.current = requestAnimationFrame(loop)
    }

    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [enterLocked])

  // ---------------------------------------------------------------------------
  // Wheel: forward scroll starts playback to next pause
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScrollStarted(true)

      const state = playbackStateRef.current

      // During playback: block forward scroll, allow backward
      if (state === 'playing') {
        if (e.deltaY < 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            targetFrameRef.current = prevPause.frame
            // Stay in 'playing', direction reversed by setting target
            // Reset RAF timing for clean restart
            rafLastRef.current = 0
            rafAccumRef.current = 0
          }
        }
        return
      }

      // During locked: only allow backward scroll
      if (state === 'locked') {
        if (e.deltaY < 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            // Clear the lock timer so we don't return to idle
            if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
            lockTimerRef.current = null
            playbackStateRef.current = 'playing'
            targetFrameRef.current = prevPause.frame
            setActivePause(null)
            rafLastRef.current = 0
            rafAccumRef.current = 0
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
          // No more pauses — play to end
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
          // backward during playback
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).at(-1)
          if (prevPause) {
            targetFrameRef.current = prevPause.frame
            rafLastRef.current = 0
            rafAccumRef.current = 0
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
            rafAccumRef.current = 0
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
