<script lang="ts">
import { emojiCategories, searchEmojis, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";

let { onSelect }: { onSelect: (emoji: string) => void } = $props();

let searchQuery = $state("");
let activeCategory = $state(0);
let searchResults = $derived(searchEmojis(searchQuery));
let isSearching = $derived(searchQuery.trim().length > 0);

function pick(emoji: string) {
	onSelect(emoji);
}

let searchEl: HTMLInputElement;
</script>

<div
	class="emoji-picker-shell"
	role="dialog"
	aria-label="Emoji picker"
>
	<!-- Search bar -->
	<div class="emoji-search-bar">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="emoji-search-icon" aria-hidden="true">
			<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
		</svg>
		<input
			bind:this={searchEl}
			bind:value={searchQuery}
			type="text"
			placeholder="Search emoji..."
			class="emoji-search-input"
			aria-label="Search emoji"
			autocomplete="off"
		/>
		{#if searchQuery}
			<button class="emoji-clear-btn" onclick={() => (searchQuery = "")} aria-label="Clear search">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		{/if}
	</div>

	{#if !isSearching}
		<!-- Category tabs -->
		<div class="emoji-tabs" role="tablist" aria-label="Emoji categories">
			{#each emojiCategories as cat, i}
				<button
					role="tab"
					aria-selected={activeCategory === i}
					aria-label={cat.label}
					class="emoji-tab"
					class:active={activeCategory === i}
					onclick={() => (activeCategory = i)}
					title={cat.label}
				>
					<img
						src={toTwemojiUrl(cat.icon)}
						alt={cat.label}
						class="emoji-tab-icon"
						loading="lazy"
					/>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji grid -->
	<div class="emoji-scroll" role="tabpanel">
		{#if isSearching}
			{#if searchResults.length === 0}
				<div class="emoji-no-results">No results for "{searchQuery}"</div>
			{:else}
				<div class="emoji-section-label">Search results</div>
				<div class="emoji-grid">
					{#each searchResults as entry (entry.emoji)}
						<button
							class="emoji-btn"
							onclick={() => pick(entry.emoji)}
							title={entry.name}
							aria-label={entry.name}
						>
							<img
								src={toTwemojiUrl(entry.emoji)}
								alt={entry.emoji}
								class="emoji-btn-img"
								loading="lazy"
							/>
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			{@const cat = emojiCategories[activeCategory]}
			<div class="emoji-section-label">{cat.label}</div>
			<div class="emoji-grid">
				{#each cat.emojis as entry (entry.emoji)}
					<button
						class="emoji-btn"
						onclick={() => pick(entry.emoji)}
						title={entry.name}
						aria-label={entry.name}
					>
						<img
							src={toTwemojiUrl(entry.emoji)}
							alt={entry.emoji}
							class="emoji-btn-img"
							loading="lazy"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.emoji-picker-shell {
		display: flex;
		flex-direction: column;
		width: 360px;
		height: 420px;
		background: oklch(0.19 0.008 80);
		border: 1px solid oklch(0.30 0.01 80);
		border-radius: 10px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
		overflow: hidden;
		font-family: inherit;
	}

	/* ── Search ─────────────────────────────────────── */
	.emoji-search-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 8px;
		border-bottom: 1px solid oklch(0.25 0.01 80);
		flex-shrink: 0;
	}
	.emoji-search-icon {
		color: oklch(0.55 0.01 80);
		flex-shrink: 0;
	}
	.emoji-search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: oklch(0.92 0.01 80);
		font-size: 13px;
		min-width: 0;
	}
	.emoji-search-input::placeholder {
		color: oklch(0.5 0.01 80);
	}
	.emoji-clear-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: oklch(0.55 0.01 80);
		display: flex;
		align-items: center;
		padding: 2px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.emoji-clear-btn:hover { color: oklch(0.8 0.01 80); }

	/* ── Category tabs ───────────────────────────────── */
	.emoji-tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 10px 4px;
		border-bottom: 1px solid oklch(0.25 0.01 80);
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.emoji-tabs::-webkit-scrollbar { display: none; }
	.emoji-tab {
		background: none;
		border: none;
		cursor: pointer;
		border-radius: 6px;
		padding: 4px 5px;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.55;
		transition: opacity 0.12s, background 0.12s;
		flex-shrink: 0;
	}
	.emoji-tab:hover { opacity: 0.85; background: oklch(0.28 0.01 80); }
	.emoji-tab.active {
		opacity: 1;
		background: oklch(0.30 0.015 80);
	}
	.emoji-tab-icon {
		width: 20px;
		height: 20px;
		display: block;
	}

	/* ── Grid ────────────────────────────────────────── */
	.emoji-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 6px 10px 10px;
		scrollbar-width: thin;
		scrollbar-color: oklch(0.35 0.01 80) transparent;
	}
	.emoji-scroll::-webkit-scrollbar { width: 5px; }
	.emoji-scroll::-webkit-scrollbar-track { background: transparent; }
	.emoji-scroll::-webkit-scrollbar-thumb {
		background: oklch(0.35 0.01 80);
		border-radius: 99px;
	}

	.emoji-section-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: oklch(0.52 0.01 80);
		padding: 6px 2px 8px;
	}

	.emoji-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
	}

	.emoji-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 5px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.1s, transform 0.08s;
	}
	.emoji-btn:hover {
		background: oklch(0.30 0.01 80);
		transform: scale(1.18);
	}
	.emoji-btn:active { transform: scale(1.0); }
	.emoji-btn-img {
		width: 24px;
		height: 24px;
		display: block;
		pointer-events: none;
		user-select: none;
	}

	.emoji-no-results {
		text-align: center;
		color: oklch(0.52 0.01 80);
		font-size: 13px;
		padding: 30px 0;
	}
</style>
