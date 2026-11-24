// The system's preferred languages, most preferred first, for the pages' "Match system" (#464): the page asks for them
// (systemLanguages, lib/i18n/bun-link.ts) as each window starts. A web view tells its page less: WKWebView's
// navigator.languages has the first language only, and mapped (es-CO is es-419 there), so a second preference, the one
// the app may have, is never seen. Each system's own list instead, as BCP 47 tags:
//   - macOS: NSLocale.preferredLanguages (appkit.ts);
//   - Windows: the user's language list (Settings › Time & language), which the registry keeps;
//   - Linux: LANGUAGE, the list gettext reads, then LC_ALL, LC_MESSAGES and LANG.
// None, where the list can't be read: the page keeps its web view's.

/** A POSIX locale name (es_CO.UTF-8@euro) as a BCP 47 tag (es-CO); null for C, POSIX or nothing. */
export function posixTag(name: string): string | null {
	const tag = name.split(/[.@]/)[0]?.replace(/_/g, "-").trim() ?? "";
	if (!tag || tag === "C" || tag === "POSIX") return null;
	return tag;
}

/** Linux's languages, from the environment as gettext reads it: LANGUAGE's list first, unless the locale is C. */
export function linuxLanguages(env: Record<string, string | undefined>): string[] {
	const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
	const list = posixTag(locale) === null ? [] : (env.LANGUAGE ?? "").split(":");
	return unique([...list, locale].map(posixTag));
}

/** Windows' languages, from what `reg query` prints of the user's Languages value (a REG_MULTI_SZ, its strings joined
 * by \0). */
export function windowsLanguages(regOutput: string): string[] {
	const line = regOutput.split(/\r?\n/).find((text) => /\bLanguages\s+REG_MULTI_SZ\b/.test(text));
	const value = line?.split(/REG_MULTI_SZ/)[1]?.trim() ?? "";
	return unique(value.split("\\0").map((tag) => tag.trim() || null));
}

function unique(tags: (string | null)[]): string[] {
	return [...new Set(tags.filter((tag): tag is string => tag !== null))];
}

const REG_KEY = "HKCU\\Control Panel\\International\\User Profile";
/** How long Windows' answer is waited for. */
const REG_WAIT_MS = 3000;

async function readWindowsLanguages(): Promise<string[]> {
	const reg = Bun.spawn(["reg", "query", REG_KEY, "/v", "Languages"], { stdout: "pipe", stderr: "ignore" });
	const timer = setTimeout(() => reg.kill(), REG_WAIT_MS);
	try {
		const output = await new Response(reg.stdout).text();
		return (await reg.exited) === 0 ? windowsLanguages(output) : [];
	} finally {
		clearTimeout(timer);
	}
}

/** The system's preferred languages, most preferred first; none where they can't be read. */
export async function systemLanguages(platform: string = process.platform): Promise<string[]> {
	try {
		if (platform === "darwin") return (await import("./appkit")).preferredLanguages();
		if (platform === "win32") return await readWindowsLanguages();
		if (platform === "linux") return linuxLanguages(process.env);
	} catch (err) {
		console.error("[language] the system's languages couldn't be read:", err);
	}
	return [];
}
