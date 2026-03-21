# Design System — JoWork

## Product Context
- **What this is:** Agent Infrastructure — middleware that turns CLI AI agents into autonomous assistants with data awareness, memory, and goals
- **Who it's for:** Vibe coders / weak-geek users who use AI agents (Claude Code, Codex, OpenClaw) but don't know tmux or IDEs
- **Space/industry:** Developer tools / AI agent infrastructure (peers: Linear, Warp, Raycast, Cursor)
- **Project type:** Web Dashboard (localhost companion panel) + CLI tool

## Aesthetic Direction
- **Direction:** Industrial-Minimal — function-first, data is the decoration. Not "cool", but "reliable". A companion tool should feel like a good instrument panel, not an art gallery.
- **Decoration level:** Minimal — zero decoration. Information hierarchy relies entirely on font size/weight + color contrast. No card shadows, no gradients, no icon circles.
- **Mood:** Calm confidence. The dashboard should feel like a trusted control surface — always there, never demanding attention, immediately useful when you look at it.
- **Reference sites:** linear.app (gold standard for dev tool UI), raycast.com (command-palette UX), warp.dev (terminal-native aesthetic)

## Typography
- **Display/Hero:** Geist 700 — designed by Vercel specifically for developer tools. Clean, geometric, excellent at large sizes.
- **Body:** Geist 400/500 — same family for coherence. One font family = less cognitive load for a utility tool.
- **UI/Labels:** Geist 500/600 (same as body, weight variation only)
- **Data/Tables:** Geist Mono 400 — tabular-nums for aligned timestamps, counts, and metrics
- **Code:** Geist Mono 400
- **Loading:** Google Fonts CDN — `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap`
- **Scale:**
  - Display: 48px / 700
  - H1: 28px / 600
  - H2: 24px / 600
  - H3: 18px / 600
  - Body: 15px / 400
  - Small: 13px / 400
  - Caption: 12px / 400
  - Micro: 11px / 500 (section labels, uppercase)
  - Mono Data: 13px / 400 (tabular-nums)
  - Mono Code: 14px / 400

## Color
- **Approach:** Restrained — monochrome foundation with one warm accent color. Color is rare and meaningful.
- **Primary (accent):** #E8B931 — warm amber/gold. Deliberately NOT blue/purple (every AI tool uses those). Conveys "active, working, alive." Used for: active tab indicators, primary buttons, links, focus rings.
  - Hover: #F0C84A
  - Dim (backgrounds): #E8B93120
- **Neutrals (dark mode — default):**
  - Background: #0C0C0E (near-black, slightly warmer than pure black)
  - Surface 1: #161618 (sidebar, elevated panels)
  - Surface 2: #1C1C1F (hover states, secondary panels)
  - Surface 3: #242427 (active states, input backgrounds)
  - Border: #2A2A2D (extremely subtle, used only for dividers — never for card borders)
  - Text Primary: #EDEDEF
  - Text Secondary: #8B8B8E
  - Text Tertiary: #5A5A5D
- **Neutrals (light mode):**
  - Background: #FAFAFA
  - Surface 1: #F4F4F5
  - Surface 2: #E8E8EA
  - Surface 3: #D4D4D8
  - Border: #E4E4E7
  - Text Primary: #18181B
  - Text Secondary: #71717A
  - Text Tertiary: #A1A1AA
  - Accent (light): #B8910F (darker amber for contrast)
- **Semantic:**
  - Success: #34D399 (connected, synced, met)
  - Error: #F87171 (disconnected, failed, unmet)
  - Warning: #FBBF24 (expiring, degraded)
  - Info: #60A5FA (informational, neutral)
- **Dark mode:** Default. Light mode available via toggle. Dark mode surfaces use 2-4% lightness increments for layering — no borders needed to distinguish depth.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable — not a Bloomberg terminal (too dense), not a marketing page (too spacious). A companion panel used alongside a terminal.
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)

## Layout
- **Approach:** Grid-disciplined — strict alignment, predictable structure
- **Grid:** Sidebar (240px fixed) + Main Area (fluid). Main area uses tab switching (Sessions / Context / Goals), not simultaneous multi-column.
- **Max content width:** 1200px (for the preview/standalone page)
- **Border radius:**
  - sm: 4px (inputs, small buttons)
  - md: 6px (cards, panels, alerts)
  - lg: 8px (modals, mockup containers)
  - full: 9999px (status dots, pills)

## Motion
- **Approach:** Minimal-functional — only state transitions that aid comprehension. No entrance animations, no scroll-driven effects, no decorative motion.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**
  - micro: 50-100ms (hover states, focus rings)
  - short: 150ms (fade transitions, button state changes)
  - medium: 200ms (tab switching, panel slide)
  - long: 300ms (toast entrance/exit)
- **Reduced motion:** `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-21 | Initial design system created | Created by /design-consultation based on competitive research (Linear, Raycast, Warp) and product positioning as companion panel for vibe coders |
| 2026-03-21 | Amber accent (#E8B931) over blue/purple | Every AI/dev tool uses blue or purple. Amber differentiates immediately and conveys "active, working" warmth |
| 2026-03-21 | Geist font family (single family) | Designed by Vercel for dev tools. One family for everything reduces cognitive load — coherence over variety |
| 2026-03-21 | Dark mode as default | 99% of dev tool users prefer dark mode. Light mode available but not the default experience |
| 2026-03-21 | Zero decoration (no card shadows/gradients) | Data IS the decoration. Industrial-minimal aesthetic prioritizes information density and scanability |
| 2026-03-21 | Sidebar + Tabs (not three-column) | Vibe coders need one focus area at a time, not a dense multi-panel dashboard. Tabs reduce cognitive load |
