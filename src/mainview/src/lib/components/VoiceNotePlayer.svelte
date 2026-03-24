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

let audio = $state<HTMLAudioElement | null>(null);
let playing = $state(false);
let currentTime = $state(0);
let duration = $state(0);
let bars = $state<number[]>([]);
let loading = $state(true);
let animFrame = 0;

const BAR_COUNT = 50;

async function analyzeAudio(url: string): Promise<number[]> {
    try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const raw = decoded.getChannelData(0);
        audioCtx.close();

        const blockSize = Math.floor(raw.length / BAR_COUNT);
        const result: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            let sum = 0;
            const start = i * blockSize;
            for (let j = start; j < start + blockSize && j < raw.length; j++) {
                sum += Math.abs(raw[j]);
            }
            result.push(sum / blockSize);
        }

        // Normalize to 0..1
        const max = Math.max(...result, 0.01);
        return result.map((v) => 0.08 + (v / max) * 0.92);
    } catch {
        // Fallback: generate from hash
        return fallbackBars(url);
    }
}

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

function formatTime(secs: number): string {
    if (!isFinite(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function togglePlay() {
    if (!audio) return;
    if (playing) { audio.pause(); } else { audio.play(); }
}

function handleSeek(e: MouseEvent) {
    if (!audio || !duration) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    currentTime = audio.currentTime;
}

function tick() {
    if (audio) currentTime = audio.currentTime;
    if (playing) animFrame = requestAnimationFrame(tick);
}

onMount(async () => {
    bars = fallbackBars(src);
    loading = true;
    bars = await analyzeAudio(src);
    loading = false;
});

onDestroy(() => { if (animFrame) cancelAnimationFrame(animFrame); });

const progress = $derived(duration > 0 ? currentTime / duration : 0);
</script>

<div class="vn-player" class:vn-compact={compact}>
    <audio
        bind:this={audio}
        {src}
        preload="metadata"
        onloadedmetadata={() => { if (audio) duration = audio.duration; }}
        onplay={() => { playing = true; tick(); }}
        onpause={() => { playing = false; }}
        onended={() => { playing = false; currentTime = 0; }}
    ></audio>

    <button class="vn-play" onclick={togglePlay}>
        {#if playing}
            <Pause class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
        {:else}
            <Play class={compact ? "size-3.5" : "size-5"} fill="currentColor" stroke="none" />
        {/if}
    </button>

    <div class="vn-body">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="vn-waveform" onclick={handleSeek}>
            {#each bars as height, i}
                {@const barProgress = i / bars.length}
                <div
                    class="vn-bar"
                    style="height: {height * 100}%; {barProgress <= progress ? 'background: oklch(0.65 0.15 250);' : 'background: oklch(0.40 0.01 80);'}"
                ></div>
            {/each}
            <div class="vn-dot" style="left: {progress * 100}%;"></div>
        </div>
        <span class="vn-time">{formatTime(playing || currentTime > 0 ? currentTime : duration)}</span>
    </div>
</div>

<style>
.vn-player {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px 8px 10px;
    border-radius: 18px;
    background: oklch(0.22 0.01 80 / 0.8);
    border: 1px solid oklch(0.30 0.01 80 / 0.6);
    max-width: 320px;
    min-width: 240px;
}
.vn-compact {
    padding: 6px 10px 6px 8px;
    border-radius: 12px;
    max-width: none;
    min-width: 0;
}

.vn-play {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: oklch(0.55 0.15 250);
    color: white;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
}
.vn-play:hover { background: oklch(0.62 0.15 250); }
.vn-compact .vn-play {
    width: 28px;
    height: 28px;
}

.vn-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.vn-waveform {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1.5px;
    height: 28px;
    cursor: pointer;
}
.vn-compact .vn-waveform { height: 20px; }

.vn-bar {
    flex: 1;
    border-radius: 2px;
    min-height: 3px;
    transition: background 0.1s;
}

.vn-dot {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: oklch(0.65 0.15 250);
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 4px oklch(0.5 0.15 250 / 0.5);
}
.vn-compact .vn-dot {
    width: 8px;
    height: 8px;
}

.vn-time {
    font-size: 11px;
    color: oklch(0.52 0.01 80);
    font-variant-numeric: tabular-nums;
}
.vn-compact .vn-time { font-size: 10px; }
</style>
