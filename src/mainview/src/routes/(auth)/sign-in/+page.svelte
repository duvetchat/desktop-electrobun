<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import PasswordEye from "$lib/components/auth/PasswordEye.svelte";
	import { onMount } from "svelte";
	import { logIn } from "$lib/api/auth";
	import {
		emailValid,
		mascotLook,
		mascotMood,
		redirectQuery as redirectOf,
		signInMissing,
		type FocusedField,
	} from "$lib/auth-form";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { localUrl } from "$lib/urls";
	import { t, type MessageKey } from "$lib/i18n";

	let showPassword = $state(false);
	let email = $state("");
	let password = $state("");
	let doingRequest = $state(false);
	// What went wrong: the app's own sentence by its key, drawn in the language of the moment, or the API's words.
	let errorKey = $state<MessageKey | null>(null);
	let errorMessage = $state("");
	// The page to go on to (an invite's), which creating an account instead goes on to as well.
	let redirectQuery = $state("");

	onMount(() => {
		redirectQuery = redirectOf(window.location.search);
	});

	async function handleSubmit(form: HTMLFormElement) {
		if (doingRequest) return;
		// What the fields hold now: a password manager may have filled them without a keystroke.
		const filled = new FormData(form);
		email = String(filled.get("email") ?? email);
		password = String(filled.get("password") ?? password);
		// An empty form isn't sent: the form says what it lacks, and the field waits for it.
		const missing = signInMissing(email, password);
		if (missing) {
			errorKey = missing;
			errorMessage = "";
			form.querySelector<HTMLInputElement>(email.trim() ? "#password" : "#email")?.focus();
			return;
		}
		sendCue++;
		doingRequest = true;
		errorKey = null;
		errorMessage = "";
		try {
			const result = await logIn({ email, password });
			userSession.token = result.token;
			// Only to a path of the app (localUrl): another site, or javascript:, would leave it or run in it.
			const redirect = new URLSearchParams(window.location.search).get("redirect");
			window.location.href = localUrl(redirect, window.location.href) ?? route("/app.html");
		} catch (err) {
			// logIn always throws an Error, in words of lib/api/auth.ts.
			errorMessage = (err as Error).message;
		} finally {
			doingRequest = false;
		}
	}

	// What the mascot does: it follows what's typed, and shuts its eyes on a password.
	let focusedField = $state<FocusedField>(null);
	let typed = $state(0);
	const mood = $derived(mascotMood(focusedField, showPassword));
	const look = $derived(mascotLook(focusedField, typed));

	// The stickers' cues: the mailbox when the email first reads as one, the heart on each try.
	let mailCue = $state(0);
	let sendCue = $state(0);
	let emailLooked = false;
	$effect(() => {
		const valid = emailValid(email);
		if (valid && !emailLooked) mailCue++;
		emailLooked = valid;
	});
</script>

<AuthScene {mood} {look} {mailCue} {sendCue} title={t("auth_sign_in_title")} lead={t("auth_sign_in_lead")}>
	<form
		class="flex flex-col gap-4"
		onsubmit={(e) => {
			e.preventDefault();
			void handleSubmit(e.currentTarget);
		}}
		novalidate
		aria-busy={doingRequest}
	>
		<AuthField
			id="email"
			label={t("auth_email_label")}
			name="email"
			type="email"
			autocomplete="email"
			inputmode="email"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			maxlength={254}
			required
			bind:value={email}
			disabled={doingRequest}
			placeholder={t("auth_email_placeholder")}
			onfocus={(e) => ((focusedField = "text"), (typed = e.currentTarget.value.length))}
			oninput={(e) => (typed = e.currentTarget.value.length)}
			onblur={() => (focusedField = null)}
		/>

		<AuthField
			id="password"
			label={t("auth_password_label")}
			name="password"
			type={showPassword ? "text" : "password"}
			autocomplete="current-password"
			maxlength={128}
			required
			bind:value={password}
			disabled={doingRequest}
			placeholder={t("auth_sign_in_password_placeholder")}
			onfocus={() => (focusedField = "secret")}
			onblur={() => (focusedField = null)}
		>
			{#snippet aside()}
				<a href="/forgot-password" class="auth-link text-[13px]">{t("auth_forgot_link")}</a>
			{/snippet}
			{#snippet trailing()}
				<PasswordEye bind:shown={showPassword} disabled={doingRequest} />
			{/snippet}
		</AuthField>

		{#if errorKey || errorMessage}
			<AuthNote>{errorKey ? t(errorKey) : errorMessage}</AuthNote>
		{/if}

		<AuthSubmit busy={doingRequest} class="mt-2">
			{doingRequest ? t("auth_sign_in_busy") : t("auth_sign_in")}
		</AuthSubmit>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-[14px]">
		{t("auth_sign_in_new")}
		<a href="/sign-up{redirectQuery}" class="auth-link ml-1">{t("auth_sign_in_create_account")}</a>
	</footer>
</AuthScene>
