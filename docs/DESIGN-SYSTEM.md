# Duvet's interface design system

This is the implementation guide for the desktop UI. It explains where a
design decision belongs and how to extend the system without flattening
different surfaces, user preferences, or platform appearances into one set of
global styles.

For approved visual values and surface specifications, see
[`redesign/DESIGN-MAP.md`](redesign/DESIGN-MAP.md). For decisions made while
implementing them, see [`redesign/DECISIONS.md`](redesign/DECISIONS.md). This
guide is about how those decisions are represented in code.

## Sources of truth

| Concern | Source |
| --- | --- |
| Approved visual values, geometry, and surface behavior | `docs/redesign/DESIGN-MAP.md` |
| Resolution of design-map contradictions and implementation choices | `docs/redesign/DECISIONS.md` |
| Semantic colors, shadows, typography, radii, motion, and global CSS | `src/mainview/src/app.css` |
| Shared controls, fields, overlays, and menu recipes | `src/mainview/src/lib/components/ui/recipes.ts` and `components/ui/` |
| Settings-specific cards, rows, fields, and labels | `src/mainview/src/lib/components/settings/recipes.ts` and `components/settings/` |
| Message-body rendering, including its different backgrounds | `src/mainview/src/lib/message-styles.ts` |
| Persisted user choices | Their focused modules under `src/mainview/src/lib/` and `lib/stores/` |

Do not make a token or recipe the source of truth for a value that belongs to a
different concern. In particular, a reusable CSS class must not silently
override a user's selected appearance.

## Initial inventory

The first pass found an established foundation, but not yet a consistently
applied one:

- The palette, shadows, typography, motion, and some radii are already
  tokenized in `app.css`; `tokens.test.ts`, `contrast.test.ts`, and related
  tests protect important parts of that contract.
- Shared UI and Settings recipes exist and have focused tests. They do not yet
  cover every recurring surface and control pattern in the component tree.
- Message Markdown has a separate feature recipe, including different styles
  for plain text and the user's own bubble. That separation is important and
  should be extended rather than replaced by a global text style.
- The UI contains 159 Svelte components. In a quick static count of component
  class strings, `rounded-xl`, `rounded-2xl`, and arbitrary 9/10 px radii all
  recur frequently. The named radius tokens coexist with those literals, so
  adoption and role mapping need review.
- Similar-looking cards, rows, and popovers sometimes have different
  responsibilities (for example, Settings cards vs. message attachments, or
  sidebar glass vs. floating glass). Counts and textual similarity alone are
  not grounds to merge them.

The audit is a starting point, not a visual specification. Each repeated
pattern must be checked against its context and approved surface before
centralizing it.

## Layers and boundaries

### 1. Design tokens

`app.css` owns semantic tokens, with dark values in `:root` and light
overrides in `.duvet-light`. Tailwind utilities such as `bg-duvet-card` are
the component-facing interface to those values.

- Prefer a semantic token over a literal color, shadow, or arbitrary value
  when the value represents a Duvet design decision.
- Keep platform-specific materials and exceptional contexts separate. The
  sidebar's solid tint, vibrant glass, and Windows mica are distinct on
  purpose; do not make them one generic surface.
- Add a token only when it represents a stable meaning, not merely to avoid
  writing a one-off measurement.
- Brand marks, user-selected colors, media content, and authored message
  colors are not automatically part of the application palette.

### 2. Shared component recipes

`components/ui/recipes.ts` defines shared interaction patterns such as buttons,
icon buttons, fields, glass panels, pills, badges, and menus. Settings recipes
build on these for the Settings and Space Settings information architecture.

- Put a repeated pattern here when its meaning, geometry, and interaction
  states are genuinely shared.
- Keep variants explicit and typed where callers have a real choice.
- A caller may add layout or content-specific classes; it should not have to
  restate the base surface, focus, disabled, or hover behavior.
- Do not create a universal `card` or `row` recipe that erases meaningful
  differences between a settings group, chat row, message bubble, and floating
  panel.

### 3. Feature recipes

Feature-level decisions belong beside their feature. For example,
`message-styles.ts` styles generated Markdown and deliberately has separate
recipes for plain text and the user's own bubble.

Use a feature recipe when styling depends on rendered content, ownership,
feature state, or a domain-specific layout. Keep it composable so the same
content looks right in chat, previews, search, and profiles.

### 4. User preferences

Preferences are independent inputs to rendering, not alternate names for the
global theme:

- **Theme** (`system`, `light`, `dark`) selects the semantic palette.
- **Messages** selects the message layout (currently bubbles or flat rows).
- **Code blocks** may select a custom syntax-highlighting theme.
- Platform window materials and layout preferences remain platform/layout
  concerns.

Each preference must continue to affect only its intended scope, persist using
its existing storage contract, and work in previews as well as the main view.
New message appearance options (for example, a message size or bubble color)
must be modeled as separate preferences and applied at the message boundary;
they must not mutate the global palette or leak into unrelated cards,
controls, or themes.

## Surface and container rules

Choose a surface by its role, then choose its content and interaction:

| Role | Guidance |
| --- | --- |
| App/canvas background | `duvet-bg`; the page and major panes |
| Recessed/well | `duvet-sunk` or `duvet-field`, according to the approved surface |
| Resting card | `duvet-card`, with the approved radius and resting elevation |
| Secondary control/fill | `duvet-secondary-fill`; not a substitute for a card |
| Floating overlay | The shared glass recipe, including its edge, blur, and float shadow |
| Sidebar material | Sidebar tokens and platform variants; not the generic glass recipe |
| Message content | The message layout and ownership-specific message recipes |

Containers should communicate hierarchy. Avoid accidental card-in-card
nesting, invisible containers that still own padding, and transparent hover
states that make a contained action appear detached. Before changing a
container, identify whether it owns background, edge, elevation, radius,
clipping, and spacing; neighboring elements should share these decisions when
they share a role.

The DESIGN-MAP's radii are contextual, not a mandate to replace every radius
with one global value. Use the matching named Tailwind radius token where one
exists; introduce a new named token only after confirming the geometry is a
repeated design decision.

## Adding or changing a component

1. Identify the component's role, surface, interaction states, and supported
   appearance/preference variants.
2. Find the relevant DESIGN-MAP surface and existing shared or feature recipe.
3. Reuse that recipe if the pattern is truly shared. Otherwise add a small,
   named feature recipe at the narrowest appropriate scope.
4. Keep state-specific differences explicit; do not hide them in global
   selectors or implicit DOM ancestry.
5. Add or update tests for the recipe, preference boundary, or rendered
   component. Preserve both light and dark behavior.
6. Run formatting, lint, Svelte checks, and the relevant tests. For visual
   changes, inspect representative screens in both themes and all affected
   layout modes.

Tailwind utility classes remain appropriate for one-off composition. The goal
is not to eliminate utilities; it is to eliminate repeated, conflicting
decisions and make meaningful variants discoverable.

## Standardization plan

Migrate incrementally; each phase should leave the app working and reviewable.

1. **Inventory and contract** — map tokens, shared recipes, preference owners,
   feature styling, platform overrides, and high-frequency repeated patterns.
   This document establishes the contract; update it as the inventory becomes
   more specific.
2. **Foundations and primitives** — reconcile token names/scales and the shared
   UI and Settings recipes. Add focused tests before broad adoption.
3. **Surface families** — standardize one family at a time (Settings, sidebar
   rows, people/actions, overlays, message containers) while retaining
   intentional differences.
4. **Appearance boundaries** — verify the matrix of light/dark, platform
   material, Messages layout, and code theme. Any user-selectable message
   styling stays scoped to messages.
5. **Coverage and enforcement** — add checks for missing token mappings,
   accidental duplicated recipes, and preference leaks where static checks
   can reliably express the rule. Record intentional exceptions rather than
   making a blanket lint ban.

Do not mass-rewrite class strings or change visual values just to make the code
look uniform. Each migration should state which decision it centralizes and
how it preserves the component's existing role and supported variants.
