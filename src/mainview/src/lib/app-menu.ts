// What the macOS menu bar (src/bun/app-menu.ts) asks of the main window's page: Bun sends it as a command through the
// relay it already has to that page (src/bun/window-relay.ts, lib/window-commands.ts).

// Nothing is imported here: the Bun process reads this too (src/bun/index.ts), and its type check (src/bun's tsconfig)
// would follow an import into the whole UI.

/** Settings…, which opens Settings as ⌘, does: the profile row answers it, as it holds them (ProfileRow.svelte). */
export const SETTINGS_MENU_COMMAND = { channel: "app-menu", name: "settings" } as const;
