<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import PasswordEye from "$lib/components/auth/PasswordEye.svelte";
	import Rich from "$lib/components/Rich.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { Check } from "@lucide/svelte";
	import { Checkbox } from "bits-ui";
	import { onMount } from "svelte";
	import { signIn, logIn } from "$lib/api/auth";
	import {
		canSignUp,
		mascotLook,
		mascotMood,
		PASSWORD_MIN,
		redirectQuery as redirectOf,
		signUpSteps,
		usernameValid,
		type FocusedField,
	} from "$lib/auth-form";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { localUrl } from "$lib/urls";
	import { t } from "$lib/i18n";

	let showPassword = $state(false);
	let username = $state("");
	let alias = $state("");
	let email = $state("");
	let password = $state("");
	let confirmPassword = $state("");
	let acceptTerms = $state(false);
	let doingRequest = $state(false);
	let showTermsModal = $state(false);
	let errorMessage = $state("");
	// The page to go on to (an invite's), which signing in instead goes on to as well.
	let redirectQuery = $state("");

	onMount(() => {
		redirectQuery = redirectOf(window.location.search);
	});

	// The same rules the mobile app checks before it asks the server (lib/auth-form.ts).
	const usernameWrong = $derived(username.length > 0 && !usernameValid(username));
	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(canSignUp({ username, email, password, confirmPassword, acceptTerms }));
	// The form grows a step once the one before it reads right; the display name may stay empty.
	const shown = $derived(signUpSteps({ username, email, password }));

	async function handleSubmit() {
		doingRequest = true;
		errorMessage = "";
		try {
			await signIn({
				username,
				alias: alias || null,
				email,
				password,
			});
			const result = await logIn({ email, password });
			userSession.token = result.token;
			// Only to a path of the app (localUrl): another site, or javascript:, would leave it or run in it.
			const redirect = new URLSearchParams(window.location.search).get("redirect");
			window.location.href = localUrl(redirect, window.location.href) ?? route("/app.html");
		} catch (err) {
			// signIn and logIn always throw an Error, in words of lib/api/auth.ts.
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

	const onText = {
		onfocus: (e: FocusEvent & { currentTarget: HTMLInputElement }) => {
			focusedField = "text";
			typed = e.currentTarget.value.length;
		},
		oninput: (e: Event & { currentTarget: HTMLInputElement }) => (typed = e.currentTarget.value.length),
		onblur: () => (focusedField = null),
	};
	const onSecret = { onfocus: () => (focusedField = "secret"), onblur: () => (focusedField = null) };

	// A step of the form. Each one fades in, rising a little, once the one before it reads right (hiddenPart); until
	// then it can't be reached (inert).
	const step = "transition-[opacity,translate] duration-260 ease-[ease] motion-reduce:transition-none";
	const hiddenPart = "pointer-events-none translate-y-2 opacity-0";
</script>

<!-- The terms' words in "I agree to the Terms of use", which open them. -->
{#snippet termsLink(text: string)}
	<button type="button" class="auth-link" onclick={() => (showTermsModal = true)}>{text}</button>
{/snippet}

<AuthScene {mood} {look} wide title={t("auth_sign_up_title")} lead={t("auth_sign_up_lead")}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		novalidate
		aria-label={t("auth_sign_up_title")}
		aria-busy={doingRequest}
	>
		<fieldset disabled={doingRequest} class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
			<div>
				<div class="grid grid-cols-2 gap-3">
					<AuthField
						id="alias"
						label={t("auth_display_name_label")}
						name="alias"
						type="text"
						maxlength={32}
						bind:value={alias}
						placeholder={t("auth_display_name_placeholder")}
						{...onText}
					/>
					<AuthField
						id="username"
						label={t("auth_username_label")}
						name="username"
						type="text"
						aria-describedby="username-hint"
						invalid={usernameWrong}
						autocomplete="username"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						maxlength={32}
						required
						bind:value={username}
						placeholder={t("auth_username_placeholder")}
						{...onText}
					/>
				</div>
				<p
					id="username-hint"
					class="mt-1.5 text-[12.5px] leading-[1.3] {usernameWrong ? 'text-duvet-danger' : 'text-duvet-ink2'}"
				>
					{t("auth_username_hint")}
				</p>
			</div>

			<AuthField
				class="{step} {shown < 2 ? hiddenPart : ''}"
				inert={shown < 2}
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
				placeholder={t("auth_email_placeholder")}
				{...onText}
			/>

			<div class="grid grid-cols-2 items-start gap-3">
				<AuthField
					class="{step} {shown < 3 ? hiddenPart : ''}"
					inert={shown < 3}
					id="password"
					label={t("auth_sign_up_password_label", { count: PASSWORD_MIN })}
					name="password"
					type={showPassword ? "text" : "password"}
					autocomplete="new-password"
					minlength={8}
					maxlength={128}
					required
					bind:value={password}
					placeholder={t("auth_sign_up_password_placeholder", { count: PASSWORD_MIN })}
					{...onSecret}
				>
					{#snippet trailing()}
						<PasswordEye bind:shown={showPassword} disabled={doingRequest} />
					{/snippet}
				</AuthField>
				<AuthField
					class="{step} {shown < 4 ? hiddenPart : ''}"
					inert={shown < 4}
					id="confirmPassword"
					label={t("auth_confirm_password_label")}
					name="confirmPassword"
					type={showPassword ? "text" : "password"}
					autocomplete="new-password"
					minlength={8}
					maxlength={128}
					required
					bind:value={confirmPassword}
					placeholder={t("auth_sign_up_confirm_placeholder")}
					error={confirmPassword && !passwordsMatch ? t("auth_passwords_differ") : undefined}
					{...onSecret}
				/>
			</div>

			{#if errorMessage}
				<AuthNote>{errorMessage}</AuthNote>
			{/if}

			<div class="flex flex-col gap-4 {step} {shown < 4 ? hiddenPart : ''}" inert={shown < 4}>
				<label class="text-duvet-ink2 inline-flex items-center gap-2.5 text-[14px]">
					<!-- Its ring is its focus mark, so it takes no global outline (focus-override): the accent's line around it, and
					     around the accent's own fill when checked, a gap first. -->
					<Checkbox.Root
						bind:checked={acceptTerms}
						class="focus-override bg-duvet-card text-duvet-on-accent data-[state=checked]:bg-duvet-accent flex size-5 shrink-0 items-center justify-center rounded-[6px] shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-line)] focus-visible:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-accent),0_0_0_4px_var(--duvet-accent-tint)] data-[state=checked]:shadow-none data-[state=checked]:focus-visible:shadow-[0_0_0_2px_var(--duvet-card),0_0_0_4px_var(--duvet-accent)]"
					>
						{#if acceptTerms}
							<Check size={14} strokeWidth={3} aria-hidden="true" />
						{/if}
					</Checkbox.Root>
					<span><Rich key="auth_terms_agree" tags={{ terms: termsLink }} /></span>
				</label>
				<AuthSubmit busy={doingRequest} disabled={!canSubmit}>
					{doingRequest ? t("auth_sign_up_busy") : t("auth_sign_up_submit")}
				</AuthSubmit>
			</div>
		</fieldset>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-[14px]">
		{t("auth_sign_up_have_account")}
		<a href="/sign-in{redirectQuery}" class="auth-link ml-1">{t("auth_sign_in")}</a>
	</footer>
</AuthScene>

<Sheet bind:open={showTermsModal} title={t("auth_terms_title")}>
	<p class="text-duvet-ink2 font-content pb-1 text-[14px] leading-[1.5]">
		{t("auth_terms_text")}
	</p>
</Sheet>
