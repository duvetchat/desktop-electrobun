// import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from "@sveltejs/adapter-static";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Electrobun SDK, which `electrobun prepare` writes to the repository's .hutch/devkit (the root's `bun run devkit`;
// start, hmr and build:canary run it first): since Electrobun 2 the npm package only downloads the tools, and its
// modules throw. lib/electrobun-rpc.ts imports electrobun/view from the devkit, for Vite and for svelte-check (kit.alias
// feeds both), and vite.config.ts lets the dev server serve it. A checkout without a devkit, like the server's that
// builds duvet.chat, aliases nothing: that import only runs in the app's window (isElectrobunWindow), so the web build
// bundles the npm package's throwing module in its place and never loads it.
export const ELECTROBUN_DEVKIT = fileURLToPath(new URL("../../.hutch/devkit", import.meta.url));

/** @returns {Record<string, string>} */
function electrobunAliases() {
  const manifest = resolve(ELECTROBUN_DEVKIT, "package.json");
  if (!existsSync(manifest)) return {};
  const target = JSON.parse(readFileSync(manifest, "utf8")).exports?.["./view"];
  if (typeof target !== "string") throw new Error(`${manifest} exports no electrobun/view`);
  return { "electrobun/view": resolve(ELECTROBUN_DEVKIT, target) };
}

// Content Security Policy. Every route is prerendered (adapter-static), so SvelteKit emits this as a
// <meta http-equiv="content-security-policy"> tag and augments script-src with the hash of its own
// bootstrap script (mode "hash"). It runs in the packaged app (views://mainview), the web build
// (duvet.chat) and the Vite dev server alike. Goal: block what the app never needs — remote and inline
// scripts, plugins/objects, <base> hijacking and cross-origin form posts — while leaving every resource
// the app does load working.
//
// Notes on the hashes and keywords below:
//  - "wasm-unsafe-eval": Shiki's Oniguruma highlighter and RNNoise (compiled on the main thread for the
//    noise-suppression worklet) both compile WebAssembly; without it WebAssembly.compile and instantiate throw,
//    code blocks break and the microphone goes out without noise suppression.
//  - The two script-src hashes are the inline bootstrap in app.html (the light theme's class, set before the
//    first paint, and the pre-hydration redirect). The HTML parser normalises CRLF to LF before hashing,
//    so the LF hash is the one browsers check; the CRLF hash is kept as a belt-and-suspenders fallback.
//    src/mainview/src/lib/csp.test.ts recomputes them from app.html and fails if either drifts.
//  - script-src-attr allows no inline event handler: the app renders none. A custom emoji's image that fails is
//    tried again by a listener on the document (lib/emoji-retry.ts), and csp.test.ts checks that markdown.ts
//    writes no handler into its HTML.
//  - style-src keeps 'unsafe-inline': Svelte transitions and component style="" attributes are inline,
//    and hashing them is not feasible; this is the standard CSP trade-off and does not weaken script
//    protection. https: covers the Google Fonts stylesheet (@import in app.css).
//  - img-/media-src are deliberately broad (http(s)/data/blob): link embeds, avatars and GIFs come from
//    arbitrary origins and are inert (the GIF picker's from KLIPY, static*.klipy.com).
//  - frame-src allows http(s): EmbedCard frames player pages (YouTube, TikTok, others) each under an
//    opaque-origin sandbox.
//  - connect-src: https: covers every API target in lib/common/common.ts over TLS (api.duvet.chat, the n128
//    and andremor hosts) plus the presigned storage redirects (arbitrary R2 subdomains), the GIF picker's
//    KLIPY requests (api.klipy.com, lib/gifs.ts) and the theme fetches; the wss:// hosts are the gateways
//    (ws.duvet.chat and the n128/andremor ones); localhost/127.0.0.1 (any port) cover the local dev API,
//    gateway and S3 mock over http/ws. In development mode only, the origins of the VITE_API_URL/
//    VITE_WS_URL overrides (a LAN address, another wss host) are added too: vite.config.ts hands them over
//    in DUVET_DEV_CONNECT_SRC, which it sets (empty in every other mode) before SvelteKit loads this file.
//    See devConnectSources.
//  - frame-ancestors is ignored inside a prerendered <meta> tag, but it is honoured by the dev server's
//    response header and documents that the app is never meant to be framed.
/** @typedef {NonNullable<NonNullable<NonNullable<import('@sveltejs/kit').KitConfig['csp']>['directives']>['connect-src']>[number]} CspSource */

// The env variable through which vite.config.ts hands over the dev-only override URLs.
export const DEV_CONNECT_ENV = "DUVET_DEV_CONNECT_SRC";

/**
 * Whether the origin is one connect-src takes: an http(s) or ws(s) URL's, as connect-src writes them.
 * @param {string} origin
 * @returns {origin is CspSource}
 */
function isConnectSource(origin) {
  return /^(https?|wss?):\/\//.test(origin);
}

/**
 * The connect-src origins of the URL overrides (space-separated URLs, as vite.config.ts puts them in
 * DEV_CONNECT_ENV): each URL's origin, so a path never widens or narrows it. What isn't an http(s) or
 * ws(s) URL adds nothing.
 * @param {string | undefined} urls
 * @returns {CspSource[]}
 */
export function devConnectSources(urls) {
  /** @type {CspSource[]} */
  const sources = [];
  for (const raw of (urls ?? "").split(/\s+/)) {
    if (!raw) continue;
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    // By the protocol: a blob: URL's origin is its inner URL's, which isn't the URL the override names.
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) continue;
    const origin = url.origin;
    if (isConnectSource(origin) && !sources.includes(origin)) sources.push(origin);
  }
  return sources;
}

// The inline-script hashes below are inlined (not hoisted) so TypeScript infers them as CryptoSource literals;
// src/mainview/src/lib/csp.test.ts recomputes each from its source file and fails if it drifts.
/** @type {NonNullable<import('@sveltejs/kit').KitConfig['csp']>} */
const csp = {
  mode: "hash",
  directives: {
    "default-src": ["self"],
    "script-src": [
      "self",
      "wasm-unsafe-eval", // Shiki (Oniguruma) + rnnoise compile WebAssembly
      "sha256-VDPut/6DO1Syk6GXvsZb64s9K1M8hKX0Ic8oEDCgxJM=", // app.html bootstrap, LF-normalised (what browsers hash)
      "sha256-xgMYxk1WHHFUq6eww5fymMrIYUU+aAuZTrmlBm33YhY=", // app.html bootstrap, CRLF fallback
    ],
    // No inline event handler: the app renders none.
    "script-src-attr": ["none"],
    "style-src": ["self", "unsafe-inline", "https:"],
    "style-src-attr": ["unsafe-inline"],
    "img-src": ["self", "data:", "blob:", "https:", "http:"],
    "media-src": ["self", "data:", "blob:", "https:", "http:"],
    "font-src": ["self", "data:", "https:"],
    "connect-src": [
      "self",
      "https:",
      "wss://*.duvet.chat",
      "wss://*.n128.xyz",
      "wss://*.andremor.eu.org",
      "http://localhost:*",
      "ws://localhost:*",
      "http://127.0.0.1:*",
      "ws://127.0.0.1:*",
      ...devConnectSources(process.env[DEV_CONNECT_ENV]),
    ],
    "frame-src": ["self", "https:", "http:"],
    "worker-src": ["self", "blob:"],
    "object-src": ["none"],
    "base-uri": ["self"],
    "form-action": ["self"],
    "frame-ancestors": ["none"],
  },
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    runes: true,
  },
  // preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      precompress: true,
    }),
    alias: electrobunAliases(),
    csp,
  },
};

export default config;
