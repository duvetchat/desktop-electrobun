// The Licenses page's notices (#628): licenses.json, which the page's build writes beside the pages from what the build
// ships (third-party-notices.ts at src/mainview), and which the packaged app copies with them (electrobun.config.ts).
// They're fetched only when the page shows them: none of their text is in the app's code.

/** A desktop app a notice ships in, when it's only some of them. */
export type Platform = "windows" | "macos" | "linux";

export interface Notice {
	name: string;
	version?: string;
	/** As an SPDX expression. */
	license: string;
	text: string;
	platforms?: Platform[];
}

export interface Licenses {
	/** The npm packages in the page's build: the web app's, and every desktop app's page. */
	page: Notice[];
	/** The npm packages in the desktop app's Bun process. */
	bun: Notice[];
	/** Electrobun and what it ships beside the page: Bun, the WebView2 loader on Windows, CEF on Linux. */
	runtime: Notice[];
	/** Fonts, emoji and code kept in the page's own folders. */
	assets: Notice[];
	/** The end-to-end encryption core's notices, of the commit native/core/SOURCE.json pins; null when the checkout the
	 * build ran in doesn't have them. */
	core: { commit: string; text: string } | null;
}

/** Where the build puts them: at the root of the pages, the web's and the packaged app's alike. */
export const LICENSES_FILE = "/licenses.json";

let loading: Promise<Licenses> | null = null;

/** The notices, fetched once; after a failure, the next call asks again. */
export function loadLicenses(): Promise<Licenses> {
	if (loading) return loading;
	// The build's own file, beside the page: read as the build wrote it.
	const request = fetch(LICENSES_FILE).then((response): Promise<Licenses> => {
		if (!response.ok) throw new Error(`${LICENSES_FILE} answered ${response.status}`);
		return response.json();
	});
	loading = request;
	request.catch(() => {
		if (loading === request) loading = null;
	});
	return request;
}
