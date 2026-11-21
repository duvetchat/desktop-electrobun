<script lang="ts">
	import { AudioLines, AudioWaveform, Mic } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import { micName, type MicChoice } from "$lib/media-state";
	import SettingsGroup from "./SettingsGroup.svelte";
	import SettingsRow from "./SettingsRow.svelte";
	import { SELECT } from "./recipes";

	// Settings → Voice and video (#357, DESIGN-MAP.md S-54): the microphone voice uses, a test that shows it hears the
	// user, and noise suppression. The test opens the microphone only while it runs, and plays nothing back: it draws
	// the input's level, so the user hears no echo and needs no headphones.
	let {
		micId,
		noiseSuppression,
		mics,
		micsLoaded,
		onSelectMic,
		onToggleNoiseSuppression,
		onRefreshMics,
	}: {
		/** The microphone voice uses; empty is the system's default. */
		micId: string;
		noiseSuppression: boolean;
		/** The microphones the select offers, as the last look found them. */
		mics: MicChoice[];
		/** Whether the microphones were looked for yet: before, the row says nothing rather than "No microphones found". */
		micsLoaded: boolean;
		onSelectMic: (id: string) => void;
		onToggleNoiseSuppression: (on: boolean) => void;
		/** Looks for the microphones again: when the section opens, and as devices come and go. */
		onRefreshMics: () => void | Promise<void>;
	} = $props();

	let testing = $state(false);
	let level = $state(0);
	let testError = $state<string | null>(null);
	let stream: MediaStream | null = null;
	let context: AudioContext | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let frame = 0;
	// A test asked for twice: the one that finishes last is the one that counts.
	let run = 0;

	function stopTest() {
		run++;
		cancelAnimationFrame(frame);
		frame = 0;
		source?.disconnect();
		source = null;
		void context?.close();
		context = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		testing = false;
		level = 0;
	}

	function meter(analyser: AnalyserNode) {
		const samples = new Uint8Array(analyser.fftSize);
		const mine = run;
		const tick = () => {
			if (mine !== run) return;
			analyser.getByteTimeDomainData(samples);
			let power = 0;
			for (const sample of samples) {
				const wave = (sample - 128) / 128;
				power += wave * wave;
			}
			// Speech sits well under a full wave: the root mean square, lifted to fill the meter, and eased so it
			// doesn't flicker between frames.
			const heard = Math.min(1, Math.sqrt(power / samples.length) * 4);
			level += (heard - level) * 0.35;
			frame = requestAnimationFrame(tick);
		};
		tick();
	}

	async function startTest() {
		stopTest();
		const mine = run;
		testing = true;
		testError = null;
		try {
			const opened = await navigator.mediaDevices.getUserMedia({
				audio: micId ? { deviceId: { exact: micId } } : true,
			});
			if (mine !== run) {
				opened.getTracks().forEach((track) => track.stop());
				return;
			}
			stream = opened;
			// The ask filled in the microphones' names: the list shows them now.
			void onRefreshMics();
			const Audio = window.AudioContext || (window as any).webkitAudioContext;
			context = new Audio();
			source = context.createMediaStreamSource(opened);
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			meter(analyser);
		} catch {
			if (mine !== run) return;
			stopTest();
			testError = "Couldn't open your microphone.";
		}
	}

	// A different microphone is a different test: changing it stops the one under way, rather than leaving the old one
	// running while the picker says another.
	let testedMic: string | null = null;
	$effect(() => {
		if (testedMic === null) {
			testedMic = micId;
			return;
		}
		if (micId === testedMic) return;
		testedMic = micId;
		stopTest();
	});

	$effect(() => {
		// The section is open while this component is: the list follows the devices plugged in or out meanwhile.
		void onRefreshMics();
		navigator.mediaDevices?.addEventListener("devicechange", onRefreshMics);
		return () => navigator.mediaDevices?.removeEventListener("devicechange", onRefreshMics);
	});

	$effect(() => () => stopTest());
</script>

<SettingsGroup title="Voice" note="The test opens your microphone only while it runs. Others don't hear it.">
	<SettingsRow
		label="Microphone"
		line={micsLoaded && mics.length === 0 ? "No microphones found." : "The one your voice uses."}
		icon={Mic}
		labelFor="voice-microphone"
	>
		<select
			id="voice-microphone"
			class={SELECT}
			value={micId}
			onchange={(event) => onSelectMic(event.currentTarget.value)}
		>
			<option value="">System default</option>
			{#each mics as mic, index (mic.id || index)}
				<option value={mic.id}>{micName(mic, index)}</option>
			{/each}
		</select>
	</SettingsRow>

	<SettingsRow label="Input level" line="Say something to see the meter move." icon={AudioWaveform}>
		<div class="flex flex-col items-end gap-1">
			<div class="flex items-center gap-2">
				<div
					class="bg-duvet-toggle-off h-1.5 w-32 overflow-hidden rounded-full"
					role="meter"
					aria-label="Input level"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(level * 100)}
				>
					<div
						class="bg-duvet-alive h-full rounded-full transition-[width] duration-75 motion-reduce:transition-none"
						style="width: {Math.round(level * 100)}%"
					></div>
				</div>
				<Button variant="secondary" size="sm" onclick={() => (testing ? stopTest() : void startTest())}>
					{testing ? "Stop test" : "Test microphone"}
				</Button>
			</div>
			{#if testError}<p class="text-duvet-danger text-[11px]" role="alert">{testError}</p>{/if}
		</div>
	</SettingsRow>

	<SettingsRow label="Noise suppression" line="Cuts the background noise from what others hear." icon={AudioLines}>
		<Toggle checked={noiseSuppression} onCheckedChange={onToggleNoiseSuppression} label="Noise suppression" />
	</SettingsRow>
</SettingsGroup>
