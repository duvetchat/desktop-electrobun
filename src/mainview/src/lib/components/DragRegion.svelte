<script lang="ts">
	import { onMount } from "svelte";
	import { currentShell } from "$lib/platform";
	import { maximizeWindow, pressDrags, startWindowDrag, usesNativeWindowDrag } from "$lib/window-controls";

	// An empty stretch of a title line that drags the window, and maximizes or restores it on a double click (#357,
	// S-01). Electrobun's preload starts a window move on any press inside an element with its drag class, whatever is
	// under the pointer, so a drag region never wraps a control: it is the room between them. On the web it is only
	// room.
	let { class: className = "" }: { class?: string } = $props();

	const draggable = currentShell().draggableTitleBar;
	// Where Windows' own move loop drags the window, the region reports its presses instead of carrying the class.
	let native = $state(false);

	onMount(() => {
		if (!draggable) return;
		let gone = false;
		void usesNativeWindowDrag().then((yes) => {
			if (!gone) native = yes;
		});
		return () => {
			gone = true;
		};
	});

	function onPress(event: MouseEvent) {
		if (native && pressDrags(event.button, event.target instanceof Element ? event.target : null)) {
			void startWindowDrag();
		}
	}
</script>

<div
	class="min-w-0 {draggable && !native ? 'electrobun-webkit-app-region-drag' : ''} {className}"
	role="presentation"
	data-drag-region={draggable ? "" : undefined}
	onmousedown={draggable ? onPress : undefined}
	ondblclick={draggable ? () => void maximizeWindow() : undefined}
></div>
