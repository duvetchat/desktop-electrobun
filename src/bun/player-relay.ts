// The YouTube relay: a page the app serves to itself on loopback, that frames YouTube's player. The app's pages are
// views://, which WebKit sends no Referer from, and YouTube's embed answers a request with none with error 153 (its
// embedded player rules: the embedder identifies itself by the HTTP Referer). Electrobun 1.15.1 can't give a frame a
// base URL or a header, so a frame of the app can't have one; this page's own address is http://127.0.0.1, a Referer
// YouTube accepts, and what it frames sends it. Nothing is deployed and no other host is involved.
//
// What it serves is fixed: the page, its script and its style, for a video id that is [\w-]{1,32}. It listens on
// 127.0.0.1 only, answers a Host that isn't its own address with 404 (a page of another site can't read it through DNS
// rebinding), and its page has a CSP of its own: no script but its own file, no frame but YouTube's.

const CSP =
	"default-src 'none'; script-src 'self'; style-src 'self'; frame-src https://www.youtube.com; base-uri 'none'; form-action 'none'";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>YouTube player</title>
<link rel="stylesheet" href="/youtube.css">
<script src="/youtube.js" defer></script>
</head>
<body></body>
</html>
`;

const CSS = `html, body { margin: 0; height: 100%; background: #000; }
iframe { display: block; border: 0; width: 100%; height: 100%; }
`;

const SCRIPT = `const id = new URLSearchParams(location.search).get("v");
if (id !== null && /^[\\w-]{1,32}$/.test(id)) {
	const frame = document.createElement("iframe");
	frame.src = \`https://www.youtube.com/embed/\${id}?autoplay=1\`;
	frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
	frame.allowFullscreen = true;
	frame.referrerPolicy = "strict-origin-when-cross-origin";
	frame.title = "YouTube video";
	document.body.append(frame);
}
`;

const FILES: Record<string, { type: string; body: string }> = {
	"/youtube": { type: "text/html; charset=utf-8", body: HTML },
	"/youtube.css": { type: "text/css; charset=utf-8", body: CSS },
	"/youtube.js": { type: "text/javascript; charset=utf-8", body: SCRIPT },
};

/** The answer to a request to the relay listening at port. */
export function relayResponse(request: Request, port: number): Response {
	const none = new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
	if (request.method !== "GET") return none;
	if (request.headers.get("host") !== `127.0.0.1:${port}`) return none;
	const file = FILES[new URL(request.url).pathname];
	if (!file) return none;
	return new Response(file.body, {
		headers: {
			"Content-Type": file.type,
			"Content-Security-Policy": CSP,
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
		},
	});
}

/** Starts the relay on a port the system picks, and says its origin, or null if it couldn't start: players then
 * stay as they were (YouTube's shows error 153 in the app), and the rest of the app is unaffected. */
export function startPlayerRelay(): { origin: string } | null {
	try {
		const server: ReturnType<typeof Bun.serve> = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (request) => relayResponse(request, server.port ?? 0),
		});
		if (!server.port) throw new Error("no port");
		return { origin: `http://127.0.0.1:${server.port}` };
	} catch (err) {
		console.error("[player-relay] didn't start:", err);
		return null;
	}
}
