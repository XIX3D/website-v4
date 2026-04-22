export interface PausePoint {
  /** Frame index to pause on [0–504] */
  frame: number
  /** Tagline / eyebrow text above the title */
  eyebrow: string
  /** Main title (large heading) */
  title: string
  /** Body copy below the title */
  body: string
}

/** 4 pause points across the 505-frame animation */
export const PAUSE_POINTS: PausePoint[] = [
  {
    frame: 83,
    eyebrow: "1000+",
    title: "Vinyl & Films",
    body: "From colour flips to carbon clears — explore every finish, texture and application.",
  },
  {
    frame: 146,
    eyebrow: "500+",
    title: "Wheels and Tires",
    body: "Set the stance. Choose from hundreds of configs, sizes and finishes.",
  },
  {
    frame: 283,
    eyebrow: "",
    title: "Body Kits and Mods",
    body: "Wide-body conversions, splitters, skirts and diffusers — engineered to fit.",
  },
  {
    frame: 504,
    eyebrow: "",
    title: "1:1 Scale Design",
    body: "Visualise every mod in real scale before you commit. Powered by Zeno.",
  },
]

/** First frame (intro, no pause) */
export const INTRO_FRAME = 0

/** Total scroll multiplier (500vh = 5 screen heights of scroll) */
export const SCROLL_MULTIPLIER = 500

/** Total frames in the sequence */
export const TOTAL_FRAMES = 505

/** Lock duration in ms before user can scroll past a pause point */
export const PAUSE_LOCK_MS = 1500
