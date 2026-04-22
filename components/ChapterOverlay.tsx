"use client"

import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import type { PausePoint } from "@/data/pausePoints"

interface Props {
  pause: PausePoint | null
}

export default function ChapterOverlay({ pause }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevRef = useRef<PausePoint | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const entering = pause !== null && prevRef.current === null
    const leaving = pause === null && prevRef.current !== null

    if (entering) {
      gsap.fromTo(
        el,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }
      )
    } else if (leaving) {
      gsap.to(el, { opacity: 0, y: -30, duration: 0.4, ease: "power2.in" })
    }

    prevRef.current = pause
  }, [pause])

  if (!pause) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-end justify-start pointer-events-none"
      style={{ opacity: 0 }}
    >
      <div className="mb-16 ml-10 md:ml-20 max-w-xl text-white">
        {pause.eyebrow && (
          <p className="text-sm md:text-base uppercase tracking-[0.3em] text-white/60 mb-2 font-medium">
            {pause.eyebrow}
          </p>
        )}
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-none mb-3">
          {pause.title}
        </h2>
        <p className="text-base md:text-lg text-white/65 leading-relaxed font-light max-w-sm">
          {pause.body}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            className="
              pointer-events-auto
              border border-white/30 rounded-full
              px-5 py-2.5 text-sm font-medium tracking-wider
              hover:bg-white hover:text-black transition-colors duration-300
              cursor-pointer
            "
            onClick={() => {
              /* TODO: wire up Learn More links per pause */
            }}
          >
            Learn More
          </button>
        </div>
      </div>
    </div>
  )
}
