<script lang="ts">
	import { Bell, X as XIcon } from "@lucide/svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";

	// The web asks the browser for its permission to notify (DISENO-NOTIFICACIONES.md, objective 11) from a button, as a
	// browser takes the request only from a click. It shows while the browser hasn't been asked, and its × hides it until
	// the page loads again. The desktop app asks nothing: Windows lets it notify.
	let asking = $state(
		!isElectrobunWindow() && typeof Notification !== "undefined" && Notification.permission === "default",
	);

	// What the browser answers is read as each message notifies (lib/system-notifications.ts).
	function turnOn() {
		asking = false;
		void Notification.requestPermission();
	}
</script>

{#if asking}
	<div
		class="fixed bottom-4 left-1/2 z-9990 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/95 py-2 pr-2 pl-3 text-sm text-zinc-300 shadow-lg backdrop-blur-sm"
		role="region"
		aria-label="Notifications permission"
	>
		<Bell class="size-4 shrink-0 text-zinc-400" />
		<span class="min-w-0 flex-1">Turn on desktop notifications for new messages</span>
		<button
			type="button"
			class="shrink-0 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-900 transition-colors hover:bg-white"
			onclick={turnOn}
		>
			Turn on
		</button>
		<button
			type="button"
			class="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
			aria-label="Dismiss"
			onclick={() => (asking = false)}
		>
			<XIcon class="size-3.5" />
		</button>
	</div>
{/if}
