import { prefersReducedMotion } from "svelte/motion";

/** A Svelte transition's duration (transition:, in:, out:), which runs in script where app.css's reduced-motion rule
 * doesn't reach: none for those who asked their system for less motion, so what it moves is simply there, or gone. */
export function motionMs(ms: number, reduced: boolean = prefersReducedMotion.current): number {
	return reduced ? 0 : ms;
}
