export interface Chapter {
  id: number
  title: string
  subtitle: string
  body: string
  /** Normalized video/frame progress [0–1] at which this chapter's keyframe is hit */
  videoProgress: number
  /** Scroll progress [0–1] where the dwell (overlay) zone starts */
  dwellStart: number
  /** Scroll progress [0–1] where the dwell zone ends */
  dwellEnd: number
}

/**
 * Each chapter occupies a play zone + dwell zone in scroll space.
 * Total scroll height is set to 600vh in ScrollScrubber.
 *
 * Layout (10% play → 10% dwell, × 5 chapters, final 20% plays to end):
 *   0.00–0.10  play  → video 0.00–0.20
 *   0.10–0.20  dwell → video locked at 0.20
 *   0.20–0.30  play  → video 0.20–0.40
 *   0.30–0.40  dwell → video locked at 0.40
 *   0.40–0.50  play  → video 0.40–0.60
 *   0.50–0.60  dwell → video locked at 0.60
 *   0.60–0.70  play  → video 0.60–0.80
 *   0.70–0.80  dwell → video locked at 0.80
 *   0.80–1.00  play  → video 0.80–1.00  (no final dwell)
 */
export const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: "The Vision",
    subtitle: "Form follows function",
    body: "Every line is intentional. Every surface sculpted for a singular purpose — to move faster, with less.",
    videoProgress: 0.2,
    dwellStart: 0.1,
    dwellEnd: 0.2,
  },
  {
    id: 2,
    title: "Precision Engineering",
    subtitle: "Machined to the micron",
    body: "Our chassis is carved from a single billet of aerospace aluminium — lighter than air, stronger than steel.",
    videoProgress: 0.4,
    dwellStart: 0.3,
    dwellEnd: 0.4,
  },
  {
    id: 3,
    title: "Pure Performance",
    subtitle: "0–100 in 2.5 seconds",
    body: "The hybrid powertrain delivers 1,275 bhp on demand. No delays. No compromises.",
    videoProgress: 0.6,
    dwellStart: 0.5,
    dwellEnd: 0.6,
  },
  {
    id: 4,
    title: "Connected Intelligence",
    subtitle: "The cockpit thinks with you",
    body: "Adaptive telemetry systems read the road, the driver, and the conditions — adjusting in real time.",
    videoProgress: 0.8,
    dwellStart: 0.7,
    dwellEnd: 0.8,
  },
]

/** Total scroll multiplier (e.g. 6 = 600vh) */
export const SCROLL_MULTIPLIER = 6

/** Total frames in each PNG sequence */
export const TOTAL_FRAMES = 505
