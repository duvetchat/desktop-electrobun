<script lang="ts">
	import { GLASS, OVERLINE } from "$lib/components/ui/recipes";
	import type { MemberOnSidebar, Role } from "$lib/types";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ProfileBio from "$lib/components/ProfileBio.svelte";
	import { Camera as CameraIcon, Trash2 as TrashIcon } from "@lucide/svelte";
	import { userActivities } from "$lib/stores.svelte";
	import { BADGES } from "$lib/badges";
	import ActivityList from "$lib/components/ActivityList.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 2000;
	let bannerError = $state(false);
	let bannerRetryCount = $state(0);

	let lastBannerSrc: string | null | undefined;
	$effect(() => {
		if (member?.banner_url !== lastBannerSrc) {
			lastBannerSrc = member?.banner_url;
			bannerError = false;
			bannerRetryCount = 0;
		}
	});

	function handleBannerError() {
		if (bannerRetryCount < MAX_RETRIES) {
			bannerRetryCount++;
			setTimeout(() => {
				bannerError = false;
			}, RETRY_DELAY * bannerRetryCount);
		} else {
			bannerError = true;
		}
	}

	// Settings' preview of the user's profile, with what changes their avatar and banner on them.
	let {
		member,
		onAvatarClick = undefined,
		onAvatarRemove = undefined,
		onBannerClick = undefined,
		onBannerRemove = undefined,
	}: {
		member: MemberOnSidebar;
		onAvatarClick?: () => void;
		onAvatarRemove?: () => void;
		onBannerClick?: () => void;
		onBannerRemove?: () => void;
	} = $props();

	function intToHex(n: number | null | undefined): string {
		if (n === null || n === undefined) return "";
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	function getBannerStyle(m: MemberOnSidebar): string {
		const highest = [...m.roles]
			.filter((r) => r.color_from !== null && r.color_from !== undefined)
			.sort((a, b) => b.position - a.position)
			.at(0);
		if (!highest) return "background-color: color-mix(in oklab, var(--duvet-ink2) 50%, var(--duvet-card))";
		const from = intToHex(highest.color_from);
		if (highest.color_to === null || highest.color_to === undefined) return `background-color: ${from}`;
		const to = intToHex(highest.color_to);
		const via = highest.color_via !== null && highest.color_via !== undefined ? `, ${intToHex(highest.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	function roleBadgeStyle(role: Role): string {
		if (role.color_from === null || role.color_from === undefined) return "background-color: var(--duvet-ink2)";
		const from = intToHex(role.color_from);
		if (role.color_to === null || role.color_to === undefined) return `background-color: ${from}`;
		const to = intToHex(role.color_to);
		const via = role.color_via !== null && role.color_via !== undefined ? `, ${intToHex(role.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	const visibleRoles = $derived(
		member.roles.filter((r) => (r.color_from !== null && r.color_from !== undefined) || r.name !== "@everyone"),
	);
</script>

<div class="{GLASS} rounded-card text-duvet-ink w-80">
	<!-- Banner: 5:2, as it's cropped (600×240), and as a space's is. Without one, a block of the same size. It grows a
	     little past the card on hover; nothing clips it, so its corners are its own, and what's below clips itself. The
	     avatar comes later and covers its lower left, so it fades out while the banner (peer/banner) is hovered. -->
	<div
		class="group peer/banner relative aspect-[5/2] w-full overflow-hidden rounded-t-[15px] transition-transform duration-150 motion-safe:hover:scale-105 motion-reduce:transition-none"
		style={member.banner_url && !bannerError ? undefined : getBannerStyle(member)}
	>
		{#if member.banner_url && !bannerError}
			<img
				src="{member.banner_url}{bannerRetryCount ? `?r=${bannerRetryCount}` : ''}"
				alt=""
				class="h-full w-full object-cover"
				onerror={handleBannerError}
				draggable="false"
			/>
		{/if}
		<div
			class="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 transition-colors group-hover:bg-black/40 motion-reduce:transition-none"
		>
			{#if onBannerClick}
				<button
					type="button"
					class="text-fixed-white flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 motion-reduce:transition-none"
					title="Change banner"
					onclick={onBannerClick}
				>
					<CameraIcon class="size-4" />
				</button>
			{/if}
			{#if onBannerRemove && member.banner_url}
				<button
					type="button"
					class="text-duvet-danger flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 motion-reduce:transition-none"
					title="Remove banner"
					onclick={onBannerRemove}
				>
					<TrashIcon class="size-4" />
				</button>
			{/if}
		</div>
	</div>

	<div class="relative px-4 pb-4">
		<!-- Avatar: with its status dot, it fades out while the banner before this section is hovered, over the banner's
		     150 ms, and with less motion asked too, as a fade moves nothing. It still takes the pointer: on it, the banner
		     isn't hovered, so it shows, and its buttons are its own. -->
		<div
			class="border-duvet-pop-ring bg-duvet-pop-ring absolute -top-12 left-4 rounded-full border-4 transition-opacity duration-150 in-peer-hover/banner:opacity-0 motion-reduce:transition-none"
		>
			<div class="group/avatar relative overflow-hidden rounded-full">
				<UserAvatar src={member.avatar_url} name={member.username} size={80} />
				<div
					class="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/0 transition-colors group-hover/avatar:bg-black/40 motion-reduce:transition-none"
				>
					{#if onAvatarClick}
						<button
							type="button"
							class="text-fixed-white flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover/avatar:opacity-100 hover:bg-black/80 motion-reduce:transition-none"
							title="Change avatar"
							onclick={onAvatarClick}
						>
							<CameraIcon class="size-3.5" />
						</button>
					{/if}
					{#if onAvatarRemove && member.avatar_url}
						<button
							type="button"
							class="text-duvet-danger flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover/avatar:opacity-100 hover:bg-black/80 motion-reduce:transition-none"
							title="Remove avatar"
							onclick={onAvatarRemove}
						>
							<TrashIcon class="size-3.5" />
						</button>
					{/if}
				</div>
			</div>
			<!-- Coloured as every status dot (statusDotClass, lib/status.ts): online in the theme's colour -->
			<StatusDot
				status={member.status}
				mobileOnly={member.mobile_only}
				class="text-duvet-bg absolute right-0 bottom-0 w-6 border-4"
			/>
		</div>

		<div class="h-14"></div>

		<div class="bg-duvet-sunk mt-4 overflow-hidden rounded-[14px] p-3">
			<h2
				class="text-duvet-ink flex items-center gap-1.5 text-[16px] leading-[1.15] font-medium tracking-[-0.012em] break-all"
			>
				{member.username}
				{#if member.is_bot}
					<span
						class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1.5 py-0.5 font-sans text-[9.5px] leading-none font-bold tracking-[0.04em]"
						>BOT</span
					>
				{/if}
			</h2>
			<p class="text-duvet-ink2 mt-0.5 text-[12.5px] break-all">
				@{member.raw_username}
			</p>

			{#if BADGES.some((b) => member.badges & b.flag)}
				<div class="mt-2 flex gap-1">
					{#each BADGES.filter((b) => member.badges & b.flag) as badge}
						<img src={badge.icon} alt={badge.name} title={badge.name} class="size-6 rounded-md" />
					{/each}
				</div>
			{/if}

			{#if member.bio}
				<div class="bg-duvet-line my-3 h-px w-full"></div>
				<h3 class="{OVERLINE} mb-1.5 text-left">About</h3>
				<ProfileBio bio={member.bio} />
			{/if}

			<ActivityList activities={$userActivities[member.id]} />

			{#if visibleRoles.length > 0}
				<div class="bg-duvet-line my-3 h-px w-full"></div>
				<h3 class="{OVERLINE} mb-1.5 text-left">Roles</h3>
				<div class="flex flex-wrap gap-1">
					{#each visibleRoles as role}
						<div class="bg-duvet-secondary-fill rounded-chip flex h-[22px] w-max items-center gap-1.5 px-2">
							<div class="size-[9px] rounded-full" style={roleBadgeStyle(role)}></div>
							<span class="text-duvet-ink text-[11.5px] font-medium">{role.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
