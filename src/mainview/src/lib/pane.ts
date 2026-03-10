import type { PaneLeaf, PaneNode, Tab } from "$lib/types";

function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function makeLeaf(
	tabs: Tab[] = [],
	activeChannelId: string | null = null,
): PaneLeaf {
	return {
		kind: "leaf",
		id: uid(),
		tabs,
		activeChannelId,
	};
}

export function makeSplit(
	a: PaneNode,
	b: PaneNode,
	direction: "h" | "v",
	ratio = 0.5,
): PaneNode {
	return {
		kind: "split",
		id: uid(),
		direction,
		ratio,
		a,
		b,
	};
}

export function updateLeaf(
	root: PaneNode,
	id: string,
	updater: (leaf: PaneLeaf) => PaneNode,
): PaneNode {
	if (root.kind === "leaf") {
		return root.id === id ? updater(root) : root;
	}
	return {
		...root,
		a: updateLeaf(root.a, id, updater),
		b: updateLeaf(root.b, id, updater),
	};
}

export function removeLeaf(root: PaneNode, id: string): PaneNode | null {
	if (root.kind === "leaf") {
		return root.id === id ? null : root;
	}
	const a = removeLeaf(root.a, id);
	const b = removeLeaf(root.b, id);
	if (a === null) {
		return b;
	}
	if (b === null) {
		return a;
	}
	return {
		...root,
		a,
		b,
	};
}
