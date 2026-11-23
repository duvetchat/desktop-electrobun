import { describe, expect, test } from "bun:test";
import { relayResponse, startPlayerRelay } from "./player-relay";

const get = (path: string, host: string, method = "GET") =>
	relayResponse(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host } }), 4321);

describe("the YouTube relay", () => {
	test("serves its page, script and style, under a CSP of its own", async () => {
		for (const path of ["/youtube?v=dQw4w9WgXcQ", "/youtube.js", "/youtube.css"]) {
			const response = get(path, "127.0.0.1:4321");
			expect([path, response.status]).toEqual([path, 200]);
			const csp = response.headers.get("content-security-policy") ?? "";
			expect(csp).toContain("default-src 'none'");
			expect(csp).toContain("frame-src https://www.youtube.com;");
			expect(csp).not.toContain("unsafe");
		}
		const html = await get("/youtube", "127.0.0.1:4321").text();
		expect(html).toContain('<script src="/youtube.js" defer>');
		expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
		const script = await get("/youtube.js", "127.0.0.1:4321").text();
		expect(script).toContain("/^[\\w-]{1,32}$/");
		expect(script).not.toMatch(/innerHTML|eval\(|document\.write|localStorage|fetch\(/);
	});

	test("answers nothing else: another path, a method that isn't GET, a Host that isn't its own", () => {
		for (const [path, host, method] of [
			["/", "127.0.0.1:4321", "GET"],
			["/etc/passwd", "127.0.0.1:4321", "GET"],
			["/youtube/../x", "127.0.0.1:4321", "GET"],
			["/youtube", "127.0.0.1:4321", "POST"],
			["/youtube", "evil.example:4321", "GET"],
			["/youtube", "localhost:4321", "GET"],
			["/youtube", "127.0.0.1:9999", "GET"],
		] as const) {
			expect([path, host, method, get(path, host, method).status]).toEqual([path, host, method, 404]);
		}
	});

	test("listens on loopback, and says where", async () => {
		const relay = startPlayerRelay();
		expect(relay?.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d{1,5}$/);
		const page = await fetch(`${relay!.origin}/youtube?v=abc`);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("YouTube player");
	});
});
