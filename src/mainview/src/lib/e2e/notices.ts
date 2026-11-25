// What the app says about encrypted conversations, word for word as the mobile app says it (PLAN-E2E-CLIENTES.md,
// «Avisos»): notices.test.ts holds both to the table in testing/e2e-conventions.json, which the mobile app's test reads.

export const NOTICES = {
	recovery_title: "Save your recovery key",
	recovery_saved: "I saved it",
	waiting: "Waiting for this message",
	waiting_detail: "It will show up when the sender's device delivers it.",
	no_device: "{name} can't receive encrypted messages yet. Your device will pass them on when they can.",
	key_changed: "{name}'s security key changed.",
	key_changed_verified: "You had verified {name}. Check their security number before you send.",
	cutover: "Messages from before end-to-end encryption were deleted on {date}",
	update: "Update Duvet",
	no_e2e_here: "Direct messages aren't available in this app yet. Use Duvet on the web.",
	paused: "Encrypted conversations are paused. Your message will be sent when they're back.",
	unsupported_browser: "This browser can't open encrypted conversations.",
	before_joining: "Messages from before you joined aren't on this device. Any member can share them.",
	shared: "{a} shared {range} with {b}",
	shared_by: "shared by {name}",
	range_day: "the last 24 hours",
	range_week: "the last 7 days",
	range_month: "the last 30 days",
	range_all: "the conversation's history",
	inactive_device: "Not seen in 45 days",
	inactive_warning: "{device} hasn't connected in over 45 days. Remove it if you don't use it.",
	blocked: "This conversation can't go on securely.",
	blocked_owner: "Restart encryption",
	blocked_wait: "Waiting for {owner} to restart it.",
	removed_device: "This device was removed from your account.",
	locked: "Encrypted conversations are open in another Duvet window.",
	wait_owner: "Waiting for {owner} to open this group",
	wait_rejoin: "You'll be back in this conversation when another member opens it.",
	members_changed: "This conversation's members changed since you last saw it.",
	members_accept: "Open with these members",
	backup_paused: "Your encrypted backup is paused: your storage is full.",
	device_added: "A new device was added to your account: {name}.",
	delete_device: "Remove this device and delete its data",
	too_long: "Message too long",
} as const;

export type NoticeKey = keyof typeof NOTICES;

/** A notice's text, its {names} filled from values in one pass: what a value holds is never read as a name. */
export function notice(key: NoticeKey, values: Readonly<Record<string, string | undefined>> = {}): string {
	return NOTICES[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
