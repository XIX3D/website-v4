# Website v4 (McLaren Scroll Experience)

## Goal
Create a fresh Next.js project with a scroll-scrubbing media experience (Apple product page style).

## Requirements
- Framework: Next.js (App Router), Tailwind CSS, TypeScript.
- Animation: GSAP (ScrollTrigger) or Framer Motion, optimized for scroll-scrubbing video/image sequences.
- Media context: We will have two variants (Desktop/Horizontal and Mobile/Vertical). The media is stored in `public/media/`.
- Mechanics: 
  1. User scrolls once -> media plays to a keyframe -> pauses -> scroll is locked until keyframe is reached.
  2. UI/Text reveals when paused.
  3. Scroll again -> UI disappears -> media continues to next keyframe -> new UI reveals.
  4. Reverse scroll reverses the timeline/media.
  
## Initial Tasks for Claude Code
1. Initialize the Next.js project in this directory. Do NOT put it in a subdirectory, initialize it exactly in `/home/techs/clawd/projects/website-v4/` (you may need to initialize in a temp dir and move files over if it complains about existing files).
2. Install `gsap` and `@gsap/react`.
3. Create the base layout and a placeholder structure for the scroll-scrubbing component.
4. Set up a placeholder array of "chapters" or "keyframes" with dummy text for the UI reveals.
