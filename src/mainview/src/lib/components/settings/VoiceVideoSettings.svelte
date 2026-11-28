<script lang="ts">
	import { AudioLines, AudioWaveform, Mic, Video } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import { t } from "$lib/i18n";
	import { cameraName, micName, type CameraChoice, type MicChoice } from "$lib/media-state";
	import { cameraConstraints, cameraErrorMessage } from "$lib/video";
	import SettingsGroup from "./SettingsGroup.svelte";
	import SettingsRow from "./SettingsRow.svelte";
	import { SELECT } from "./recipes";

	// Settings → Voice and video (#357, DESIGN-MAP.md S-54): the microphone voice uses, a test that shows it hears the
	// user, noise suppression, and the camera voice uses with a preview of it. The microphone test opens the mic only
	// while it runs, and plays nothing back: it draws the input's level, so the user hears no echo and needs no
	// headphones. The camera's preview is mirrored, as one sees oneself.
	let {
		micId,
		cameraId,
		noiseSuppression,
		mics,
		micsLoaded,
		cameras,
		camerasLoaded,
		onSelectMic,
		onSelectCamera,
		onToggleNoiseSuppression,
		onRefreshMics,
		onRefreshCameras,
	}: {
		/** The microphone voice uses; empty is the system's default. */
		micId: string;
		/** The camera voice uses; empty is the system's default. */
		cameraId: string;
		noiseSuppression: boolean;
		/** The cameras the select offers, as the last look found them. */
		cameras: CameraChoice[];
		/** Whether the cameras were looked for yet: before, the row says nothing rather than "No cameras found". */
		camerasLoaded: boolean;
		/** The microphones the select offers, as the last look found them. */
		mics: MicChoice[];
		/** Whether the microphones were looked for yet: before, the row says nothing rather than "No microphones found". */
		micsLoaded: boolean;
		onSelectMic: (id: string) => void;
		onSelectCamera: (id: string) => void;
		onToggleNoiseSuppression: (on: boolean) => void;
		/** Looks for the microphones again: when the section opens, and as devices come and go. */
		onRefreshMics: () => void | Promise<void>;
		/** Looks for the cameras again: when the section opens, and as devices come and go. */
		onRefreshCameras: () => void | Promise<void>;
	} = $props();

	let testing = $state(false);
	let level = $state(0);
	// The test couldn't open the microphone: the row says so under its button.
	let testFailed = $state(false);
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
		testFailed = false;
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
			testFailed = true;
		}
	}

	// ── The camera's preview ────────────────────────────────────────────────────
	let preview = $state<MediaStream | null>(null);
	let previewError = $state<string | null>(null);
	// Until the camera opens, the preview says so: an empty box first would look like a camera that sees nothing.
	let opening = $state(true);
	let cameraStream: MediaStream | null = null;
	// A preview asked for twice: the one that finishes last is the one that counts.
	let cameraRun = 0;

	function srcObject(node: HTMLVideoElement, media: MediaStream) {
		node.srcObject = media;
		return {
			update(next: MediaStream) {
				if (node.srcObject !== next) node.srcObject = next;
			},
		};
	}

	function stopPreview() {
		cameraRun++;
		cameraStream?.getTracks().forEach((track) => track.stop());
		cameraStream = null;
		preview = null;
		opening = false;
	}

	async function startPreview() {
		stopPreview();
		const mine = ++cameraRun;
		opening = true;
		previewError = null;
		try {
			const opened = await navigator.mediaDevices.getUserMedia(cameraConstraints(cameraId));
			if (mine !== cameraRun) {
				opened.getTracks().forEach((track) => track.stop());
				return;
			}
			cameraStream = opened;
			preview = opened;
			// The ask filled in the cameras' names: the list shows them now.
			void onRefreshCameras();
		} catch (err) {
			if (mine !== cameraRun) return;
			previewError = cameraErrorMessage(err);
		} finally {
			if (mine === cameraRun) opening = false;
		}
	}

	// A different camera is a different preview: changing it opens that one, rather than leaving the old one running
	// while the picker says another.
	let previewedCamera: string | null = null;
	$effect(() => {
		if (previewedCamera === cameraId) return;
		previewedCamera = cameraId;
		void startPreview();
	});

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
		// The section is open while this component is: the lists follow the devices plugged in or out meanwhile.
		const refresh = () => {
			void onRefreshMics();
			void onRefreshCameras();
		};
		refresh();
		navigator.mediaDevices?.addEventListener("devicechange", refresh);
		return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
	});

	$effect(() => () => {
		stopTest();
		stopPreview();
	});
</script>

<SettingsGroup title={t("settings_voice_title")} note={t("settings_voice_note")}>
	<SettingsRow
		label={t("settings_mic_label")}
		line={micsLoaded && mics.length === 0 ? t("settings_mic_none") : t("settings_mic_line")}
		icon={Mic}
		labelFor="voice-microphone"
	>
		<select
			id="voice-microphone"
			class={SELECT}
			value={micId}
			onchange={(event) => onSelectMic(event.currentTarget.value)}
		>
			<option value="">{t("settings_device_default")}</option>
			{#each mics as mic, index (mic.id || index)}
				<option value={mic.id}>{micName(mic, index)}</option>
			{/each}
		</select>
	</SettingsRow>

	<SettingsRow label={t("settings_input_level")} line={t("settings_input_level_line")} icon={AudioWaveform}>
		<div class="flex flex-col items-end gap-1">
			<div class="flex items-center gap-2">
				<div
					class="bg-duvet-toggle-off h-1.5 w-32 overflow-hidden rounded-full"
					role="meter"
					aria-label={t("settings_input_level")}
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
					{testing ? t("settings_mic_test_stop") : t("settings_mic_test")}
				</Button>
			</div>
			{#if testFailed}<p class="text-duvet-danger text-[12px]" role="alert">{t("settings_mic_test_failed")}</p>{/if}
		</div>
	</SettingsRow>

	<SettingsRow label={t("settings_noise_suppression")} line={t("settings_noise_suppression_line")} icon={AudioLines}>
		<Toggle
			checked={noiseSuppression}
			onCheckedChange={onToggleNoiseSuppression}
			label={t("settings_noise_suppression")}
		/>
	</SettingsRow>
</SettingsGroup>

<SettingsGroup title={t("settings_video_title")} note={t("settings_video_note")}>
	<div class="p-3.5">
		<div class="bg-duvet-sunk ring-duvet-line relative aspect-video overflow-hidden rounded-xl ring-1">
			{#if preview}
				<video use:srcObject={preview} autoplay muted playsinline class="size-full -scale-x-100 object-cover"></video>
				<span
					class="bg-duvet-media-scrim text-duvet-media-ink absolute bottom-2 left-2 rounded-md px-2 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase backdrop-blur-md"
				>
					{t("settings_camera_preview")}
				</span>
			{:else}
				<div
					class="text-duvet-ink2 flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-[13px]"
				>
					{#if opening}
						<p>{t("settings_camera_opening")}</p>
					{:else}
						<p class="text-duvet-ink">{previewError ?? t("settings_camera_none")}</p>
						<Button variant="secondary" size="sm" onclick={() => void startPreview()}
							>{t("settings_camera_retry")}</Button
						>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<SettingsRow
		label={t("settings_camera_label")}
		line={camerasLoaded && cameras.length === 0 ? t("settings_cameras_none") : t("settings_camera_line")}
		icon={Video}
		labelFor="video-camera"
	>
		<select
			id="video-camera"
			class={SELECT}
			value={cameraId}
			onchange={(event) => onSelectCamera(event.currentTarget.value)}
		>
			<option value="">{t("settings_device_default")}</option>
			{#each cameras as camera, index (camera.id || index)}
				<option value={camera.id}>{cameraName(camera, index)}</option>
			{/each}
		</select>
	</SettingsRow>
</SettingsGroup>
