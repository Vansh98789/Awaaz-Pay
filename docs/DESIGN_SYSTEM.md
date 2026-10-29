# Awaaz Pay — Blind-First Design System

> A calm, high-contrast, braille-inspired design system engineered specifically for blind and low-vision users, with secondary support for low-literacy users.

---

## 1. Core Philosophy

- **Braille Dots as Visual & Feedback Language**: Circular dot-matrix patterns represent Awaaz Pay visually and indicate system status (listening, thinking, speaking, success, blocked).
- **Single-Column Layout**: Centered, `max-width: 560px`, with at least `32px` vertical spacing between semantic groups. No nested cards inside cards.
- **Thumb-Reachable Targets**: Primary actions are situated at the bottom third of the screen.
- **64px Target Minimum**: Every interactive button or control is at least `64px` tall and `64px` wide, with at least `16px` margin between interactive elements.
- **Information Parity**: Every piece of visual feedback has an immediate spoken or screen-reader text alternative. Dots are hidden from assistive tech (`aria-hidden="true"`).

---

## 2. Design Tokens

All colors, typography sizes, and target sizes are defined as CSS variables in `src/design/tokens.css`.

### Light Theme
| Token | Hex Value | Usage |
| :--- | :--- | :--- |
| `--bg` | `#F8F8F6` | Page background |
| `--surface` | `#FFFFFF` | Cards & container surfaces |
| `--text` | `#111111` | Primary text (Contrast ratio ~15:1) |
| `--text-muted` | `#4A4A4A` | Secondary text (Contrast ratio ~8.4:1) |
| `--accent` | `#1D4ED8` | Primary button, links, focus ring |
| `--accent-text` | `#FFFFFF` | Text on primary accent button |
| `--success` | `#0F7B3F` | Approved payments, completed transactions |
| `--danger` | `#B42318` | Scam alerts, blocked payments, errors |
| `--warning` | `#8A5A00` | New payee warning, cooling-off alerts |
| `--border` | `#D6D6D2` | High-contrast borders |

### Dark Theme (`prefers-color-scheme: dark` / `[data-theme="dark"]`)
| Token | Hex Value | Usage |
| :--- | :--- | :--- |
| `--bg` | `#0E0E0F` | Page background |
| `--surface` | `#18181A` | Cards & surface background |
| `--text` | `#F4F4F2` | Primary text |
| `--text-muted` | `#B8B8B4` | Secondary text |
| `--accent` | `#8AAEFF` | Primary accent with dark text (`#0E0E0F`) |
| `--success` | `#5FD08A` | Success fills |
| `--danger` | `#FF8F85` | Alert & danger fills |
| `--warning` | `#F2C063` | Warning fills |
| `--border` | `#35353A` | Borders |

---

## 3. Typography & Focus

- **Typefaces**: Installed locally via `@fontsource/inter` and `@fontsource/noto-sans-devanagari` (zero external network requests for fonts; works 100% offline).
- **Scale**:
  - `Body`: `1.25rem` (20px), weight 500
  - `Large Body`: `1.5rem` (24px), weight 700
  - `Headlines`: `2.25rem` to `2.75rem` (36px - 44px), weight 700
  - `Amount Display`: `4.5rem` to `6rem` (72px - 96px), weight 700
- **Line Height**: 1.4 for readability.
- **Focus Ring**: `4px solid var(--accent)` with `3px` offset.

---

## 4. Reusable Components (`src/design/`)

1. **`DotWordmark`**: 5x7 dot-matrix SVG rendering the text *"awaaz"* with `aria-label="Awaaz Pay"`.
2. **`DotRing`**: Circular ring of dots surrounding the giant mic button with CSS-only animated states:
   - `idle`: steady muted dots
   - `listening`: rhythmic breathing pulse (`var(--accent)`)
   - `speaking`: rippling wave around perimeter
   - `success`: green pop expansion (`var(--success)`)
   - `blocked`: warning/danger jitter (`var(--danger)`)
   - *Static under `prefers-reduced-motion`*.
3. **`BrailleCells`**: Progressive 2x3 braille dot cells used as step and progress indicators (`role="progressbar"`).
4. **`BigButton`**: 64px height pill button with variants: `primary`, `secondary`, and `danger`. Includes screen-reader announced loading state (`aria-busy="true"`).
5. **`Headline` & `BodyText`**: Semantic typography wrappers respecting user font zoom up to 200%.
6. **`StatusBanner`**: Status and alert banners pairing high-contrast colors with explicit word labels (`Success:`, `Warning:`, `Blocked:`) and distinct dot glyph patterns.
7. **`Page`**: Unified layout container with skip link (`#main-content`), landmark wrappers (`header`, `main`, `footer`), and language attributes.

---

## 5. Haptic Feedback Patterns (`src/hooks/useHaptics.ts`)

Where `navigator.vibrate` is supported on mobile devices:
- **Listening start**: `[30]` (short tap)
- **Understood**: `[20, 40, 20]` (double tap)
- **Confirmed**: `[40, 60, 40]` (affirming triple pulse)
- **Blocked**: `[350]` (long distinctive buzz)
- **Error**: `[80, 60, 80, 60, 80]` (urgent stutter pattern)

---

## 6. Dual Speech Output Modes

Configured in Settings and persisted in `localStorage` (`awaaz_output_mode`):
1. **Voice Mode** (Default):
   - The app speaks replies aloud using its built-in Web Speech synthesis engine.
   - Ideal for users who do not run an active external screen reader.
2. **Screen Reader Mode**:
   - The app mutes its built-in speech engine.
   - Replies are injected into `aria-live="polite"` or `aria-live="assertive"` regions so TalkBack (Android) or VoiceOver (iOS) reads them naturally.
   - Eliminates overlapping / double speech.

---

## 7. Keyboard & Switch Access

- **Spacebar or Enter**: Toggles microphone listening on/off from anywhere on the Home screen.
- **Tab / Shift+Tab**: Traverses 64px interactive targets in logical order.
- **Escape**: Closes modals and dialogs.

---

## 8. Manual Screen-Reader Verification Checklist

*(Items to verify with TalkBack on Android or VoiceOver on iOS)*:
- [ ] Turn on TalkBack / VoiceOver and verify the first announcement upon page load is `"Awaaz Pay"`.
- [ ] Double-tap the giant center button to verify speech input activates and haptic pulse is felt.
- [ ] In Screen Reader mode, verify TalkBack reads the conversational response without duplicate synthetic audio.
- [ ] In QR scanning mode, verify TalkBack reads the periodic camera alignment guidance (`"A little to the left"`, `"Code found"`).
- [ ] In Confirm Payment screen, verify focus lands on the `"No, cancel"` button first rather than the dangerous confirm action.
