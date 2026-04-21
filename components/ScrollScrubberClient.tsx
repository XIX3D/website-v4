"use client"

import dynamic from "next/dynamic"

const ScrollScrubber = dynamic(
  () => import("@/components/ScrollScrubber"),
  { ssr: false }
)

export default function ScrollScrubberClient() {
  return <ScrollScrubber />
}
