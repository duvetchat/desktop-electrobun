/** What of the window's chrome is on screen. The app's shell has its own title line (the sidebar's header and the tab
 * strip, with the window's controls): while it is up, the slim title bar of the other pages (Header.svelte) stays
 * away. The app page sets it; nothing else does. */
export const appChrome: { shellUp: boolean } = $state({ shellUp: false });
