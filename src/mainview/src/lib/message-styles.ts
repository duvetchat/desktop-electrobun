// How a message's markdown looks in the redesign (#357, docs/redesign/DESIGN-MAP.md S-15). markdown.ts writes the
// HTML with its own classes (msg-inline-code, msg-blockquote, …), which app.css gives their base look; these are the
// redesign's, as Tailwind classes on what holds that HTML, so they reach it wherever a message's text shows (the list,
// a reply's strip, the pins, search and thread previews, a profile's bio). Each class is whole in one string: Tailwind
// reads them here.

/** What every message text has, whatever it sits on. */
export const MESSAGE_TEXT = [
	// inline code: a small filled box, no edge
	"[&_.msg-inline-code]:rounded-[5px] [&_.msg-inline-code]:border-0 [&_.msg-inline-code]:px-[5px] [&_.msg-inline-code]:py-0.5 [&_.msg-inline-code]:text-[0.86em] [&_.msg-inline-code]:text-inherit",
	// a code block: the code's own fill, radius 10, its language in small capitals in the corner
	"[&_.msg-code-block]:mt-1 [&_.msg-code-block]:mb-0.5 [&_.msg-code-block]:max-w-full [&_.msg-code-block]:rounded-[10px] [&_.msg-code-block]:border-0 [&_.msg-code-block]:text-[12.5px] [&_.msg-code-block]:leading-normal",
	"[&_.msg-code-lang]:font-sans [&_.msg-code-lang]:text-[10px] [&_.msg-code-lang]:font-medium [&_.msg-code-lang]:tracking-[0.06em] [&_.msg-code-lang]:uppercase",
	"[&_.msg-code-copy]:rounded-lg [&_.msg-code-copy]:border-0 [&_.msg-code-copy]:shadow-duvet-raised",
	"[&_.msg-ln]:border-r-0 [&_.msg-code-block_code]:pr-14",
	// a quote: a filled block, no bar
	"[&_.msg-blockquote]:my-0.5 [&_.msg-blockquote]:rounded-[10px] [&_.msg-blockquote]:border-l-0 [&_.msg-blockquote]:px-2.5 [&_.msg-blockquote]:py-1.5 [&_.msg-blockquote]:text-inherit",
	// hidden text: a drift of specks until the pointer is on it or the keyboard's focus is in it, and nothing of it shows
	// through (an emoji is a picture). They drift only while the spoiler is on screen (lib/spoiler-specks.ts).
	"[&_.msg-spoiler]:animate-specks [&_.msg-spoiler]:rounded-[5px] [&_.msg-spoiler]:px-0.5",
	"[&_.msg-spoiler[data-still]]:[animation-play-state:paused]",
	"[&_.msg-spoiler]:[background:radial-gradient(circle,var(--speck)_0.7px,transparent_1.1px)_0_0/4px_4px,radial-gradient(circle,var(--speck)_0.6px,transparent_1px)_2px_2px/5px_5px,var(--spoiler-fill)]",
	"[&_.msg-spoiler:is(:hover,:focus-visible)]:animate-none [&_.msg-spoiler:is(:hover,:focus-visible)]:text-inherit [&_.msg-spoiler:is(:hover,:focus-visible)]:[background:var(--spoiler-fill)]",
	"[&_.msg-spoiler:not(:hover,:focus-visible)_*]:invisible",
	// a person's mention: their name in bold, in their role's colour where it has one (markdown.ts: an inline style,
	// which wins), violet where it has none, as mobile writes it; and no chip. The violet comes through --mention-ink,
	// so a lit bubble (lib/prism.ts) and one's own bubble name another ink without racing this rule's place in the sheet.
	"[&_.msg-mention]:bg-transparent [&_.msg-mention]:p-0 [&_.msg-mention]:font-bold",
	"[&_.msg-mention]:[color:var(--mention-ink,var(--duvet-chosen-ink))]",
	"[&_.msg-mention[data-user-id]:hover]:bg-transparent [&_.msg-mention[data-user-id]:hover]:underline",
	// a room's mention: a chip
	"[&_.msg-room-mention]:rounded-md [&_.msg-room-mention]:px-[5px]",
].join(" ");

/** On the page, a card or someone else's bubble. */
export const MESSAGE_TEXT_PLAIN = [
	"[--speck:var(--duvet-ink2)] [--spoiler-fill:var(--duvet-field)]",
	"[&_.msg-inline-code]:bg-duvet-field [&_.msg-blockquote]:bg-duvet-field",
	"[&_.msg-table_th]:bg-duvet-field [&_.msg-table_th]:text-inherit",
	// links: in the accent's ink, underlined under the pointer only
	"[&_.msg-bare-link]:text-duvet-accent-text [&_.msg-bare-link]:no-underline [&_.msg-bare-link:hover]:underline",
	"[&_.msg-link]:no-underline [&_.msg-link:hover]:underline",
].join(" ");

/** In one's own bubble, which is azure: the fills are washes of white, and links and chips take the bubble's ink. */
export const MESSAGE_TEXT_OWN = [
	"[--speck:rgba(255,255,255,0.85)] [--spoiler-fill:rgba(255,255,255,0.16)] [--mention-ink:currentColor]",
	"[&_.msg-inline-code]:bg-fixed-white/18 [&_.msg-blockquote]:bg-fixed-white/16",
	"[&_.msg-table_th]:bg-fixed-white/16 [&_.msg-table_th]:text-inherit [&_.msg-table_td]:border-fixed-white/25 [&_.msg-table_th]:border-fixed-white/25",
	"[&_.msg-table_tr:nth-child(even)_td]:bg-fixed-white/8",
	"[&_.msg-link]:text-inherit [&_.msg-link]:underline [&_.msg-bare-link]:text-inherit [&_.msg-bare-link]:underline [&_.msg-duvet-link]:text-inherit",
	"[&_.msg-room-mention]:bg-fixed-white/20 [&_.msg-room-mention]:text-inherit",
	"[&_.msg-subtext]:text-inherit [&_.msg-subtext]:opacity-75",
].join(" ");

/** A message of only emoji shows them at 40 px, on what holds it (the app's own large size is 48). */
export const JUMBO_EMOJI = "[&_.emoji-img]:size-10";

/** The classes for a message's text on a tone: one's own bubble, or anything else. */
export function messageTextClass(own = false): string {
	return `${MESSAGE_TEXT} ${own ? MESSAGE_TEXT_OWN : MESSAGE_TEXT_PLAIN}`;
}

/** The box a message's text sits in, whatever its layout: the page, a flat row or a bubble. */
export const MESSAGE_BODY =
	"font-content relative max-w-full cursor-text text-left text-[16px] wrap-anywhere select-text";

/** A message's card: an attachment, embed, link preview or component on the card's fill, at its resting height. */
export const MESSAGE_CARD = "bg-duvet-card shadow-duvet-raised rounded-card";

/** The same card where the whole surface opens something: it lifts under the pointer. */
export const MESSAGE_CARD_ACTION = `${MESSAGE_CARD} hover:shadow-duvet-lifted transition-shadow motion-reduce:transition-none`;

/** A photo or video's frame: clipped to the card radius, on its own resting shadow. */
export const MESSAGE_MEDIA = "shadow-duvet-raised overflow-hidden rounded-card";

/** The recessed frame a photo or video waits in, before its own pixels cover it. */
export const MESSAGE_MEDIA_SUNK = "bg-duvet-sunk shadow-duvet-raised relative overflow-hidden rounded-card";

/** The secondary fill a photo or video still uploading sits on. */
export const MESSAGE_MEDIA_PENDING = "bg-duvet-secondary-fill relative rounded-card";

/** A dashed placeholder: a file or voice note that is gone, or a place to drop one. */
export const MESSAGE_PLACEHOLDER = "border-duvet-line text-duvet-ink2 rounded-card border border-dashed";

/** An invite's card: the message card inside a hairline, with its own inset. */
export const MESSAGE_INVITE_CARD =
	"border-duvet-line bg-duvet-card shadow-duvet-raised rounded-card mt-2 max-w-xs border p-4";

/** A message of only emoji: the glyphs at their large size, with no bubble's padding. */
export const MESSAGE_EMOJI_ONLY = "px-0.5 leading-[1.15]";

/** A flat row's text: at most 760 wide, tight leading. Its ink is the message's: plain or failed. */
export const MESSAGE_FLAT = "max-w-[760px] leading-[1.25]";

/** The bubble a message's text sits in when it isn't flat: the card radius, its own padding and the height transition. */
export const MESSAGE_BUBBLE =
	"rounded-card px-3 py-2 leading-[1.45] transition-shadow duration-200 motion-reduce:transition-none";

export const MESSAGE_BUBBLE_FAILED = "bg-duvet-danger/15 text-duvet-danger";
export const MESSAGE_BUBBLE_OWN = "msg-own bg-duvet-azure text-fixed-white";
export const MESSAGE_BUBBLE_OTHER = "bg-duvet-card text-duvet-ink";

/** A bubble the user jumped to, or whose reply or mention it is. */
export const MESSAGE_BUBBLE_HIGHLIGHT = "shadow-[0_0_0_3px_var(--duvet-accent),var(--duvet-shadow-raised)]";
