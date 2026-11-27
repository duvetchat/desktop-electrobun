import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const faces = readFileSync(join(import.meta.dir, "OnlineFriendFaces.svelte"), "utf8");

test("the faces overlap until the pointer or the keys reach the stack, then open their gaps", () => {
	for (const part of [
		"group/faces",
		"-space-x-2",
		"hover:space-x-1",
		"focus-within:space-x-1",
		"group-hover/faces:ring-0",
		"group-focus-within/faces:ring-0",
		"transition-all duration-150",
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
		"sideOffset={12}",
		"collisionPadding={8}",
		"z-[3000]",
		"<Avatar {size} status={friend.status} mobileOnly={friend.mobileOnly} {ring}>",
		"statusLabel(friend.status)",
		'"people_presence_online"',
		'"people_presence_dnd"',
		'"people_presence_offline"',
		"bg-duvet-card",
		"drop-shadow",
		"rounded-2xl",
		"rotate-45",
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
