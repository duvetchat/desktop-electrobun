<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { Play, Pause } from "@lucide/svelte";

let {
    src,
    compact = false,
}: {
    src: string;
    compact?: boolean;
} = $props();

let audioEl = $state<HTMLAudioElement | null>(null);
let playing = $state(false);
let currentTime = $state(0);
let duration = $state(0);
let bars = $state<number[]>([]);
let blobUrl = $state<string | null>(null);
let animFrame = 0;

const BAR_COUNT = 50;

function fallbackBars(s: string): number[] {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    const result: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
        hash = ((hash << 5) - hash + i * 7) | 0;
        result.push(0.15 + ((hash >>> 0) % 100) / 100 * 0.85);
    }
    return result;
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;
    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
    const numSamples = buffer.length;
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);
    const headerSize = 44;
    const wav = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(wav);

    function writeStr(offset: number, s: string) { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const s = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
    }
    return wav;
}

async function loadAndAnalyze(url: string) {
    try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();

        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        duration = decoded.duration;
        const raw = decoded.getChannelData(0);
        ctx.close();

        // Convert to WAV for perfect cross-browser seeking
        const wavBuf = audioBufferToWav(decoded);
        blobUrl = URL.createObjectURL(new Blob([wavBuf], { type: "audio/wav" }));

        // Analyze waveform
        const blockSize = Math.floor(raw.length / BAR_COUNT);
        if (blockSize === 0) return;

        const result: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            let sum = 0;
            const start = i * blockSize;
            for (let j = start; j < start + blockSize && j < raw.length; j++) {
                sum += Math.abs(raw[j]);
            }
            result.push(sum / blockSize);
        }

        const max = Math.max(...result, 0.001);
        bars = result.map((v) => 0.08 + (v / max) * 0.92);
    } catch {
        if (!blobUrl) blobUrl = url;
    }
}

function formatTime(secs: number): string {
    if (!isFinite(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function togglePlay() {
    if (!audioEl) return;
    if (playing) { audioEl.pause(); } else { audioEl.play().catch(() => {}); }
}

function handleSeek(e: MouseEvent) {
    if (!audioEl || !duration) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = ratio * duration;
    currentTime = audioEl.currentTime;
}

function syncFromElement() {
    if (!audioEl) return;
    currentTime = audioEl.currentTime;
    if (audioEl.duration && isFinite(audioEl.duration) && audioEl.duration > 0) {
        duration = audioEl.duration;
    }
}

function startTick() {
    stopTick();
    function tick() {
        syncFromElement();
        if (playing) animFrame = requestAnimationFrame(tick);
    }
    animFrame = requestAnimationFrame(tick);
}

function stopTick() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = 0; }
}

onMount(() => {
    bars = fallbackBars(src);
    loadAndAnalyze(src);
});

onDestroy(() => {
    stopTick();
    if (blobUrl && blobUrl !== src) URL.revokeObjectURL(blobUrl);
});

const progress = $derived(duration > 0 ? currentTime / duration : 0);
</script>

<div class="flex items-center gap-[10px] {compact ? 'px-[10px] py-[6px] rounded-[12px] max-w-none min-w-0' : 'pl-[10px] pr-[14px] py-[8px] rounded-[18px] max-w-[320px] min-w-[240px]'} bg-[oklch(0.22_0.01_80/0.8)] border border-[oklch(0.30_0.01_80/0.6)]">
    {#if blobUrl}
        <audio
            bind:this={audioEl}
            src={blobUrl}
            preload="auto"
            onloadedmetadata={() => { if (audioEl && isFinite(audioEl.duration)) duration = audioEl.duration; }}
            ondurationchange={() => { if (audioEl && isFinite(audioEl.duration)) duration = audioEl.duration; }}
            ontimeupdate={syncFromElement}
            onplay={() => { playing = true; startTick(); }}
            onpause={() => { playing = false; stopTick(); }}
            onended={() => { playing = false; currentTime = 0; stopTick(); }}
        ></audio>
    {/if}

    <button class="flex items-center justify-center {compact ? 'size-[28px]' : 'size-[36px]'} rounded-full border-none bg-[oklch(0.55_0.15_250)] text-white cursor-pointer shrink-0 transition-[background] duration-150 hover:bg-[oklch(0.62_0.15_250)]" onclick={togglePlay}>
        {#if playing}
            <Pause class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
        {:else}
            <Play class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
        {/if}
    </button>

    <div class="flex-1 min-w-0 flex flex-col gap-[4px]">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="relative flex items-center gap-[1.5px] {compact ? 'h-[20px]' : 'h-[28px]'} cursor-pointer" onclick={handleSeek}>
            {#each bars as height, i}
                {@const barProgress = i / bars.length}
                <div
                    class="flex-1 rounded-[2px] min-h-[3px] transition-[background] duration-100"
                    style="height: {height * 100}%; {barProgress <= progress ? 'background: oklch(0.65 0.15 250);' : 'background: oklch(0.40 0.01 80);'}"
                ></div>
            {/each}
            <div class="absolute top-1/2 {compact ? 'size-[8px]' : 'size-[10px]'} rounded-full bg-[oklch(0.65_0.15_250)] -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-[0_0_4px_oklch(0.5_0.15_250/0.5)]" style="left: {progress * 100}%;"></div>
        </div>
        <span class="text-[oklch(0.52_0.01_80)] tabular-nums {compact ? 'text-[10px]' : 'text-[11px]'}">{formatTime(playing || currentTime > 0 ? currentTime : duration)}</span>
    </div>
</div>
