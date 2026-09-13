# BlindDrop Design System

## Core Identity
**BlindDrop** is a clean, premium, true zero-knowledge secret sharing service. The default look is a "light-blue glassmorphism" aesthetic that reads as modern SaaS: trustworthy and approachable. The same layout ships in three themes so the product can also feel at home for security-minded users who prefer a terminal aesthetic.

## Themes
Themes are selected with the three-way switch in the header, persisted to `localStorage` under `blinddrop.theme`, and applied via `data-theme` on `<html>`. With no stored choice the OS colour scheme decides between light and dark. All tokens live in `src/style.css`; Tailwind utilities are mapped onto them through `@theme inline`, so `bg-primary`, `text-fg-muted`, `border-line-strong`, `font-display` etc. switch at runtime. There is no `tailwind.config.js`.

| Token | Light | Dark | Hacker |
| --- | --- | --- | --- |
| Background | `#f4f6fb` + blue/lavender glows | `#0b1020` + blue/indigo glows | `#040806` + green glows, scanlines, faint grid |
| Surface (glass) | `rgba(255,255,255,.58)` | `rgba(17,24,39,.62)` | `rgba(6,16,10,.78)` |
| Foreground | `#0f172a` / muted `#475569` | `#e5e9f2` / muted `#9aa8bf` | `#c9f7d6` / muted `#7fd193` |
| Primary | `#2563eb`, white text | `#3b82f6`, white text | `#4ade80`, near-black text |
| Primary as text | `#1d4ed8` | `#93c5fd` | `#86efac` |
| Success / Warning / Danger | `#059669` / `#d97706` / `#dc2626` | `#34d399` / `#fbbf24` / `#f87171` | `#4ade80` / `#facc15` / `#fb7185` |
| Display / body font | Manrope / Inter | Manrope / Inter | JetBrains Mono / JetBrains Mono |
| Radii (card / field / button / chip) | 28 / 16 / 16 / pill | 28 / 16 / 16 / pill | 14 / 8 / 8 / 8 |

Hacker-only flourishes: `> ` prompt before the brand, blinking `_` cursor after the H1, phosphor text glow, scanline overlay and a soft grid masked toward the edges. All animation respects `prefers-reduced-motion`.

## Typography
- **Display**: Manrope 800, tight tracking (`-0.03em`), balanced wrapping.
- **Body**: Inter 400 to 600, 1.5 to 1.6 line-height.
- **Secrets, links, and payloads**: JetBrains Mono, always, in every theme, so `0/O` and `l/1` are unambiguous.
- **Labels**: 11px, bold, uppercase, `0.14em` tracking.

## Components (classes in `src/style.css`)
- `.nav` frosted pill header. Contains the brand, primary links, the `.theme-switch` segmented control, and the mobile menu toggle.
- `.card` frosted glass panel with theme shadow; radius from `--radius-card`.
- `.field` inputs: solid background, 1px hairline, hover tint, 4px focus halo in the ring colour. `.field-mono` for payloads, `.field-primary` / `.field-success` for result states.
- `.chip` expiry options in a 4-column grid; active state is `aria-pressed="true"`.
- `.btn-primary` full-width CTA with a subtle top sheen and theme glow. `.is-busy` shows a spinning `progress_activity` icon.
- `.btn-soft` tinted secondary button (copy). `.is-done` flips to success colour.
- `.notice` with `-info | -success | -warning | -danger` tones. Burned or expired secrets are `warning` (expected outcome), unknown failures are `danger`.
- `.inline-error` for validation. Browser `alert()` is not used.
- `.feature` / `.feature-icon` trust strip under the card.

## Interaction rules
- Never block with dialogs; errors render inline next to the control that caused them.
- The hero icon, title and subtitle change with state (link ready, unlock, revealed, gone) so the page always says what just happened.
- Copy buttons confirm with "Copied" for ~2 seconds.
- Passphrase fields have a show/hide toggle.
- Focus is always visible: 2px ring in the theme ring colour.

## Iconography
Material Symbols Outlined, subset via `icon_names` in the font URL. Add new glyphs to that alphabetical list or they will render as text.
