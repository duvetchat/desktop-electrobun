<script lang="ts">
	import type { MemberOnSidebar, Role } from "$lib/types";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { Camera as CameraIcon, Trash2 as TrashIcon } from "@lucide/svelte";
	import { userActivities } from "$lib/stores.svelte";
	import { resolveActivityIcon } from "$lib/activity-icons";
	import ElapsedTime from "$lib/components/ElapsedTime.svelte";

	let {
		member,
		editable = false,
		onAvatarClick = undefined,
		onAvatarRemove = undefined,
		onBannerClick = undefined,
		onBannerRemove = undefined,
	}: {
		member: MemberOnSidebar;
		editable?: boolean;
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
		if (!highest) return "background-color: var(--color-stone-600)";
		const from = intToHex(highest.color_from);
		if (highest.color_to === null || highest.color_to === undefined) return `background-color: ${from}`;
		const to = intToHex(highest.color_to);
		const via = highest.color_via !== null && highest.color_via !== undefined ? `, ${intToHex(highest.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	function roleBadgeStyle(role: Role): string {
		if (role.color_from === null || role.color_from === undefined) return "background-color: var(--color-zinc-600)";
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

<div class="w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
	<!-- Banner -->
	{#if editable}
		<div
			class="group relative h-24 w-full"
			style={member.banner_url
				? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
				: getBannerStyle(member)}
		>
			<div class="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 transition-colors group-hover:bg-black/40">
				{#if onBannerClick}
					<button
						type="button"
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
						title="Change banner"
						onclick={onBannerClick}
					>
						<CameraIcon class="size-4" />
					</button>
				{/if}
				{#if onBannerRemove && member.banner_url}
					<button
						type="button"
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-red-400 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
						title="Remove banner"
						onclick={onBannerRemove}
					>
						<TrashIcon class="size-4" />
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<div
			class="h-24 w-full"
			style={member.banner_url
				? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
				: getBannerStyle(member)}
		></div>
	{/if}

	<div class="relative px-4 pb-4">
		<!-- Avatar -->
		<div class="absolute -top-12 left-4 rounded-full border-[6px] border-zinc-800 bg-zinc-950">
			{#if editable}
				<div class="avatar-edit-group relative overflow-hidden rounded-full">
					<UserAvatar src={member.avatar_url} name={member.username} size={80} />
					<div class="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/0 transition-colors avatar-edit-overlay">
						{#if onAvatarClick}
							<button
								type="button"
								class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 avatar-edit-btn"
								title="Change avatar"
								onclick={onAvatarClick}
							>
								<CameraIcon class="size-3.5" />
							</button>
						{/if}
						{#if onAvatarRemove && member.avatar_url}
							<button
								type="button"
								class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-red-400 opacity-0 transition-opacity hover:bg-black/80 avatar-edit-btn"
								title="Remove avatar"
								onclick={onAvatarRemove}
							>
								<TrashIcon class="size-3.5" />
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<UserAvatar src={member.avatar_url} name={member.username} size={80} />
			{/if}
			<div
				class="absolute right-0 bottom-0 h-6 w-6 rounded-full border-4 border-zinc-800
				{member.status === 'online'
					? 'bg-stone-400'
					: member.status === 'idle'
						? 'bg-amber-500'
						: member.status === 'dnd'
							? 'bg-red-500'
							: 'bg-zinc-500'}"
			></div>
		</div>

		<div class="h-14"></div>

		<div class="mt-4 rounded-lg bg-zinc-950 p-3">
			<h2 class="break-all text-lg leading-tight font-bold text-zinc-100">
				{member.username}
			</h2>
			<p class="break-all text-sm font-medium text-zinc-400">
				@{member.raw_username}
			</p>

			{#if $userActivities[member.id]?.length}
				<div class="my-3 h-px w-full bg-zinc-800"></div>
				<h3 class="mb-1.5 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
					{$userActivities[member.id].length === 1 ? "Activity" : "Activities"}
				</h3>
				<div class="flex flex-col gap-2">
					{#each $userActivities[member.id] as activity}
						<div class="flex items-center gap-2">
							<div class="relative shrink-0">
								<img src={resolveActivityIcon(activity.assets?.large_image)} alt="" title={activity.assets?.large_text ?? ""} class="h-10 w-10 rounded" />
								{#if activity.assets?.small_image}
									<img src={resolveActivityIcon(activity.assets.small_image)} alt="" title={activity.assets?.small_text ?? ""} class="absolute -right-1 -bottom-1 h-5 w-5 rounded border border-zinc-900 bg-zinc-800 p-0.5" />
								{/if}
							</div>
							<div class="flex min-w-0 flex-col">
								<span class="truncate text-sm font-medium text-zinc-200">{activity.name}</span>
								{#if activity.details}
									<span class="truncate text-xs text-zinc-400">{activity.details}</span>
								{/if}
								{#if activity.state}
									<span class="truncate text-xs text-zinc-500">{activity.state}</span>
								{/if}
								{#if activity.timestamps?.start}
									<ElapsedTime start={activity.timestamps.start} />
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if visibleRoles.length > 0}
				<div class="my-3 h-px w-full bg-zinc-800"></div>
				<h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">Roles</h3>
				<div class="flex flex-wrap gap-1">
					{#each visibleRoles as role}
						<div
							class="flex w-min items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 shadow-sm"
						>
							<div class="h-3 w-3 rounded-full" style={roleBadgeStyle(role)}></div>
							<span class="text-xs font-medium text-zinc-300">{role.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.avatar-edit-group:hover .avatar-edit-overlay {
		background-color: rgba(0, 0, 0, 0.4);
	}
	.avatar-edit-group:hover .avatar-edit-btn {
		opacity: 1;
	}
</style>
