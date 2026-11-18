<script lang="ts">
	import { currentShell } from "$lib/platform";
	import { appChrome } from "$lib/stores/chrome.svelte";
	import DragRegion from "$lib/components/DragRegion.svelte";
	import WindowControls from "$lib/components/WindowControls.svelte";

	// The desktop app's title bar on the pages outside the app's shell (#357, S-01): sign-in and the other auth pages,
	// the invite page, and the app while it connects. A slim line that drags the window, with each system's controls:
	// macOS's traffic lights keep their corner, Windows and Linux get their buttons at the end. The shell has its own
	// title line, shared by the sidebar's header and the tab strip, so this one stays away while it is up; the web
	// has none.
	const shell = currentShell();
</script>

{#if shell.draggableTitleBar && !appChrome.shellUp}
	<header class="bg-duvet-bg text-duvet-ink relative z-50 flex h-10 shrink-0 items-stretch" data-title-bar>
		<WindowControls side="start" />
		<DragRegion class="h-full flex-1" />
		<WindowControls side="end" />
	</header>
{/if}
