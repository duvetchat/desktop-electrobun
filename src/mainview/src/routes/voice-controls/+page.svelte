<script lang="ts">
	import { onMount } from "svelte";
	import { Pin, PinOff, X } from "@lucide/svelte";
	import MediaPanel from "$lib/components/MediaPanel.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import { getElectrobunRpc, isElectrobunWindow, type AppRPCClient } from "$lib/electrobun-rpc";
	import {
		MEDIA_CHANNEL,
		parseMediaState,
		remoteMediaActions,
		type MediaCommandName,
		type MediaState,
	} from "$lib/media-state";
	import { MEDIA_WINDOW_CHANNEL, type MediaWindowCommand } from "$lib/media-window";
	import { currentShell } from "$lib/platform";
	import { parseThemePref, THEME_KEY } from "$lib/theme";
	import { setThemePref } from "$lib/theme.svelte";
	import { voiceKey, voiceKeyLabels } from "$lib/voice-keys";
	import { StateMirror } from "$lib/window-link";

	// The media controls' pop-out (#357, BRIEF.md "Media controls"): a small window of the desktop app holding the same
	// block as the sidebar, the one row out of voice and the call panel in it. The call isn't here: this page mirrors
	// the main window's state and sends it commands, both through the Bun process (src/bun/media-window.ts). It must
	// never reach lib/api/ws/connection.ts, nor renew the session (module-graph.test.ts keeps it so).
	const shell = currentShell();
	const isMac = shell.os === "mac";
	const keys = voiceKeyLabels(isMac);

	let media = $state<MediaState | null>(null);
	let pinned = $state(false);
	let rpc: AppRPCClient | null = null;

	/** A command for the main window's page, or for Bun when it is about the window: its result, or why not. */
	async function command(channel: string, name: string, args?: unknown): Promise<unknown> {
		if (!rpc) throw new Error("The window isn't connected yet");
		const answer = await rpc.request.windowCommand({ channel, name, args });
		if (!answer.ok) throw new Error(answer.error);
		return answer.result;
	}
	const aboutWindow = (name: MediaWindowCommand, args?: unknown) => command(MEDIA_WINDOW_CHANNEL, name, args);

	const actions = remoteMediaActions(
		(name: MediaCommandName, args?: unknown) => command(MEDIA_CHANNEL, name, args),
		(name, error) => console.warn(`[voice-controls] ${name} wasn't taken:`, error),
	);

	function readPinned(result: unknown) {
		if (typeof result === "object" && result !== null && "pinned" in result) pinned = result.pinned === true;
	}

	async function togglePin() {
		try {
			readPinned(await aboutWindow("pin", !pinned));
		} catch (error) {
			console.warn("[voice-controls] The pin wasn't taken:", error);
		}
	}

	// Put back, and the window's own close: Bun closes the window and tells the main window, which docks the controls.
	function putBack() {
		aboutWindow("putBack").catch(() => rpc?.send.closeWindow());
	}

	// The mute and deafen shortcuts work here too, while this window has the keyboard.
	function onkeydown(event: KeyboardEvent) {
		const key = voiceKey(event, isMac);
		if (!key) return;
		event.preventDefault();
		if (key === "mute") actions.toggleMute();
		else actions.toggleDeafen();
	}

	// The windows share localStorage: the theme picked in the main window is followed at once, and signing out there,
	// which removes the session, closes this window.
	function onstorage(event: StorageEvent) {
		if (event.key === THEME_KEY) setThemePref(parseThemePref(event.newValue));
		else if (event.key === "duvet_session_token" && !event.newValue) rpc?.send.closeWindow();
	}

	onMount(() => {
		// Only ever a window of the desktop app: in a browser there is nothing to mirror.
		if (!isElectrobunWindow()) {
			location.replace("/");
			return;
		}
		const mirror = new StateMirror<unknown>(MEDIA_CHANNEL);
		const stop = mirror.subscribe((value) => {
			const parsed = parseMediaState(value);
			if (parsed) media = parsed;
		});
		void getElectrobunRpc().then(async (client) => {
			if (!client) return;
			rpc = client;
			client.on.windowState((message) => mirror.accept(message));
			// Now that this page listens: Bun sends the latest state again, and says how the window is pinned.
			readPinned(await aboutWindow("hello").catch(() => null));
		});
		return stop;
	});
</script>

<svelte:head>
	<title>Voice controls</title>
</svelte:head>

<svelte:window {onkeydown} {onstorage} />

<!-- Over the app's title bar, which the layout draws for every page: this window has its own strip. -->
<div class="bg-duvet-sb-bg text-duvet-ink fixed inset-0 z-60 flex flex-col select-none">
	<!-- The strip drags the window. On macOS the system's lights sit at its left; elsewhere the page closes it. -->
	<header
		class="electrobun-webkit-app-region-drag flex h-9 shrink-0 items-center gap-1 pr-1.5 {shell.nativeTrafficLights
			? 'pl-[75px]'
			: 'pl-3'}"
	>
		<h1 class="text-duvet-ink2 min-w-0 flex-1 truncate text-xs font-semibold">Voice controls</h1>
		<div class="electrobun-webkit-app-region-no-drag flex shrink-0 items-center gap-0.5">
			<Tooltip text={pinned ? "Stop keeping on top" : "Keep on top"}>
				{#snippet trigger(props)}
					<IconButton
						{...props}
						size="sm"
						label={pinned ? "Stop keeping on top" : "Keep on top"}
						active={pinned}
						aria-pressed={pinned}
						onclick={togglePin}
					>
						{#if pinned}<PinOff size={14} />{:else}<Pin size={14} />{/if}
					</IconButton>
				{/snippet}
			</Tooltip>
			<Button variant="quiet" size="sm" aria-label="Put the voice controls back in the sidebar" onclick={putBack}>
				Put back
			</Button>
			{#if shell.ownWindowControls}
				<IconButton size="sm" label="Close window" onclick={putBack}>
					<X size={14} />
				</IconButton>
			{/if}
		</div>
	</header>
	<main class="min-h-0 flex-1 overflow-y-auto px-2.5 pt-0.5 pb-2.5">
		{#if media}
			<MediaPanel state={media} {actions} {keys} framed={false} />
		{/if}
	</main>
</div>
