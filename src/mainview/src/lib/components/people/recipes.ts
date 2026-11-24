import { FOCUS_RING } from "$lib/components/ui/recipes";

// A person's row (#357, S-34 and S-38): the trigger that opens their profile. PersonButton draws what is inside; these
// are the two places it sits: the members column's row and the friends page's one, each with its own width and action.
// Both take the row radius and the keys' focus mark, so a new people surface starts from the same decision.

/** The members column's row: its banner behind, its avatar and name within the row's margin. */
export const MEMBER_ROW_TRIGGER =
	"group relative mx-2 flex h-10 w-[calc(100%-1rem)] items-center overflow-hidden rounded-row px-2 " +
	"text-duvet-ink hover:bg-duvet-hover data-[state=open]:bg-duvet-hover";

/** The friends page's profile half: it shares its row with the action cards beside it. */
export const FRIEND_ROW_TRIGGER = `rounded-row relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left ${FOCUS_RING}`;
