# BlindDrop Design System

## Core Identity
**BlindDrop** is a clean, premium, true zero-knowledge secret sharing service. The design uses a "Light-blue glassmorphism" aesthetic to differentiate it from its parent product (BlindPass), establishing a distinct, approachable, yet highly secure visual identity.

## Attributes & Atmosphere
- **Mood**: Modern SaaS, clean, trustworthy, approachable (not a "hacker tool").
- **Theme**: Light Mode / High Clarity.
- **Style Technique**: Glassmorphism.

## Colors & Palette
- **Background**: Soft gradient transitioning smoothly from a soft light blue `#E0E7FF` to a very light lavender `#F3F4F6` or pure white `#FFFFFF` towards the bottom.
- **Glass Panel Background**: Translucent white `rgba(255, 255, 255, 0.4)` to simulate frosted glass.
- **Brand/Primary Accent**: Vibrant Blue `#3B82F6` (used for CTAs, active states, and major highlights).
- **Secondary Accent**: Cyan/Teal touches `#06B6D4` (for success states or secondary buttons).
- **Text (Primary)**: Deep Slate `#1E293B` for high contrast and readability on the light glass.
- **Text (Secondary/Muted)**: Cool Gray `#64748B` for helper text, timestamps, and subtle hints.
- **Borders**: Highly subtle white borders `rgba(255, 255, 255, 0.6)` on glass cards to catch the "light".
- **Semantic States**:
  - Success: `#10B981` (Emerald)
  - Danger/Burned/Expired: `#EF4444` (Red)
  - Warning/Tombstone: `#F59E0B` (Amber)

## Typography
- **Primary Font**: `Inter` (or similar clean sans-serif like Roboto/Outfit).
- **Headings**: Semi-bold to Bold, tracking slightly tight for a robust premium feel.
- **Body**: Regular weight, optimal line-height (1.5) for reading clarity.
- **Secret/Code Font**: Monospace (e.g., `Fira Code` or `JetBrains Mono`) for the strictly confidential data payloads to ensure distinct, unambiguous character rendering.

## Components & Effects
### Glassmorphism Cards
- **Backdrop Filter**: `blur(16px)` or `blur(24px)` mixed with a semi-transparent white background.
- **Corner Rounding**: `16px` or `24px` Large, pill-like shapes for buttons and generous radii for major content cards.
- **Shadows**: Soft, highly diffused drop shadows (e.g., `0 10px 40px rgba(0,0,0,0.05)`) floating the cards above the gradient background.

### Buttons & CTAs
- **Primary Fill**: Solid vibrant blue `#3B82F6` with crisp white text.
- **Hover Transitions**: Smooth brightness increase, slight translation (`transform: translateY(-1px)`), and a subtle glow on hover.

### Inputs & Forms
- **Input Backgrounds**: Further inset frosted glass or solid white with a soft inner shadow to indicate depth.
- **Focus Rings**: A distinct glowing outline using the Primary Accent color `#3B82F6` with substantial padding.

## Application to Milestones
This DESIGN.md acts as the source of truth for all subsequent components drafted via Stitch MCP or translated into the Vite/React application.
