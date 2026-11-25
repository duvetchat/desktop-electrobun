import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { BunCoreHost } from "./host-bun";

const host = new BunCoreHost();
afterAll(() => rmSync(host.folder, { recursive: true, force: true }));

// The plan's five commands with ways of their own (PLAN-E2E-CLIENTES.md, its section on the core's host): their bytes
// go in parts, never in one JSON.
test.each(["attachment_encrypt", "attachment_decrypt", "history_share", "catch_up", "history_import"])(
	"handle refuses %s, which has a way of its own",
	async (cmd) => {
		await expect(host.handle({ cmd })).rejects.toMatchObject({ code: "bad_command", field: "cmd" });
	},
);
