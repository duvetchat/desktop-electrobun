import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const faces = readFileSync(join(import.meta.dir, "OnlineFriendFaces.svelte"), "utf8");

test("the faces overlap, open their gaps on hover or focus, and wrap onto the next row when full", () => {
	for (const part of [
		"group/faces",
		"flex min-w-0 flex-wrap items-center",
		"gap-y-1",
		"-space-x-2",
		"hover:space-x-1",
		"focus-within:space-x-1",
		"transition-[margin] duration-150",
		"group-hover/faces:ring-0",
		"group-focus-within/faces:ring-0",
		"motion-reduce:transition-none",
	])
		expect(faces, part).toContain(part);
});

test("each face keeps its presence in the corner, and its cloud is portalled out of the scroll", () => {
	for (const part of [
		"<Tooltip.Provider delayDuration={0} disableHoverableContent>",
		"<Tooltip.Root>",
		"<Tooltip.Trigger>",
		"<Tooltip.Portal>",
		"<Tooltip.Content",
		'side="top"',
		"sideOffset={10}",
		"collisionPadding={8}",
		"z-[3000]",
		"<Avatar {size} status={friend.status} mobileOnly={friend.mobileOnly} {ring}>",
		"statusLabel(friend.status)",
		"friend.activity",
		"shell_now_message_friend_doing",
		'friend.activity.kind === "playing"',
		"title={friend.activity.text}",
		"GameIcon",
		"MusicIcon",
		'"people_presence_online"',
		'"people_presence_dnd"',
		'"people_presence_offline"',
		"Tooltip.Arrow",
		"bg-duvet-pill",
		"shadow-duvet-float",
		"ring-duvet-line",
		"ring-1",
		"max-w-48",
	])
		expect(faces, part).toContain(part);
});

test("every face is a jump target, and a stack with more friends ends in their count", () => {
	for (const part of [
		"data-jump",
		't("shell_now_message_friend", { name: friend.name })',
		"onclick={() => onFriend(friend.id)}",
		't("shell_now_more_friends", { count: more })',
		't("shell_now_more_online", { count: more })',
		"+{formatNumber(more)}",
		"onclick={onMore}",
	])
		expect(faces, part).toContain(part);
});
