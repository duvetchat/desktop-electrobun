// A file through the core a part at a time, as every host's sealFile and openFile run it (PLAN-E2E-CLIENTES.md, the
// core's host): the web's worker (web/worker.ts) and the tests' host over bun:ffi (testing/host-bun.ts).
import { base64Bytes } from "../activity-thumbnail";
import { bytesBase64 } from "../staged-images";
import { ATTACHMENT_PART, PART_TAG } from "./host";

/**
 * `bytes` through `attachment_encrypt` or `attachment_decrypt`, one command a part: ATTACHMENT_PART bytes of a plain
 * file each, ATTACHMENT_PART + PART_TAG of a sealed one, the last part marked, and an empty file one part. `run` runs a
 * command and gives its reply's ok; `progress` hears how much of `bytes` is through.
 */
export function throughCore(
	run: (command: object) => { data: string },
	cmd: "attachment_encrypt" | "attachment_decrypt",
	key: string,
	attachmentId: string,
	bytes: Uint8Array,
	progress?: (done: number) => void,
): Blob {
	const size = cmd === "attachment_encrypt" ? ATTACHMENT_PART : ATTACHMENT_PART + PART_TAG;
	const count = Math.max(1, Math.ceil(bytes.length / size));
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for (let index = 0; index < count; index++) {
		const data = bytesBase64(bytes.subarray(index * size, (index + 1) * size));
		parts.push(
			base64Bytes(run({ cmd, key, attachment_id: attachmentId, index, last: index === count - 1, data }).data),
		);
		progress?.(Math.min(bytes.length, (index + 1) * size));
	}
	return new Blob(parts);
}
