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

  // 'idle' = waiting for user to scroll
  // 'playing' = auto-playing frames toward next pause point
  // 'locked' = paused at a frame, lock timer running
  const playbackStateRef = useRef<'idle' | 'playing' | 'locked'>('idle')
  const targetFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)

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
  // Advance to next frame toward target
  // ---------------------------------------------------------------------------
  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      const next = currentFrameRef.current + direction
      if (next < 0 || next >= TOTAL_FRAMES) return

      currentFrameRef.current = next
      drawFrame(next)
      prefetchWindow(next, frameCacheRef.current, isMobile)

      // Check if we reached the target
      if (targetFrameRef.current !== null && next === targetFrameRef.current) {
        // Arrived — lock
        playbackStateRef.current = 'locked'
        const pp = PAUSE_POINTS.find((p) => p.frame === next)!
        setActivePause(pp)

        if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
        lockTimerRef.current = setTimeout(() => {
          playbackStateRef.current = 'idle'
          targetFrameRef.current = null
          setActivePause(null)
        }, PAUSE_LOCK_MS)
      }
    },
    [drawFrame, isMobile]
  )

  // ---------------------------------------------------------------------------
  // Playback RAF loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Target: traverse the full scroll range in ~6 seconds
    // Each frame of scroll covers TOTAL_FRAMES / SCROLL_MULTIPLIER frames of video
    // We want to traverse the ENTIRE scroll range in ~6 seconds
    // That's SCROLL_MULTIPLIER * 100vh of scroll space
    // 6 seconds → SCROLL_MULTIPLIER * 100vh / 6 vh per second
    // But we only play between pause points, so compute based on segment length

    // Playback speed: pixels of scroll "travel" per second
    // We simulate scrolling at ~300vh/s (feels snappy but watchable)
    const SCROLL_VH_PER_SEC = 300
    const PX_PER_VH = typeof window !== 'undefined' ? window.innerHeight : 800
    const PX_PER_SEC = SCROLL_VH_PER_SEC * PX_PER_VH

    let lastTime = 0

    const loop = (time: number) => {
      if (playbackStateRef.current === 'playing') {
        if (lastTime === 0) lastTime = time
        const elapsed = (time - lastTime) / 1000 // seconds
        const pxTraveled = elapsed * PX_PER_SEC

        // How many frames of our sequence does this scroll distance cover?
        const pxPerFrame = (SCROLL_MULTIPLIER * PX_PER_VH) / TOTAL_FRAMES
        const framesToStep = Math.floor(pxTraveled / pxPerFrame)


        if (framesToStep > 0) {
          const target = targetFrameRef.current!
          const current = currentFrameRef.current
          const remaining = target - current

          if (Math.abs(remaining) <= framesToStep) {
            // Land exactly on target
            currentFrameRef.current = target
            drawFrame(target)
            prefetchWindow(target, frameCacheRef.current, isMobile)
            playbackStateRef.current = 'locked'
            lastTime = 0
            const pp = PAUSE_POINTS.find((p) => p.frame === target)
            setActivePause(pp ?? null)

            if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
            lockTimerRef.current = setTimeout(() => {
              playbackStateRef.current = 'idle'
              targetFrameRef.current = null
              setActivePause(null)
            }, PAUSE_LOCK_MS)
          } else {
            // Step toward target
            const dir = remaining > 0 ? 1 : -1
            const step = dir * framesToStep
            currentFrameRef.current += step
            drawFrame(currentFrameRef.current)
            prefetchWindow(currentFrameRef.current, frameCacheRef.current, isMobile)
            lastTime = time
          }
        } else {
          lastTime = time
        }
      } else {
        lastTime = 0
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [drawFrame, isMobile])

  // ---------------------------------------------------------------------------
  // Wheel: scroll forward → start auto-play to next pause frame
  //        scroll backward (when locked) → go to previous pause frame
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      const state = playbackStateRef.current

      if (state === 'playing') {
        // Block all wheel input during auto-play
        return
      }

      if (state === 'locked') {
        // Only allow backward scroll to exit to previous pause
        if (e.deltaY < 0) {
          // Go back to previous pause point
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).pop()
          if (prevPause) {
            playbackStateRef.current = 'playing'
            targetFrameRef.current = prevPause.frame
            setActivePause(null)
          }
        }
        return
      }

      // state === 'idle'
      setScrollStarted(true)

      if (e.deltaY > 0) {
        // Scrolling forward — find next pause frame and auto-play to it
        const current = currentFrameRef.current
        const nextPause = PAUSE_POINTS.find((pp) => pp.frame > current)

        if (nextPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = nextPause.frame
          // Don't show overlay mid-playback
          setActivePause(null)
        } else {
          // No more pause frames — play to end
          playbackStateRef.current = 'playing'
          targetFrameRef.current = TOTAL_FRAMES - 1
          setActivePause(null)
        }
      } else if (e.deltaY < 0) {
        // Scrolling backward — go back to previous pause point
        const current = currentFrameRef.current
        const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).pop()
        if (prevPause) {
          playbackStateRef.current = 'playing'
          targetFrameRef.current = prevPause.frame
          setActivePause(null)
        } else {
          // Go back to start
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
  // Touch: same logic
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
      setScrollStarted(true)

      const state = playbackStateRef.current

      if (state === 'playing') return

      if (state === 'locked') {
        if (delta > 0) {
          const current = currentFrameRef.current
          const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).pop()
          if (prevPause) {
            playbackStateRef.current = 'playing'
            targetFrameRef.current = prevPause.frame
            setActivePause(null)
          }
        }
        return
      }

      // idle
      if (delta > 0) {
        const current = currentFrameRef.current
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
      } else if (delta < 0) {
        const current = currentFrameRef.current
        const prevPause = PAUSE_POINTS.filter((pp) => pp.frame < current).pop()
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
