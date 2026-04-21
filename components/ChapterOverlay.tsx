"use client"

import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import type { Chapter } from "@/data/chapters"

interface Props {
  chapter: Chapter | null
  /** 0–1 within the current dwell zone (0 = entering, 1 = leaving) */
  dwellProgress: number
}

export default function ChapterOverlay({ chapter, dwellProgress }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevChapterRef = useRef<Chapter | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const entering = chapter !== null && prevChapterRef.current === null
    const leaving = chapter === null && prevChapterRef.current !== null

    if (entering) {
      gsap.fromTo(
        el,
        { opacity: 0, y: 32 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }
      )
    } else if (leaving) {
      gsap.to(el, { opacity: 0, y: -24, duration: 0.35, ease: "power2.in" })
    }

    prevChapterRef.current = chapter
  }, [chapter])

  if (!chapter) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-end justify-start pointer-events-none"
      style={{ opacity: 0 }}
    >
      <div className="mb-16 ml-12 md:ml-20 max-w-lg text-white">
        <p className="text-xs uppercase tracking-[0.25em] text-white/60 mb-3 font-light">
          {chapter.subtitle}
        </p>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-none mb-4">
          {chapter.title}
        </h2>
        <p className="text-base md:text-lg text-white/70 leading-relaxed font-light">
          {chapter.body}
        </p>
        <div className="mt-6 flex items-center gap-2">
          <span className="block w-8 h-px bg-white/40" />
          <span className="text-xs text-white/40 tabular-nums">
            {String(chapter.id).padStart(2, "0")}
          </span>
        </div>
      </div>
    </div>
  )
}
