// What a settings screen asks of the page it is in (#357). The screens are the same on the web, where they are sheets
// of the app's own page, and in the desktop app, where each fills a window of its own that has none of the app's
// stores: there the host sends these on to the main window (lib/stores/settings-guest-link.svelte.ts).
import { logout } from "$lib/api/auth";
import { applyOwnProfile, type SavedProfile } from "$lib/own-profile";
import { MESSAGE_LAYOUT_KEY, type MessageLayout } from "$lib/message-layout";
import type { StagedImage, StagedSlot } from "$lib/staged-images";
import { gatewaySpaces } from "$lib/stores.svelte";
import { messageLayout } from "$lib/stores/message-layout.svelte";
import { toast } from "$lib/stores/toast.svelte";

/** How chats draw their messages: the conversation's own preference, kept under its own key (lib/message-layout.ts). */
export { MESSAGE_LAYOUT_KEY, type MessageLayout };

export function parseMessageLayout(raw: unknown): MessageLayout {
	return raw === "flat" ? "flat" : "bubbles";
}

/** A Space's fields its Overview saves. */
export interface SavedSpace {
	name: string;
	description: string | null;
	locale: string | null;
	banner: string | null;
	icon?: string | null;
	default_notifications?: 0 | 1;
}

export interface SettingsHost {
	/** Signs the user out of the app. */
	logout(): void | Promise<void>;
	/** The user's profile was saved: it shows everywhere at once. */
	profileSaved(saved: SavedProfile): void;
	/** A Space's overview was saved: its new name, icon and the rest show at once. */
	spaceSaved(spaceId: string, saved: SavedSpace): void;
	/** A Space was deleted: it goes from the app at once, and the app says so. */
	spaceDeleted(spaceId: string, name: string): void;
	/** Bubbles or flat rows. */
	messageLayout(): MessageLayout;
	setMessageLayout(layout: MessageLayout): void;
	/** The code theme was loaded from a URL, or reset (an empty one): every window's code blocks take it. */
	codeThemeChanged(url: string): void;
	/** The images picked and not saved yet that were kept from this screen's last time, for whose they are
	 * (lib/staged-images.ts): none on a page whose screen stays mounted while closed, which keeps its own. */
	stagedImages(scope: string): Promise<Partial<Record<StagedSlot, StagedImage>>>;
	/** An image was picked, or isn't any more (null): kept for the screen's next time where the screen can't. */
	stageImage(scope: string, slot: StagedSlot, staged: StagedImage | null): void;
}

/** A Space with what its Overview saved; a gateway from before the default leaves it as it was. */
export function withSavedSpace<Space extends { id: string }>(
	spaces: readonly Space[],
	spaceId: string,
	saved: SavedSpace,
): Space[] {
	return spaces.map((space) => {
		if (space.id !== spaceId) return space;
		const { default_notifications: level, ...fields } = saved;
		return { ...space, ...fields, ...(level === undefined ? {} : { default_notifications: level }) };
	});
}

/** What crossed the windows as a Space's saved overview, or null for anything else. */
export function parseSavedSpace(value: unknown): SavedSpace | null {
	if (typeof value !== "object" || value === null) return null;
	const fields: Record<string, unknown> = { ...value };
	if (typeof fields.name !== "string") return null;
	const text = (field: unknown) => (typeof field === "string" ? field : null);
	const level = fields.default_notifications;
	return {
		name: fields.name,
		description: text(fields.description),
		locale: text(fields.locale),
		banner: text(fields.banner),
		icon: text(fields.icon),
		...(level === 0 || level === 1 ? { default_notifications: level } : {}),
	};
}

// The chats' own store has the layout (lib/stores/message-layout.svelte.ts): setting it there saves it and redraws
// every chat on screen at once.
function readMessageLayout(): MessageLayout {
	return messageLayout.value;
}

function writeMessageLayout(layout: MessageLayout) {
	messageLayout.value = layout;
}

/** The host of a page that has the app's stores: the web's sheets, and the main window. */
export const pageSettingsHost: SettingsHost = {
	logout,
	profileSaved: applyOwnProfile,
	spaceSaved: (spaceId, saved) => gatewaySpaces.update((spaces) => withSavedSpace(spaces, spaceId, saved)),
	spaceDeleted: (spaceId, name) => {
		// SPACE_DELETE follows; the Space goes at once, and with it its panes and its voice room.
		gatewaySpaces.update((spaces) => spaces.filter((space) => space.id !== spaceId));
		toast(`${name} was deleted`, "success");
	},
	messageLayout: readMessageLayout,
	setMessageLayout: writeMessageLayout,
	// The page that loaded the theme is the one whose code blocks show it.
	codeThemeChanged: () => {},
	// A sheet stays mounted while closed, with what was picked in it.
	stagedImages: () => Promise.resolve({}),
	stageImage: () => {},
};
