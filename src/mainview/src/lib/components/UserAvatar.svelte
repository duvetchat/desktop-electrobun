<script lang="ts">
import { Avatar, AvatarImage, AvatarFallback } from "facehash-sv";

export let src: string | null | undefined = undefined;
export let name: string;
export let size: string | number = 40;
/** Extra CSS classes applied to the Avatar wrapper */
let className = "";
export { className as class };
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
        facehashProps={{ size: typeof size === "number" ? size : 40 }}
    />
</Avatar>
