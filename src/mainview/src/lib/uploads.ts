import { get, writable } from "svelte/store";
import type { UploadOptions } from "$lib/api/api";

/** How far an upload is, in percent of its body's bytes sent (FetchRequestConfig.onUploadProgress), rounded down: 100
 * once every byte is up and the answer is awaited, never before. 0 while the total isn't known. */
export function uploadPercent(sent: number, total: number): number {
	if (total <= 0) return 0;
	return Math.floor((Math.min(sent, total) / total) * 100);
}

/** An upload's progress as the mobile app words it: "Uploading · 42%". It stays at 100% while the answer is awaited. */
export function uploadNote(percent: number): string {
	return `Uploading · ${percent}%`;
}

/** Whether every byte of an upload's body is up: its request then waits for the answer. */
export function allUp(sent: number, total: number): boolean {
	return total > 0 && sent >= total;
}

// Each file's weight in a message's upload: its size, or 1 for an empty one, so that its bar fills too.
const weights = (sizes: number[]) => sizes.map((size) => (size > 0 ? size : 1));
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** How far the file at index is, from 0 to 1, when sent of the message's total bytes have gone: its files go up one
 * after another, in order, each taking its size's share of the whole, as the mobile app reckons it. */
export function fileShare(sizes: number[], index: number, sent: number, total: number): number {
	if (total <= 0) return 0;
	const w = weights(sizes);
	// In whole numbers, so a file is exactly full when its last byte is: a form's 32 MiB at most keeps them exact.
	const up = Math.min(sent, total) * sum(w) - sum(w.slice(0, index)) * total;
	return Math.min(1, Math.max(0, up / (w[index] * total)));
}

/** Which of a message's files is going up: the first one not all up, or the last once they all are. */
export function fileGoingUp(sizes: number[], sent: number, total: number): number {
	const index = sizes.findIndex((_, i) => fileShare(sizes, i, sent, total) < 1);
	return index === -1 ? sizes.length - 1 : index;
}

/** A message's upload as the line under its files says it, as the mobile app does: "Uploading · 64%" with one file,
 * "Uploading 2 of 3 · 64%" with more. */
export function messageUploadNote(sizes: number[], sent: number, total: number): string {
	const percent = uploadPercent(sent, total);
	if (sizes.length <= 1) return uploadNote(percent);
	return `Uploading ${fileGoingUp(sizes, sent, total) + 1} of ${sizes.length} · ${percent}%`;
}

/** A list without the copy of a message being sent (whose ID is its nonce), or null when it has none: the API's copy
 * took its place, as the message was posted after all. */
export function withoutSending<T extends { id: string }>(messages: T[], nonce: string): T[] | null {
	return messages.some((m) => m.id === nonce) ? messages.filter((m) => m.id !== nonce) : null;
}

/** A message's upload: the bytes of its form sent, and their total (0 until the webview says). */
export interface MessageUpload {
	sent: number;
	total: number;
}

/** The messages with files this window is sending, by nonce: how far each one's upload is. Every list showing the
 * message reads it, in whichever panes, and a view that goes leaves it, as the send goes on without it. */
export const messageUploads = writable<Record<string, MessageUpload>>({});

// What stops each message's upload, by nonce.
const aborts = new Map<string, AbortController>();

/** What a send resolves to when Cancel stopped its upload. */
export const CANCELLED = Symbol("cancelled");

// The upload of nonce went on: a change of its percent (and so of its files' bars) is news, a few more bytes aren't.
function progressed(nonce: string, sent: number, total: number) {
	messageUploads.update((all) => {
		const was = all[nonce];
		if (!was || (was.total === total && uploadPercent(was.sent, was.total) === uploadPercent(sent, total))) return all;
		return { ...all, [nonce]: { sent, total } };
	});
}

/**
 * Sends a message with send, by its nonce. With files, its upload's progress goes to messageUploads, and cancelUpload
 * stops it while its bytes go up: the send then resolves to CANCELLED, whatever its request failed with. An answer that
 * came before still wins, as the message was posted: the send resolves to it.
 */
export async function sendFollowed<T>(
	nonce: string,
	files: File[] | undefined,
	send: (upload?: UploadOptions) => Promise<T>,
): Promise<T | typeof CANCELLED> {
	if (!files?.length) return send();
	const abort = new AbortController();
	aborts.set(nonce, abort);
	messageUploads.update((all) => ({ ...all, [nonce]: { sent: 0, total: 0 } }));
	try {
		return await send({ signal: abort.signal, onUploadProgress: (sent, total) => progressed(nonce, sent, total) });
	} catch (err) {
		if (abort.signal.aborted) return CANCELLED;
		throw err;
	} finally {
		// Only its own: a Retry of the message, which only a failure allows, follows its upload anew.
		if (aborts.get(nonce) === abort) {
			aborts.delete(nonce);
			messageUploads.update((all) => {
				const rest = { ...all };
				delete rest[nonce];
				return rest;
			});
		}
	}
}

/** Cancels a message's upload while its bytes are still going up, and says whether it asked its request to stop. Once
 * they're all up, the API may post the message whatever the client does: there's nothing to cancel then, nor once its
 * request has ended. */
export function cancelUpload(nonce: string): boolean {
	const upload = get(messageUploads)[nonce];
	const abort = aborts.get(nonce);
	if (!upload || !abort || allUp(upload.sent, upload.total)) return false;
	abort.abort();
	return true;
}
