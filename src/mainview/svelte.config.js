// import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from "@sveltejs/adapter-static";

// Content Security Policy. Every route is prerendered (adapter-static), so SvelteKit emits this as a
// <meta http-equiv="content-security-policy"> tag and augments script-src with the hash of its own
// bootstrap script (mode "hash"). It runs in the packaged app (views://mainview), the web build
// (duvet.chat) and the Vite dev server alike. Goal: block what the app never needs — remote and inline
// scripts, plugins/objects, <base> hijacking and cross-origin form posts — while leaving every resource
// the app does load working.
//
// Notes on the hashes and keywords below:
//  - "wasm-unsafe-eval": Shiki's Oniguruma highlighter and the rnnoise noise-suppression worklet both
//    compile WebAssembly; without it WebAssembly.instantiate throws and code blocks / voice break.
//  - The two script-src hashes are the inline bootstrap in app.html (the pre-hydration redirect). The
//    HTML parser normalises CRLF to LF before hashing, so the LF hash is the one browsers check; the
//    CRLF hash is kept as a belt-and-suspenders fallback. src/mainview/src/lib/csp.test.ts recomputes
//    them from app.html and fails if either drifts.
//  - script-src-attr allows exactly one inline event handler: the custom-emoji <img onerror> retry in
//    markdown.ts (the only inline handler the app renders). 'unsafe-hashes' is required for attributes.
//    csp.test.ts recomputes this hash from markdown.ts.
//  - style-src keeps 'unsafe-inline': Svelte transitions and component style="" attributes are inline,
//    and hashing them is not feasible; this is the standard CSP trade-off and does not weaken script
//    protection. https: covers the Google Fonts stylesheet (@import in app.css).
//  - img-/media-src are deliberately broad (http(s)/data/blob): link embeds, avatars and GIFs come from
//    arbitrary origins and are inert (the GIF picker's from KLIPY, static.klipy.com).
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
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) continue;
    const origin = /** @type {CspSource} */ (url.origin);
    if (!sources.includes(origin)) sources.push(origin);
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
      "sha256-EGXrGjrdkeO8rpxkWo74ks0sshnuN8zFcLAGZEXkfEE=", // app.html bootstrap, LF-normalised (what browsers hash)
      "sha256-2qdrStSh/v7pnjaGmymkqbK23y9RboeNKmFCDLlDwAc=", // app.html bootstrap, CRLF fallback
    ],
    // The one inline event handler the app renders: the custom-emoji <img onerror> retry in markdown.ts.
    "script-src-attr": ["unsafe-hashes", "sha256-Nd49K6zAbHBtNZ2ylrgPZM3IXQa52jge41l3ChhYTOA="],
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
    csp,
  },
};

export default config;
