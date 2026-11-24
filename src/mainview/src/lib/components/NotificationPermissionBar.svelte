<script lang="ts">
	import { Bell, X as XIcon } from "@lucide/svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import Button from "$lib/components/ui/Button.svelte";
	import { GLASS, iconButtonClass } from "$lib/components/ui/recipes";

	// The web asks the browser for its permission to notify (DISENO-NOTIFICACIONES.md, objective 11) from a button, as a
	// browser takes the request only from a click. It shows while the browser hasn't been asked, and its × hides it until
	// the page loads again. The desktop app asks nothing: Windows lets it notify.
	let asking = $state(
		!isElectrobunWindow() && typeof Notification !== "undefined" && Notification.permission === "default",
	);

	// What the browser answers is read as each message notifies (lib/system-notifications.ts).
	function turnOn() {
		asking = false;
		void Notification.requestPermission();
	}
</script>

{#if asking}
	<!-- A glass bar at the bottom centre, as a notice is at the top: above where a toast shows, so neither hides the
	     other. -->
	<div
		class="{GLASS} animate-toast-in text-duvet-ink fixed bottom-16 left-1/2 z-9990 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-[18px] py-2 pr-2 pl-3.5 text-[13px]"
		role="region"
		aria-label={t("shell_notify_permission_label")}
	>
		<Bell size={16} class="text-duvet-ink2 shrink-0" />
		<span class="min-w-0 flex-1">{t("shell_notify_permission_ask")}</span>
		<Button size="sm" onclick={turnOn}>{t("shell_notify_permission_turn_on")}</Button>
		<button
			type="button"
			class={iconButtonClass("sm")}
			aria-label={t("shell_dismiss")}
			onclick={() => (asking = false)}
		>
			<XIcon size={14} />
		</button>
	</div>
{/if}
