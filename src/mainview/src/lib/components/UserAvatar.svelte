<script lang="ts">
import { Avatar, AvatarImage, AvatarFallback } from "facehash-sv";

let {
	src = undefined,
	name,
	size = 40,
	mouthOpen = 0,
	class: className = "",
}: {
	src?: string | null | undefined;
	name: string;
	size?: string | number;
	mouthOpen?: number;
	class?: string;
} = $props();
</script>

<Avatar
    style="width: {typeof size === 'number'
        ? size + 'px'
        : size}; height: {typeof size === 'number'
        ? size + 'px'
        : size}; border-radius: 50%; overflow: hidden;"
    class={className}
>
    <AvatarImage {src} alt={name} />
    <AvatarFallback
        {name}
        facehashProps={{ size: typeof size === "number" ? size : 40, mouthOpen }}
    />
</Avatar>
