# Design System — Grok Build UI (unofficial)

Status: **foundations locked, component specs in progress.**
Owner: Salim. This file is the single source of truth for the webview skin. Figma mirrors it; code
implements it. If the three disagree, this file wins.

## 0. Principles

1. **The transcript is a document, not a dashboard.** Prose is the primary content. Tool calls are
   annotations on that prose, so they must recede — a hairline and a monospace path, not a card with
   a border, a badge and a background fill. If a row competes with the text around it, it is wrong.
2. **One accent, used sparingly.** Blue is for links, focus, and the single primary action. Never
   for decoration. Status uses shape and weight before it uses color.
3. **We own the palette.** The webview does **not** inherit VS Code theme colors. `--vscode-*` is
   permitted only for `--vscode-editor-font-family` fallback and nothing else.
4. **Density is a reading decision.** A 400px sidebar is narrow, not small: line-height stays
   generous, chrome gets tighter instead.
5. **Nothing existing is removed.** This is a re-skin plus an information-hierarchy fix. Every
   feature in `docs/UI_INVENTORY.md` survives.

## 1. Color

Monochrome neutral ramp + one accent. Two modes, same token names, defined as CSS custom properties
on `:root[data-theme="dark"]` / `:root[data-theme="light"]`.

### Neutral ramp

| Token | Dark | Light | Use |
| ----- | ---- | ----- | --- |
| `--bg` | `#0A0A0A` | `#FFFFFF` | app background, transcript |
| `--bg-raised` | `#141414` | `#F7F7F7` | composer, header, modal body |
| `--bg-inset` | `#1C1C1C` | `#F0F0F0` | code blocks, terminal output |
| `--bg-hover` | `#1F1F1F` | `#EDEDED` | row/button hover |
| `--bg-active` | `#262626` | `#E4E4E4` | pressed, selected |
| `--border` | `#242424` | `#E6E6E6` | hairlines, block separators |
| `--border-strong` | `#333333` | `#D2D2D2` | input outline, modal edge |
| `--text` | `#F5F5F5` | `#111111` | body, headings |
| `--text-muted` | `#A1A1A1` | `#5C5C5C` | labels, meta, timestamps |
| `--text-faint` | `#6E6E6E` | `#8A8A8A` | disabled, placeholder, tool verb |

Ramp rule: a surface never sits on a surface of the same token. Two-step minimum
(`--bg` → `--bg-inset`), so nesting stays legible without borders.

### Accent + status

| Token | Dark | Light | Use |
| ----- | ---- | ----- | --- |
| `--accent` | `#1D9BF0` | `#0B7FD4` | links, primary button |
| `--accent-fg` | `#FFFFFF` | `#FFFFFF` | text/glyph **on** `--accent` (filled buttons, checked boxes) |
| `--focus` | `#5A9FD4` | `#2E7CB8` | focus ring only — **desaturated on purpose**, see §1 Focus |
| `--accent-hover` | `#4AB0F5` | `#0969B0` | hover state of the above |
| `--accent-subtle` | `#0E2A3D` | `#E4F2FC` | selected row wash, badge bg |
| `--success` | `#3FB950` | `#1A7F37` | passed, applied, done |
| `--warning` | `#D29922` | `#9A6700` | awaiting approval, bypass mode |
| `--danger` | `#F85149` | `#CF222E` | failed, deny, destructive |
| `--diff-add-bg` | `#0D2B18` | `#E6FFEC` | diff added line |
| `--diff-add-text` | `#57D174` | `#116329` | `+` gutter and count |
| `--diff-del-bg` | `#33151A` | `#FFEBE9` | diff removed line |
| `--diff-del-text` | `#F08C8C` | `#A40E26` | `-` gutter and count |

Light-mode accent is darkened deliberately: `#1D9BF0` on white fails 4.5:1 for body text.
**All body and label text must clear WCAG AA 4.5:1; meta text at 12px must clear 4.5:1 too — 3:1 is
not acceptable for `--text-muted`.** These values are chosen to satisfy that; do not "brighten" them
in Figma without re-checking.

### Focus

**A focus ring must be unmistakable without glowing.** The earlier two-layer 4px `--accent` ring read
as fluorescent, especially wrapped around a full-width row. The rule now:

```css
outline: 2px solid var(--focus);
outline-offset: 2px;
```

One layer, `--focus` (a desaturated accent), never `--accent`, never a `box-shadow` glow, never more
than 2px. Two shape exceptions, because a ring around a wide flat element always looks like a neon
box:

- **Tool rows and list rows** (session history, checkpoints, autocomplete, plan items): no ring.
  Instead `--bg-hover` background **plus** a 2px `--focus` left edge. That reads as "this row is
  selected", which is what it means.
- **Inputs and the composer**: the border itself goes `--focus` at 1px and gains a single
  `outline: 1px solid var(--focus); outline-offset: 0`. No double ring around an already-bordered box.

Never remove an outline without replacing it; keyboard operation of every affordance is a
requirement, not a nicety.

## 2. Typography

Bundled fonts, so rendering is identical on every machine and independent of the VS Code theme.

| Role | Family | Size | Line height | Weight | Tracking |
| ---- | ------ | ---- | ----------- | ------ | -------- |
| `--font-ui` | Inter | — | — | 400/500/600 | — |
| `--font-mono` | JetBrains Mono | — | — | 400/500 | — |
| Markdown body | ui | 13.5px | 1.70 | 400 | 0 |
| Markdown `h1`–`h3` | ui | 17 / 15.5 / 14px | 1.35 | 600 | -0.01em |
| List item | ui | 13.5px | 1.65 | 400 | 0 |
| Inline code | mono | 12.5px | inherit | 400 | 0 |
| Code block | mono | 12.5px | 1.55 | 400 | 0 |
| Tool row label (verb) | ui | 11px | 1.0 | 600 | 0.06em, uppercase |
| Tool row path | mono | 12.5px | 1.45 | 400 | 0 |
| Terminal output | mono | 12px | 1.5 | 400 | 0 |
| Chrome / buttons | ui | 12px | 1.2 | 500 | 0 |
| Meta / status line | ui | 11.5px | 1.3 | 400 | 0.01em |
| Modal title | ui | 14px | 1.3 | 600 | -0.01em |

Prose measure is capped at **72ch**; the transcript centres within a wider panel rather than
stretching. Body line-height 1.70 is the single biggest readability win over the current UI and is
not negotiable down.

Fonts ship as woff2 in `media/fonts/`, declared `font-display: block` with a system fallback stack
(`Inter, "Segoe UI", system-ui, sans-serif` / `"JetBrains Mono", var(--vscode-editor-font-family),
ui-monospace, monospace`). Subset to latin + latin-ext to keep the `.vsix` small.

## 3. Space, radius, motion

Spacing scale (4px base): `--space-1: 4px` · `2: 8px` · `3: 12px` · `4: 16px` · `5: 24px` ·
`6: 32px` · `7: 48px`. Nothing off-scale.

| Token | Value | Use |
| ----- | ----- | --- |
| `--radius-sm` | 4px | badges, inline chips |
| `--radius-md` | 6px | buttons, inputs, code blocks |
| `--radius-lg` | 10px | composer, modal, plan panel |
| `--radius-full` | 999px | pills (scroll-to-latest, ctx meter) |

xAI-monochrome means **restrained rounding and no shadows on flat surfaces**. Elevation is a
`--bg-raised` step plus a `--border` hairline. Only true overlays get a shadow:
`--shadow-overlay: 0 8px 24px rgba(0,0,0,.45)` (dark) / `0 8px 24px rgba(0,0,0,.12)` (light).

Motion: `--dur-fast: 120ms`, `--dur-base: 180ms`, easing `cubic-bezier(.2,0,.2,1)`. Only opacity,
transform, and background-color animate. Streaming text never animates — it would reflow while
being read. Everything respects `prefers-reduced-motion: reduce` by dropping to 0ms.

## 4. Transcript anatomy — the core change

Today every tool call is a bordered card with a filled badge, so twenty tool calls read as twenty
competing boxes. The new model: **one flat row per tool call, hairline-separated, no card.**

```
  thinking  ·  30 words                                      ›     ← collapsed, muted, italic
                                                                    (no border, no fill)
  Bunch of markdown prose at 13.5/1.70, measure-capped.
  Reads like a document.

  READ   src/host/session.ts                              open      ← verb 11px uppercase faint,
  ─────────────────────────────────────────────────────────────       path is the accent link,
                                                                      action right-aligned, ghost
  EDIT   webview/App.svelte                        diff · open
  ─────────────────────────────────────────────────────────────
     +12  −3   ▸ preview                                            ← preview retained, collapsed
                                                                      by default, diff counts
                                                                      colored, expand inline

  $  npm run typecheck                                              ← command in mono, `$` sigil
     ─────────────────────────────────────────────────────           in --text-faint, output in
     tsc --noEmit — 0 errors                                         --bg-inset, max-height 12rem
                                                                     with a "show all" affordance

  More prose. Same rhythm resumes.
```

Rules that make it work:

- **No block gets a border box.** Separation comes from vertical rhythm (`--space-3` above,
  `--space-2` below) plus, for tool rows only, a 1px `--border` bottom hairline.
- **The verb is a label, not a badge.** 11px, 600, `0.06em`, uppercase, `--text-faint`. No pill, no
  background. It is scanned, not read.
- **The verb sits in a fixed 56px column.** This is the single most important rule in the whole
  transcript. `READ`, `SEARCH` and `LIST` are different character widths, so a shrink-to-fit verb
  makes every path start at a different x and the rows read as unequal even though their heights are
  identical. `flex: 0 0 66px; padding-left: 10px`, left-aligned — 56px of verb behind a permanently
  reserved 10px dot gutter. 56px fits `SEARCH` at 11px/600/0.06em with room to spare; verbs never
  truncate. **Every path in the transcript starts on the same vertical line.**
- **The state dot lives in that 10px gutter, absolutely positioned** (`left: 0`, vertically centred),
  never in the flow. An inline dot only exists on pending/running/failed rows, so in the flow it
  pushes those verbs right and the verbs themselves go ragged even while the paths still align. The
  gutter is reserved on every row so nothing moves when a row changes state, and it survives the
  280px floor without clipping.
- **A tool row has exactly three columns**: verb (66px, fixed) · target (flex, truncating) · actions
  (auto, right). Nothing else may enter the row. Diff counts, badges and extra metadata go on the
  row *below* — never inline, because they push the actions around and make one row look heavier
  than its neighbours.
- **One row metric, no dense variant.** Every tool row is `padding: 6px 0` → 31px tall, whether it is
  alone or inside a run of five. A "stacked group" variant that tightens padding to 4px is exactly
  what makes two rows of identical content read as different sizes, because a real transcript always
  mixes runs with standalone rows (edit, terminal, write). If the run needs to feel tighter, tighten
  the hairline or the gap around the group — never the row itself.
- **Transcript rhythm is a `margin-top` on the child, never a flex `gap`.** `--space-3` between
  blocks, applied as `.gb-transcript > * + * { margin-top: var(--space-3) }`, with overlays excluded.
  A flex `gap` looks equivalent and is not: it applies to *every* pair of siblings and cannot be
  overridden for one pair, so a run of tool calls could not be closed up.
- **Adjacent tool blocks sit at gap 0 — a tool run is one ruled list.** Match them by structure, not
  class: `> :is(.gb-tool-row, :has(> .gb-tool-row)) + :is(...)`. The wrappers are not consistently
  classed, and a class-based rule silently misses pairs.
- **No negative margins between rows, ever.** They were used in the second mock to cancel that flex
  gap and made the run overlap the row above it, which rendered ~23px against its neighbours' 31px.

  This one symptom — a row that looks taller or shorter than its neighbours — was misdiagnosed twice
  before the cause was found, so check the causes in this order: **the gap between the boxes first**
  (collapsed, negative, or an un-overridable flex gap), **then** padding. All three of these rows
  measured exactly 30.8px tall with 6px padding while looking visibly unequal.
- **Every sub-row starts on the target column**, `padding-left: 74px` (10 dot + 56 verb + 8 gap).
  That is the `+N −M` / `preview` row, the terminal output, and the failure message alike — one left
  edge down the whole transcript, not one per block type.
- **The path is the only accent-colored thing in the row**, and it is the click target that opens the
  file. Truncate with a middle ellipsis (`src/host/…/session.ts`), never wrap, `title` = full path.
- **Actions are ghost buttons**, right-aligned, `--text-muted`, visible on row hover and on
  keyboard focus — but always in the tab order and always present for touch/screen readers.
- **State is conveyed left of the verb** by a 6px indicator: pending = `--text-faint` ring, running =
  pulsing `--accent` dot, done = nothing at all, failed = `--danger` dot, awaiting approval =
  `--warning` dot. A finished row is the quietest row on screen. Every indicator is paired with
  visible text or an `aria-label` — color is never the only signal.
- **Consecutive same-verb rows collapse their spacing** to `--space-1` so a run of eight reads as one
  block, not eight.
- **Approval rows are the deliberate exception**: they get `--bg-raised`, a left 2px `--warning`
  border, and real buttons. They are the one thing that must interrupt.

## 5. First-run / empty state

Centred, nothing else on screen: the wordmark, one line of muted copy, and the composer.
No feature grid, no tips list, no version chrome.

```
                       ◆ GROK BUILD
                        unofficial

              Ask anything about this workspace.

        ┌───────────────────────────────────────────┐
        │  Ask, paste a screenshot, or / for …      │
        └───────────────────────────────────────────┘
             Bypass    Grok 4.5    Medium Effort
```

Vertical centring in the available height, wordmark at `--space-7` above the copy, composer pinned
where it will stay once the transcript fills. Status line and header icons fade in only after the
first message, so the clean state stays clean.

## 6. Theme switching

- Setting `grokBuild.theme`: `dark` | `light` | `followVsCode` (default **`dark`** — the design is
  authored dark-first and no longer adapts to the editor unless asked to).
- `followVsCode` reads **only** the light/dark bit of `vscode.window.activeColorTheme.kind` and picks
  one of our two palettes. It never samples a VS Code color. High-contrast VS Code themes map to our
  dark palette; we do not attempt a third palette.
- Header carries a sun/moon ghost icon that cycles `dark ⇄ light` and writes the setting, so the
  toggle and the setting are always the same state.
- Implementation: `data-theme` on the webview root; every token defined twice; zero conditional
  logic in components.

## 7. Component specs

Written against `docs/UI_INVENTORY.md` (19 components, 9 block kinds, 25 Lucide icons). Every
affordance listed there survives; only its skin and hierarchy change.

### 7.1 Global rule — kill the card

The current UI gives almost every block a border, a fill and a badge (`ToolCard`, `Thinking`,
`Question`, `PlanProposal`, `Approval`, `Notice` all draw 1–2px frames). The new hierarchy has
**exactly three levels**:

| Level | Treatment | Who gets it |
| ----- | --------- | ----------- |
| **0 — flow** | no border, no fill, hairline separator only | text, thinking, tool, notice(info/warn), turn |
| **1 — raised** | `--bg-raised` + 1px `--border` + `--radius-lg` | proposedPlan, question, plan dock, composer, modals |
| **2 — interrupt** | `--bg-raised` + 2px left border in `--warning`/`--danger` | approval, notice(error), setup card |

Nothing else gets a frame. This one change does most of the visual work.

### 7.2 Transcript blocks

**`text` — user** (`Transcript.svelte:580`)
Right-shifted, not boxed: `--bg-raised`, `--radius-lg`, `--space-3` padding, **no accent border**
(the offset and fill are enough). 13.5/1.70. Collapse affordance for >160 chars stays, rendered as a
`show more` ghost text button, not a chevron. Queued badge becomes a small `--warning` text label
`queued`, no ring. Image thumbnails 36px, `--radius-sm`, 1px `--border`. Sticky pinned prompt bar
stays: `--bg-raised`, hairline bottom, 22px thumb, single-line ellipsis, `--shadow-overlay`.

**`text` — assistant** (`Transcript.svelte:650`)
No container at all. Markdown flows directly on `--bg`, measure-capped at 72ch. Streaming caret
(`.prose.caret::after` in `Transcript.svelte`) is a 2px × 1.1em `--text` block at 60% opacity,
blinking at 1s — no color.

**Message actions — copy (new capability).**
Today only fenced code blocks are copyable (`Markdown.svelte:279`). Both message roles now get a copy
affordance, because the whole point of a reading surface is being able to take the text with you.

| | User message | Assistant message |
| - | ------------ | ----------------- |
| Position | top-right, inside the bubble's padding | bottom-left, on its own 20px action row under the prose |
| Resting state | invisible | invisible |
| Revealed by | `:hover` on the message **and** `:focus-visible` on the button | same |
| Content | 12px `copy` icon only | 12px `copy` icon + `Copy` at 11.5px |
| Copies | the raw prompt text | the raw **markdown source**, not the rendered HTML |
| Confirmed by | icon swaps to `check` in `--success` for 1.2s, `aria-live="polite"` announces `Copied` | same, and the label reads `Copied` |

Rules: it is a ghost button (`--text-faint` → `--text-muted` on hover, `--bg-hover` background,
`--radius-sm`), it is **always in the tab order** even while visually hidden, and it never shifts
layout when it appears — reserve its space. On an assistant message the action row is also where any
future per-message action goes, so build it as a row, not a single floating button. Nested code-block
copy buttons keep working independently; a click on one must not bubble to the message-level copy.

**`thinking`** (`Thinking.svelte`)
Level 0. Collapsed row: `sparkles` icon at 12px `--text-faint`, the word `Thought` in italic
`--text-muted`, then `· 2.4s · 42 words`, chevron right-aligned. No purple left border. Streaming
state changes only the label (`Thinking…`) and adds the caret. Expanded body is `--text-muted` at
13/1.65 with a 2px `--border` left rail and `--space-3` indent — the rail is the only visual, so
reasoning reads as an aside.

**`tool`** (`ToolCard.svelte`) — the row anatomy in §4 applies. Mapping the existing fields:

| Existing | New treatment |
| -------- | ------------- |
| `toolKind` icon + `label` | 11px uppercase verb from `toolKind` (`READ`/`EDIT`/`WRITE`/`SEARCH`/`LIST`/`FETCH`), icon dropped except for `terminal` |
| `locations[0]` path | the accent link, middle-truncated, opens file at line |
| `writes` badge | removed as a badge; mutating rows show the verb in `--text-muted` instead of `--text-faint` |
| `waiting` badge | `--warning` dot left of the verb + `aria-label="waiting"` |
| `diff` / `open` buttons | ghost text buttons, right-aligned, revealed on hover **and** focus, always tabbable |
| `+N −M` diff counts | **not in the row.** They sit on the sub-row with the `preview` toggle, so the `EDIT` row keeps the same three-column shape as `READ` |
| collapsed peek | for `read`/`search`: one line of `--text-faint` mono tail. For `edit`/`write`: a sub-row carrying `+12 −3` and the `preview` / `collapse` toggle, then the collapsed `DiffView` — **preview retained per requirement** |
| expanded output | `--bg-inset`, `--radius-md`, mono 12/1.5, `max-height: 12rem` + `show all` |
| terminal | `$ ` sigil in `--text-faint`, command in mono `--text`, output in `--bg-inset`; no separate terminal tint |
| `failed` | `--danger` dot + error text in `--danger` below the row; **no red frame** |
| `stacked` | consecutive rows drop to `--space-1` gap and share one hairline |

**`plan`** (`PlanDock.svelte`) — stays a level-1 drawer above the composer, unchanged in behaviour.
Header: `PLAN` kicker, `3/3`, a 3px `--radius-full` meter (`--border` track, `--accent` fill,
`--success` when complete), current-step text truncated. Items: `check` in `--success` +
`--text-faint` strikethrough for done, pulsing `--accent` dot for in-progress, empty 10px
`--border-strong` ring for pending.

**`proposedPlan`** (`PlanProposal.svelte`) — level 1, **no 2px blue frame**. `layers` icon + `PLAN
PROPOSAL` kicker, markdown body, then actions: `Approve & start` (primary), `Request changes`
(secondary, reveals textarea), `Reject` (ghost, `--danger` text on hover only). Answered state:
opacity stays 1, actions replaced by a single `--text-muted` verdict line — never dim content the
user may still want to read.

**`question`** (`Question.svelte`) — level 1, **no 2px purple frame**. Step dots become a
`1 of 3` label plus a hairline meter. Options are full-width rows: 16px radio/checkbox in
`--border-strong`, `--accent` when selected, `--bg-hover` on hover, `--accent-subtle` wash when
selected. `Other…` expands an inline input. Preview code box: `--bg-inset`, mono 12px. Actions
right-aligned; `Skip` is a ghost text button on the left.

**`approval`** (`Approval.svelte`) — level 2, the one intentional interrupt. `--bg-raised`, 2px left
`--warning`, `warning` icon, title, then the target: path as accent link for writes, `$ command` in
mono for commands, `cwd` as `--text-faint` meta. Embedded `DiffView` retained. Buttons in a fixed
order — primary (`Apply`/`Run`), secondary (`Accept all edits`/`Always allow`), ghost (`Reject`),
ghost-danger (`Never`) — wrapping to two rows under 320px. Answered: left border goes `--border`,
verdict as a `--text-muted` line, opacity unchanged.

**`notice`** — `info` and `warn` are level 0: an icon, one line, and a `log` ghost link, separated by
hairlines. `error` is level 2 with a 2px left `--danger`, monospace detail in `--bg-inset`, and a
`View log` button.

**`turn`** (`TurnFooter.svelte`) — the quietest thing on screen: hairline top, 11.5px
`--text-faint`, `↑1.2k ↓450 · 3.5s · $0.0012`, right-aligned. Abnormal `stopReason` in `--warning`.

### 7.3 Chrome

**Header** (`Header.svelte`) — 36px, `--bg`, hairline bottom. `GROK BUILD` wordmark 11px/600/0.08em
in `--text`, `unofficial` as 10px `--text-faint` **plain text, not a filled badge**. Icon buttons
28×28, `--radius-md`, 16px Lucide in `--text-muted` → `--text` on hover with `--bg-hover`.
Order: theme toggle (new, `sun`/`moon`), `plus`, `clock`, `rewind`, `sparkles` (0.4 opacity when
off), `ellipsis`. Disabled buttons stay visible at 0.35 with their tooltip. Overflow menu: level 1,
`--shadow-overlay`, 28px rows, 11px `config only` / `leader-only` chips in `--bg-inset`,
`Restart agent` with `--danger` text.

**Status line** (`StatusLine.svelte`) — 24px, `--bg`, hairline bottom, 11.5px `--text-muted`,
`·` separators in `--text-faint`. Order: state dot + fixed-width label, session title (`--text`),
folder, then right-aligned `ctx N%` · tokens · cost · version. Dots: `--success` idle, pulsing
`--accent` thinking, `--warning` awaitingApproval, `--text-faint` stopped. `ctx` colouring:
`--text-muted` <70%, `--warning` 70–89%, `--danger` ≥90%, always with a 24px hairline meter beside
it so the number is not the only cue; clicking still runs `/context`. `Compact` appears at ≥70% as a
`--warning`-text ghost button. Error strip: full-width, `--bg-inset`, `--danger` text, hairline.

**Composer** (`Composer.svelte`) — level 1, `--radius-lg`, 1px `--border-strong` → `--accent` on
focus-within (ring, not a color swap). Textarea transparent, 13.5/1.6, min 40px / max 220px,
placeholder `--text-faint`. Attachment bar above the field: 36px thumbs, `--radius-sm`, `x` on
hover/focus. Autocomplete popup: level 1, `--shadow-overlay`, up to 8 rows, name in mono `--text` +
description in `--text-muted`, active row `--accent-subtle` with a 2px `--accent` left edge. Queue
banner sits above the composer, level 0 with a `--warning` left rail: count, `Waiting to send`,
`Send all now` / `Clear` ghost links, then per-item rows with `Send`.

**Composer toolbar** — **one row, never wrapping, at 280px and up.** The earlier version wrapped
`Medium Effort` onto a second line and the row fell apart. The layout is fixed:

```
[ 🖼 ]  [ Bypass ⌄ ]  [ Grok 4.5 ⌄ ]  [ Medium ⌄ ]          [ Send ]
 24px    auto          shrinkable       auto                 auto, pinned right
```

`flex-wrap: nowrap`. The **model** button is the only shrinkable one (`min-width: 0`, truncating with
an ellipsis) — model names are the long, unpredictable strings. Labels are terse: the effort button
reads `Low` / `Medium` / `High`, **not** `Medium Effort`; the mode reads `Ask` / `Accept` / `Plan` /
`Bypass`. Chevrons are 12px and only rendered on hover, focus, or when the menu is open, so the
resting row is quiet. Below 320px the attach button drops to icon-only 24px and the effort button
hides (it stays available in the overflow menu).

22px-tall ghost buttons, 12px/500, `--radius-md`, hairline `--border`, `--bg-hover` on hover.
Permission mode carries a 6px dot: `--text-muted` Ask, `--accent` Accept, `--accent` Plan,
`--danger` Bypass — plus the label text, so the mode is never colour-only.
Model and effort are plain ghost buttons with a `chevron`. **At most one filled button per surface**
— on the composer that is `Send`: `--accent` bg, white text, `--radius-md`, becoming `Queue` /
`Start` / `Sending…` per state. The other filled primaries in the UI are `Apply`/`Run` on an
approval, `Approve & start` on a plan proposal, `Next`/`Send` on a question, and `Done` on the
command-result modal — one each, never two in the same block. `Stop` is a `--danger`-outlined ghost. `Restart` a plain ghost.

**Scroll-to-latest pill** — `--radius-full`, `--bg-raised`, 1px `--border-strong`,
`--shadow-overlay`, `arrowDown` + `Latest` at 11.5px `--text`. It is **absolutely positioned against
the scrolling transcript, not the composer**, and sits 12px from that container's bottom-right — so it
floats clear above the plan dock and composer and never overlaps them. This was wrong in the first
mock: the pill landed inside the composer's top-right corner.

The pill is **an overlay, not flow content**, and its width is always its own content (~72px). Any
rule that sizes the transcript's children — the 72ch measure cap in a wide panel, a stretch from a
flex parent — must exclude it. In the second mock the measure cap caught it and the pill grew to the
full 522px measure, reading as a bar across the panel rather than a floating control.

**Empty / first-run** — per §5. The three shortcut hint lines currently in
`Transcript.svelte:243-255` are kept but demoted to one 11.5px `--text-faint` line:
`Enter sends · Shift+Enter new line · Esc stops`. `<kbd>` styling: `--bg-inset`, 1px `--border`,
`--radius-sm`, mono 11px.

**Setup card** (`SetupCard.svelte`) — level 2 with a `--warning` left border, since it is a blocker.
Install URL as an accent link, `Restart` as the primary button.

### 7.4 Modals and popovers

All five overlays share one shell: backdrop `rgba(0,0,0,.45)` dark / `rgba(0,0,0,.25)` light,
panel `--bg-raised` + 1px `--border-strong` + `--radius-lg` + `--shadow-overlay`, 40px header with a
14px/600 title and a 24px `close` ghost button, hairline-separated body, optional footer.
`max-height: 65vh`, body scrolls, focus trapped, `Esc` closes, focus returns to the trigger.

- **Session history** — search input (level 1 inset, `search` icon in `--text-faint`, clear `x`),
  then rows: title `--text` truncated, relative time `--text-faint` right, `current` as a plain
  `--accent` text label. Hover/focus reveals `edit` + `trash`. Inline rename swaps the title for an
  input with `check`/`close`. Armed delete turns the row's left edge `--danger` and shows
  `check`/`close` — no modal-on-modal.
- **Rewind & worktree** — two hairline-separated sections with 11px uppercase `--text-faint`
  kickers (`CHECKPOINTS`, `WORKTREE`). Checkpoint rows like history rows. Worktree: name input then
  `Create` (primary) and `Move` / `Open` / `Apply` / `Remove` ghosts, `Remove` danger-on-hover.
- **About** — wordmark, disclaimer at 13/1.7 `--text-muted`, facts as a two-column hairline grid,
  links as accent text buttons.
- **Slash-command result** — `width: min(100%, 420px)`, header shows the command in mono
  `--accent`, spinner while pending, markdown body, `Done` primary in the footer.
- **Context compact** — no new modal; the `Compact` ghost button in the status line, then a
  `notice(info)` row in the transcript reporting the result.

### 7.5 Markdown

`Markdown.svelte` gets the §2 type scale plus: fenced blocks in `--bg-inset` + `--radius-md` +
`--space-3`, mono 12.5/1.55, no border; language label 10px `--text-faint` top-right; `copy` button
top-right revealed on hover **and** focus, `Copied` in `--success`. Inline code `--bg-inset`,
`--radius-sm`, `0 4px`, no border. Blockquote: 2px `--border-strong` left rail, `--text-muted`, no
fill. Tables: hairline rows only, 12.5px, `--bg-inset` header, horizontal scroll retained. Links
`--accent`, underline on hover only. `hr` a single `--border` hairline at `--space-4` margins.
Lists at `--space-4` indent, 1.65 line-height, markers in `--text-faint`.

### 7.6 Icons

Keep the inlined-Lucide approach in `Icon.svelte` — CSP-safe and already `currentColor`. Add three:
`sun`, `moon`, `chevronDown`. Standard sizes 12 / 14 / 16 px, stroke 1.5, never filled.

## 9. Implementation notes

- **One stylesheet.** Extract `App.svelte:564-735` into `webview/styles/tokens.css` (both palettes)
  and `webview/styles/base.css` (reset, typography, scrollbar, focus, `.gb-*` utilities). Components
  keep only layout in their `<style>` blocks and reference tokens.
- **Delete all 60 `--vscode-*` references** listed in `docs/UI_INVENTORY.md:153-212`. The single
  permitted survivor is `--vscode-editor-font-family`, as a mono fallback.
- **Fonts**: bundle woff2 under `media/fonts/`. The webview CSP already allows
  `font-src ${cspSource}`, so local files load fine — the existing "no webfonts" note in
  `UI_INVENTORY.md:253` applies to *external* fonts only.
- **Narrow-width behaviour is preserved as-is**: 280px floor, flex-wrap on toolbars, `pre-wrap` +
  `overflow-wrap: anywhere` in code and diffs, table scroll containers.
- Suggested order: tokens + base → theme toggle plumbing → transcript blocks → chrome → modals →
  markdown. Each step ends with `npm run typecheck` and a look at both themes in the harness.

## 8. Accessibility floor

Not a later pass — part of the definition of done for every component below:

- Contrast: body and label text ≥ 4.5:1 in both modes, including 11–12px meta text; non-text
  indicators ≥ 3:1.
- Every affordance reachable and operable by keyboard; visible focus ring on all of them.
- Modals: focus trapped, `Esc` closes, focus returns to the trigger.
- Hover-revealed actions are never hover-only — focus and assistive tech reach them too.
- State never encoded in color alone; pair every dot with text or an `aria-label`.
- Streaming regions announce politely (`aria-live="polite"`), not assertively.
- `prefers-reduced-motion: reduce` drops all durations to 0.
