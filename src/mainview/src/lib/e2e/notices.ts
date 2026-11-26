// What the app says about encrypted conversations, word for word as the mobile app says it (PLAN-E2E-CLIENTES.md,
// its notices): notices.test.ts holds both to the table in testing/e2e-conventions.json, which the mobile app's test reads.

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
	// The encrypted backup as Settings shows it, and a new device's restore as it goes (task 32).
	backup: "Encrypted backup",
	backup_up_to_date: "Up to date",
	backup_uploading: "Backing up…",
	backup_restoring: "Restoring your messages: {done} of {total}",
	backup_too_large: "Your encrypted backup is paused: a day of messages is too large to back up.",
	device_added: "A new device was added to your account: {name}.",
	delete_device: "Remove this device and delete its data",
	too_long: "Message too long",
	edit_refused: "Your edit couldn't be saved for everyone.",
	delete_refused: "Your message couldn't be deleted for everyone.",
	loading_message: "Loading message",
	not_ready: "Encrypted conversations aren't ready on this device",
	too_many_waiting: "Too many messages wait to be sent here: send or dismiss them first",
	search_split:
		"In an encrypted conversation, pinned: and has:sticker can't be combined with words or with has:image, video or sound.",
	// A conversation's files (task 18).
	file_encrypted: "Encrypted file",
	file_progress: "Downloading · {percent}%",
	file_altered: "This file isn't the one its sender sent, so it isn't shown.",
	file_unavailable: "This file can't be shown.",
	file_download_failed: "Couldn't download this file. Try again.",
	files_gone: "This message's files aren't on this device any more. Dismiss it, then send them again.",
	gif_failed: "The GIF couldn't be sent.",
	file_save: "Save",
	file_save_named: "Save {name}",
	file_play: "Play video",
	file_show: "Show picture",
	file_named: "{name}: {status}",
	// A conversation's members (task 22).
	group_full: "A group can have 20 members at most.",
	restart_leaves_out: "Restarting leaves out {names}, who are no longer in this conversation.",
	restart_refused: "Encryption can't restart here yet.",
	members_now: "Members now: {names}",
	change_unanswered: "No answer came yet: Duvet tries again on its own.",
	// A conversation's history shared with a member, and the offer of what another member shared (task 30).
	share_history: "Share history",
	share_history_with: "Share history with {name}",
	share_history_line: "{name} gets the messages this device holds from the time you pick, marked as shared by you.",
	share_history_send: "Share",
	share_history_sharing: "Sharing…",
	share_history_truncated: "Not all of it fit: {name} gets the messages from {date} on.",
	share_history_limit: "You can share history 10 times an hour. Try again {when}.",
	share_history_failed: "Couldn't share the history. Try again.",
	share_history_no_device: "{name} has no device that can receive it yet.",
	shared_with_you: "{a} shared {range} with you",
	shared_add: "Add to this device",
	shared_add_failed: "Couldn't add the shared messages. Try again.",
	// The mobile app's push, when a message can't be read in time (its task 21): this app doesn't show it.
	new_message: "New message",
	// A new device's setup and its approval (task 26).
	use_code: "Use a code instead",
	approval_code_hint: "A computer approving this device will show this code",
	code_accepted: "Code accepted: confirm it on your other device.",
	code_mismatch: "That isn't the code your other device shows.",
	approval_ask: "Is this device yours?",
	approval_confirm_after: "Confirm only after your new device accepts it",
	start_over_warning:
		"Starting over makes new security keys for your account. The history of your encrypted conversations can't be read any more, and your contacts will see that your keys changed.",
	// A contact's security number, their mark once verified, and the question before sending after a verified contact's
	// key changed (task 28), beside key_changed and key_changed_verified.
	verify_number: "Verify security number",
	mark_verified: "Mark as verified",
	verified: "Verified",
	send_anyway: "Send anyway",
} as const;

export type NoticeKey = keyof typeof NOTICES;

/** A notice's text, its {names} filled from values in one pass: what a value holds is never read as a name. */
export function notice(key: NoticeKey, values: Readonly<Record<string, string | undefined>> = {}): string {
	return NOTICES[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
