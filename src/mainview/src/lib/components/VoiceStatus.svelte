<script lang="ts">
	import {
		SignalHigh as CellSignalFullIcon,
		SignalMedium as CellSignalMediumIcon,
		SignalLow as CellSignalLowIcon,
		PhoneOff as PhoneDisconnectIcon,
	} from "@lucide/svelte";
	import {
		currentUser,
		activeVoiceRoomId,
		gatewaySpaces,
		voiceConnectionState,
		activeCall,
		conversations,
	} from "$lib/stores.svelte";
	import { callName } from "$lib/now";
	import { disconnectVoice } from "$lib/voice";
	import { fly } from "svelte/transition";
	import { getHostURL } from "$lib/common/common";

	// The voice the user is in, in the user's panel (ProfileRow): where they're connected, the ping to the API, and
	// Disconnect. Above the profile row it is a pill; in the folded column, the ping's mark and a Disconnect button over
	// the avatar. With UserStatusBar's profile row and media controls, it was one component until the redesign (#357).
	let {
		collapsed = false,
		showVoice = true,
	}: {
		collapsed?: boolean;
		/** Off where the voice the user is in shows on its own, as the spaces column's Now section does. */
		showVoice?: boolean;
	} = $props();

	const activeVoiceSpace = $derived(
		$activeVoiceRoomId ? $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === $activeVoiceRoomId)) : null,
	);
	const activeVoiceRoom = $derived(activeVoiceSpace?.rooms.find((r) => r.id === $activeVoiceRoomId));
	const isInConversationCall = $derived(
		$activeCall?.state === "connected" && $activeVoiceRoomId === $activeCall?.conversationId,
	);
	const callConversationName = $derived.by(() => {
		if (!isInConversationCall || !$activeCall) return "";
		return callName(
			$conversations.find((c) => c.id === $activeCall!.conversationId),
			$currentUser?.id,
		);
	});

	let ping = $state<number | null>(null);

	const connectionLabel: Record<RTCPeerConnectionState, string> = {
		new: "Connecting...",
		connecting: "Connecting...",
		connected: "Voice Connected",
		disconnected: "Reconnecting...",
		failed: "Connection Failed",
		closed: "Disconnected",
	};

	// The ping, every 3 s while in voice. Its interval ends with this effect, so with the panel too: a READY remounts the
	// app's UI while voice stays, and a panel left running its interval would fetch for the rest of the session (#315).
	$effect(() => {
		if (!$activeVoiceRoomId) {
			ping = null;
			return;
		}
		void measurePing();
		const pinging = setInterval(measurePing, 3000);
		return () => clearInterval(pinging);
	});

	async function measurePing() {
		try {
			const start = performance.now();
			await fetch(`${getHostURL()}/health`, { method: "GET", cache: "no-store" });
			ping = Math.round(performance.now() - start);
		} catch {
			ping = null;
		}
	}

	function pingIconColor(ms: number | null): string {
		if (ms === null || ms < 100) return "text-duvet-ink2";
		if (ms < 250) return "text-duvet-warn";
		return "text-duvet-danger";
	}

	function pingBgColor(ms: number | null): string {
		if (ms === null || ms < 100) return "bg-duvet-bg";
		if (ms < 250) return "bg-duvet-warn/15";
		return "bg-duvet-danger/15";
	}
</script>

{#if collapsed}
	{#if $activeVoiceRoomId}
		<div
			class="size-8 rounded-lg {isInConversationCall
				? 'bg-duvet-alive/20'
				: pingBgColor(ping)} mb-0.5 flex items-center justify-center"
			title={isInConversationCall ? "In call" : ping !== null ? `Ping: ${ping}ms` : "Measuring ping..."}
		>
			{#if isInConversationCall}
				<PhoneDisconnectIcon class="text-duvet-alive size-4" />
			{:else if ping !== null && ping >= 250}
				<CellSignalLowIcon class="size-4 {pingIconColor(ping)}" />
			{:else if ping !== null && ping >= 100}
				<CellSignalMediumIcon class="size-4 {pingIconColor(ping)}" />
			{:else}
				<CellSignalFullIcon class="size-4 {pingIconColor(ping)}" />
			{/if}
		</div>
		<button
			class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-danger flex size-8 items-center justify-center rounded-lg transition-colors"
			aria-label="Disconnect"
			onclick={disconnectVoice}
		>
			<PhoneDisconnectIcon class="size-4" />
		</button>
		<div class="border-duvet-line my-0.5 w-6 border-t"></div>
	{/if}
{:else if showVoice && $activeVoiceRoomId && (activeVoiceRoom || isInConversationCall)}
	<!-- Voice status pill -->
	<div
		class="border-duvet-line shrink-0 border-b"
		in:fly={{ y: 20, duration: 200, opacity: 1 }}
		out:fly={{ y: 20, duration: 200, opacity: 1 }}
	>
		<div class="flex items-center gap-2 px-2 py-1.5 select-none">
			<div
				class="relative flex shrink-0 items-center justify-center rounded-full p-1.5 {isInConversationCall
					? 'bg-duvet-alive/10'
					: pingBgColor(ping)}"
				title={isInConversationCall ? "In call" : ping !== null ? `Ping: ${ping}ms` : "Measuring ping..."}
			>
				{#if isInConversationCall}
					<PhoneDisconnectIcon class="text-duvet-alive size-3.5" />
				{:else if ping !== null && ping >= 250}
					<CellSignalLowIcon class="size-3.5 {pingIconColor(ping)}" />
				{:else if ping !== null && ping >= 100}
					<CellSignalMediumIcon class="size-3.5 {pingIconColor(ping)}" />
				{:else}
					<CellSignalFullIcon class="size-3.5 {pingIconColor(ping)}" />
				{/if}
			</div>
			<div class="flex min-w-0 flex-1 flex-col truncate">
				<span class="truncate text-xs font-semibold {isInConversationCall ? 'text-duvet-alive' : 'text-duvet-ink'}">
					{isInConversationCall ? "In Call" : connectionLabel[$voiceConnectionState]}
				</span>
				<span class="text-xxs text-duvet-ink2 truncate">
					{isInConversationCall
						? callConversationName
						: `${activeVoiceSpace?.name || ""} / ${activeVoiceRoom?.name || ""}`}
				</span>
			</div>
			<button
				class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink shrink-0 rounded-full p-1.5 transition-colors"
				aria-label="Disconnect"
				onclick={disconnectVoice}
			>
				<PhoneDisconnectIcon class="size-3.5" />
			</button>
		</div>
	</div>
{/if}
