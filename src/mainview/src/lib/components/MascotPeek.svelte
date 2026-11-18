<script lang="ts">
	import type { MascotMood } from "$lib/auth-form";
	import AuthMascot from "$lib/components/auth/AuthMascot.svelte";

	// The mascot of the app's empty places (no friends yet, an empty call history, a chat's first line, a voice room
	// nobody is in, the keyboard's hint): the Duvet ghost, the same drawing the sign-in pages have (AuthMascot), its
	// eyes open and looking, shut, or one open. Its width comes from the class; its height follows.
	let {
		mood = "awake",
		look = 0,
		class: className = "",
	}: {
		mood?: MascotMood;
		/** -1 left … 1 right. */
		look?: number;
		class?: string;
	} = $props();
</script>

<AuthMascot {mood} {look} class="h-auto {className}" />
