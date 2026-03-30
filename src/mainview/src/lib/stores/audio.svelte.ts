const STORAGE_KEY = "duvet_audio_settings";

export type SoundEvent =
	| "notification"
	| "join_vc"
	| "leave_vc"
	| "voice_calling"
	| "screen_sharing_on"
	| "screen_sharing_off";

const SOUND_FILES: Record<SoundEvent, string> = {
	notification: "/sounds/message_notification.ogg",
	join_vc: "/sounds/join_vc.ogg",
	leave_vc: "/sounds/leave_vc.ogg",
	voice_calling: "/sounds/voice_calling.ogg",
	screen_sharing_on: "/sounds/screen_sharing_on.ogg",
	screen_sharing_off: "/sounds/screen_sharing_off.ogg",
};

export interface AudioSettings {
	master: number;
	notification: number;
	join_vc: number;
	leave_vc: number;
	voice_calling: number;
	screen_sharing_on: number;
	screen_sharing_off: number;
}

const DEFAULTS: AudioSettings = {
	master: 100,
	notification: 100,
	join_vc: 100,
	leave_vc: 100,
	voice_calling: 100,
	screen_sharing_on: 100,
	screen_sharing_off: 100,
};

function load(): AudioSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {}
	return { ...DEFAULTS };
}

function save(settings: AudioSettings) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

class AudioSettingsStore {
	settings = $state<AudioSettings>(load());

	private audioCache = new Map<SoundEvent, HTMLAudioElement>();

	get(event: SoundEvent): number {
		return this.settings[event];
	}

	set(event: SoundEvent, volume: number) {
		this.settings[event] = Math.max(0, Math.min(200, volume));
		save(this.settings);
	}

	setMaster(volume: number) {
		this.settings.master = Math.max(0, Math.min(200, volume));
		save(this.settings);
	}

	private effectiveVolume(event: SoundEvent): number {
		return Math.min((this.settings.master / 200) * (this.settings[event] / 200), 1);
	}

	play(event: SoundEvent): HTMLAudioElement | null {
		const vol = this.effectiveVolume(event);
		if (vol <= 0) return null;

		let audio = this.audioCache.get(event);
		if (!audio) {
			audio = new Audio(SOUND_FILES[event]);
			this.audioCache.set(event, audio);
		}
		audio.volume = vol;
		audio.currentTime = 0;
		audio.play().catch(() => {});
		return audio;
	}

	playLoop(event: SoundEvent): HTMLAudioElement | null {
		const vol = this.effectiveVolume(event);
		if (vol <= 0) return null;

		const audio = new Audio(SOUND_FILES[event]);
		audio.volume = vol;
		audio.loop = true;
		audio.play().catch(() => {});
		return audio;
	}
}

export const audioStore = new AudioSettingsStore();
