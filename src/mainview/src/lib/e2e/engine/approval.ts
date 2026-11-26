// A new device approved by another device of the user's (PLAN-E2E-CLIENTES.md, Task 26; decision 24), through the
// approval frames their inboxes carry («Convenciones entre clientes»), one way per attempt:
// - by QR: the new device shows approval_begin's QR, made again before its attempt's ten minutes end. The device that
//   scans it (Android's: the desktop and the web never scan, Ruling 21) approves from it and sends its transfer, which
//   needs no code;
// - by the code: the new device sends the commitment of an attempt of its own to each listed device of the user's. A
//   device that may approve asks its person «Is this device yours?», and offers only on their yes; the new device
//   reveals with the first offer, and shows an empty field for the code the approving device then shows, which the
//   person types; the approving device confirms on their Confirm (on the desktop after Bun's box) and sends the transfer.
// The new device takes the transfer (approval_receive): one sealed to its commitment's key only once the code typed was
// accepted, so one that came before is kept, and taken after it. Then it goes on as with the recovery key (recover.ts'
// putFirstList). The approving device changes no list and no key until that device's list is up (task 24's review, M2).
import type { InboxMessage } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { listDevices } from "../cbor";
import { approvalFingerprint, approvalFrameMessage, readApprovalFrame, type ApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import { observeOwn, servedIdentity } from "./identity";
import { withPreviousKeys } from "./recover";
import { KEPT_APPROVALS } from "./store";

/** What a new device shows as the person sets it up, one way at a time: its QR, or its code's progress; or, the core
 * holding its identity, starting over's recovery key (`reset`) or its first list (`finishing`) still to go up. */
export type DeviceSetup =
	| { way: "qr"; qr: string }
	| { way: "code"; fingerprint: string; offered: boolean; accepted: boolean }
	| { way: "reset"; recoveryKey: string | null; finishing: boolean }
	| { way: "finishing" };

/**
 * What a device of the user's shows of a new one that asks to be approved: its name and the fingerprint its screen
 * shows (Ruling 35); `asked` until the person's yes, `offered` until the new device's reveal, then the `code` to type
 * into it; `confirmed` once its transfer went, until its list is up.
 */
export interface DeviceApproval {
	device: string;
	name: string;
	fingerprint: string;
	step: "asked" | "offered" | "code" | "confirmed";
	code?: string;
}

/** Which approvals this device takes part in now: a new device's, or an approving one's (ready, no change of keys under
 * way, whose new identity the API doesn't have yet); none in any other state. */
export type ApprovalRole = "new" | "approver" | null;

/** An attempt's ten minutes, by the core's clock: the new device's from approval_begin, then from the offer it takes;
 * the approving device's from its offer. */
export const ATTEMPT_MS = 10 * 60_000;
/** The QR is made again before its attempt ends. */
const QR_MS = 9 * 60_000;
/** What a later round may get past: a cut call, the database, another instance (inbox.ts' rule). */
const AGAIN = new Set(["internal", "storage", "locked"]);

interface Attempt {
	way: "qr" | "code";
	qr: string;
	fingerprint: string;
	offered: boolean;
	accepted: boolean;
	/** Calls off its timer. */
	stop: () => void;
}

interface Asked {
	device: string;
	name: string;
	fingerprint: string;
	/** The inbox message of the commitment asked about. */
	message: string;
	step: "asked" | "offered" | "code";
	code?: string;
	/** A confirmed approval's transfer while its send failed: the same bytes go on the next Confirm. */
	transfer?: string;
	stop: () => void;
}

interface Confirmed {
	device: string;
	name: string;
	fingerprint: string;
	stop: () => void;
}

const keptIn = (parts: EngineParts) => {
	const kept = parts.store.read<InboxMessage[]>(KEPT_APPROVALS);
	return Array.isArray(kept) ? kept : [];
};

/** Older than an attempt lasts by the API's word: nothing it asks for can still be done. */
const stale = (message: InboxMessage) => !(Date.now() - Date.parse(message.created_at) < ATTEMPT_MS);

export class Approvals {
	readonly #parts: EngineParts;
	/** Runs work in the engine's turn. */
	readonly #soon: (work: () => Promise<void>) => void;
	/** What the views show changed. */
	readonly #changed: () => void;
	#attempt: Attempt | null = null;
	#asked: Asked | null = null;
	#confirmed: Confirmed | null = null;

	constructor(parts: EngineParts, soon: (work: () => Promise<void>) => void, changed: () => void) {
		this.#parts = parts;
		this.#soon = soon;
		this.#changed = changed;
	}

	/** What the new device shows of its attempt. */
	setup(): DeviceSetup | null {
		const attempt = this.#attempt;
		if (!attempt) return null;
		if (attempt.way === "qr") return { way: "qr", qr: attempt.qr };
		const { fingerprint, offered, accepted } = attempt;
		return { way: "code", fingerprint, offered, accepted };
	}

	/** What the approving device shows: the question asked of its person first, then an approval whose list waits. */
	shown(): DeviceApproval | null {
		const asked = this.#asked;
		if (asked) {
			const { device, name, fingerprint, step, code } = asked;
			return { device, name, fingerprint, step, ...(code ? { code } : {}) };
		}
		if (!this.#confirmed) return null;
		const { device, name, fingerprint } = this.#confirmed;
		return { device, name, fingerprint, step: "confirmed" };
	}

	/** A device this one approved hasn't put up its list yet: no list or key change of this device's may leave it out. */
	holds(): boolean {
		return this.#confirmed !== null;
	}

	/** The new device's attempt is on screen (the person is setting it up now). */
	watching(): boolean {
		return this.#attempt !== null;
	}

	/** Nothing goes on: timers called off, nothing shown. */
	stop() {
		this.#attempt?.stop();
		this.#asked?.stop();
		this.#confirmed?.stop();
		this.#attempt = null;
		this.#asked = null;
		this.#confirmed = null;
	}

	/** `run` in the engine's turn once `ms` passed. */
	#after(ms: number, run: () => Promise<void> | void): () => void {
		return this.#parts.clock.later(ms, () => this.#soon(async () => run()));
	}

	/** A new attempt, shown as its QR, made again before its ten minutes end: the attempt before is over. */
	async begin(): Promise<void> {
		this.#attempt?.stop();
		const { qr } = await this.#parts.host.handle<{ qr: string }>({ cmd: "approval_begin" });
		const attempt: Attempt = { way: "qr", qr, fingerprint: "", offered: false, accepted: false, stop: () => {} };
		attempt.stop = this.#after(QR_MS, () => (this.#attempt === attempt ? this.begin() : undefined));
		this.#attempt = attempt;
		this.#changed();
	}

	/** An attempt is over: its QR or its code isn't shown any more, and no timer makes another. */
	end() {
		this.#attempt?.stop();
		this.#attempt = null;
		this.#changed();
	}

	/** An attempt not done in its ten minutes starts over, with a new QR. */
	#overAfter(ms: number, attempt: Attempt): () => void {
		return this.#after(ms, () => (this.#attempt === attempt ? this.begin() : undefined));
	}

	/**
	 * The code's way, an attempt of its own: its commitment, with this device's name, to each listed device of the
	 * user's, and its fingerprint shown, which the approving device's screen shows too. None that can approve, or none
	 * that got it, is said (`not_found` `approver`).
	 */
	async useCode(): Promise<void> {
		const { api, host, deviceName } = this.#parts;
		const others = (await api.devices()).filter(({ current, listed }) => listed && !current);
		if (others.length === 0) {
			throw new CoreError("not_found", "no other device of the user's can approve this one", { what: "approver" });
		}
		const { commitment } = await host.handle<{ commitment: string }>({ cmd: "approval_begin" });
		const frame = approvalFrameMessage({ duvet: "approval", step: "commitment", data: commitment, name: deviceName });
		let sent = 0;
		for (const { id } of others) {
			await api.sendToDevice(id, frame).then(
				() => sent++,
				(error: unknown) => console.warn("[e2e] A device of the user's wasn't asked to approve this one:", error),
			);
		}
		if (sent === 0) {
			throw new CoreError("not_found", "no other device of the user's got this one's request", { what: "approver" });
		}
		this.#attempt?.stop();
		const fingerprint = await approvalFingerprint(base64Bytes(commitment));
		const attempt: Attempt = { way: "code", qr: "", fingerprint, offered: false, accepted: false, stop: () => {} };
		attempt.stop = this.#overAfter(ATTEMPT_MS, attempt);
		this.#attempt = attempt;
		this.#changed();
	}

	/**
	 * The code the person typed into the new device, from the approving device's screen: the core compares it with its
	 * own (`rule_violation` `code_mismatch` if it isn't), never shown. True once it's accepted: a transfer kept for it
	 * can be taken.
	 */
	async accept(code: string): Promise<boolean> {
		const attempt = this.#attempt;
		if (attempt?.way !== "code" || !attempt.offered) return false;
		await this.#parts.host.handle({ cmd: "approval_accept", code });
		attempt.accepted = true;
		this.#changed();
		return true;
	}

	/** The person's yes on the approving device: its own user observed, then the offer to the new device. */
	async approve(device: string): Promise<void> {
		const asked = this.#asked;
		if (asked?.device !== device || asked.step !== "asked") return;
		const { api, host } = this.#parts;
		const message = keptIn(this.#parts).find(({ id }) => id === asked.message);
		const frame = message && readApprovalFrame(message.message);
		if (!frame) return this.#forget(device);
		const served = await servedIdentity(this.#parts);
		if (served) await observeOwn(this.#parts, served);
		let offer: string;
		try {
			({ offer } = await host.handle<{ offer: string }>({ cmd: "approval_offer", commitment: frame.data }));
		} catch (error) {
			// No device this one may approve: one on the list already, another user's, or this one off its own list.
			if (error instanceof CoreError && ["exists", "rule_violation", "bad_command"].includes(error.code)) {
				console.warn(`[e2e] A new device's request can't be approved here (${error.code}), and goes.`);
				return this.#forget(device);
			}
			throw error;
		}
		await api.sendToDevice(device, approvalFrameMessage({ duvet: "approval", step: "offer", data: offer }));
		asked.step = "offered";
		asked.stop();
		asked.stop = this.#after(ATTEMPT_MS, () => (this.#asked === asked ? this.#forget(device) : undefined));
		this.#changed();
	}

	/** The person's no: the question goes, and with it what the new device sent. */
	decline(device: string) {
		if (this.#asked?.device === device) this.#forget(device);
	}

	/**
	 * The person's Confirm, after they saw the new device accept the code: approval_confirm (on the desktop, after Bun's
	 * box, whose no keeps the code shown), then the transfer to the new device, the same bytes again after a send that
	 * failed. An attempt the core no longer has (`not_found`: another offer since, or its ten minutes) is over.
	 */
	async confirm(device: string): Promise<void> {
		const asked = this.#asked;
		if (asked?.device !== device || asked.step !== "code" || !asked.code) return;
		if (!asked.transfer) {
			try {
				({ transfer: asked.transfer } = await this.#parts.host.handle<{ transfer: string }>({
					cmd: "approval_confirm",
					code: asked.code,
				}));
			} catch (error) {
				// The person's no in Bun's box: not yet, the code still shown.
				if (error instanceof CoreError && error.code === "refused") return;
				if (error instanceof CoreError && error.code === "not_found") this.#forget(device);
				throw error;
			}
		}
		const message = approvalFrameMessage({ duvet: "approval", step: "transfer", data: asked.transfer });
		await this.#parts.api.sendToDevice(device, message);
		this.#forget(device);
		this.#confirmed?.stop();
		const confirmed: Confirmed = { device, name: asked.name, fingerprint: asked.fingerprint, stop: () => {} };
		// The new device's attempt is over within ten minutes of its offer, which came first: so is the wait.
		confirmed.stop = this.#after(ATTEMPT_MS, () => (this.#confirmed === confirmed ? this.#release() : undefined));
		this.#confirmed = confirmed;
		this.#changed();
	}

	/** The user's list as served: once it names the device this one approved, its changes go on. */
	listed(served: { device_list: string }) {
		if (this.#confirmed && listDevices(served.device_list)?.includes(this.#confirmed.device)) this.#release();
	}

	#release() {
		this.#confirmed?.stop();
		this.#confirmed = null;
		this.#changed();
	}

	/** A new device's request let go of: its question, and its frames in the record. */
	#forget(device: string) {
		if (this.#asked?.device === device) {
			this.#asked.stop();
			this.#asked = null;
		}
		const kept = keptIn(this.#parts);
		this.#parts.store.write(
			KEPT_APPROVALS,
			kept.filter(({ from_device_id }) => from_device_id !== device),
		);
		this.#changed();
	}

	/**
	 * The approval frames the inbox kept, each by this device's role: what one is for is done, and what waits stays
	 * kept (in order, the record's newest 20). One a cut call or an unanswered request couldn't do waits for the next
	 * round. True when a transfer set this device up, whose role then changes: the rest stays for its next round.
	 */
	async take(role: ApprovalRole): Promise<boolean> {
		const kept = keptIn(this.#parts);
		if (!role || kept.length === 0) return false;
		// A device's newest commitment alone: one sent again replaces the one before.
		const newest = new Map<string, string>();
		for (const message of kept) {
			if (readApprovalFrame(message.message)?.step === "commitment") newest.set(message.from_device_id, message.id);
		}
		const stays: InboxMessage[] = [];
		let received = false;
		for (const [at, message] of kept.entries()) {
			const frame = readApprovalFrame(message.message);
			if (!frame) continue;
			if (frame.step === "commitment" && newest.get(message.from_device_id) !== message.id) continue;
			let keep: boolean | "received";
			try {
				keep = role === "approver" ? await this.#asApprover(message, frame) : await this.#asNew(message, frame);
			} catch (error) {
				if (error instanceof CoreError && !AGAIN.has(error.code)) throw error;
				console.error("[e2e] An approval waits for the inbox's next round:", error);
				keep = true;
			}
			if (keep === "received") {
				received = true;
				stays.push(...kept.slice(at + 1));
				break;
			}
			if (keep) stays.push(message);
		}
		this.#parts.store.write(KEPT_APPROVALS, stays.length ? stays : null);
		this.#changed();
		return received;
	}

	/** On the approving device: a commitment asks its person; a reveal gives the code; the rest is a new device's. */
	async #asApprover(message: InboxMessage, frame: ApprovalFrame): Promise<boolean> {
		const device = message.from_device_id;
		const asked = this.#asked;
		if (frame.step === "commitment") {
			if (stale(message)) {
				if (asked?.message === message.id) {
					asked.stop();
					this.#asked = null;
				}
				return false;
			}
			if (asked && asked.device !== device) return true;
			if (asked?.message === message.id) return true;
			// A new attempt of the device's, or the first ask: the question starts over.
			asked?.stop();
			const fingerprint = await approvalFingerprint(base64Bytes(frame.data));
			this.#asked = { device, name: frame.name ?? "", fingerprint, message: message.id, step: "asked", stop: () => {} };
			return true;
		}
		if (frame.step !== "reveal" || asked?.device !== device) return false;
		// Asked again after the app started over, it waits for the offer, made again on the person's yes.
		if (asked.step === "asked") return true;
		if (asked.step !== "offered") return false;
		try {
			({ code: asked.code } = await this.#parts.host.handle<{ code: string }>({
				cmd: "approval_check",
				reveal: frame.data,
			}));
		} catch (error) {
			if (!(error instanceof CoreError) || AGAIN.has(error.code)) throw error;
			console.warn(`[e2e] A new device's reveal doesn't hold (${error.code}), and goes.`);
			return false;
		}
		asked.step = "code";
		return false;
	}

	/** On the new device: the first offer by the code's way, and a transfer, kept until its code is accepted. */
	async #asNew(message: InboxMessage, frame: ApprovalFrame): Promise<boolean | "received"> {
		const { api, host } = this.#parts;
		if (frame.step === "offer") {
			const attempt = this.#attempt;
			if (attempt?.way !== "code" || attempt.offered) return false;
			let reveal: string;
			try {
				({ reveal } = await host.handle<{ reveal: string }>({ cmd: "approval_reveal", offer: frame.data }));
			} catch (error) {
				if (!(error instanceof CoreError) || AGAIN.has(error.code)) throw error;
				console.warn(`[e2e] An approving device's offer can't be taken (${error.code}), and goes.`);
				return false;
			}
			// The same offer again gets the same reveal: a send that failed goes on the next round.
			await api.sendToDevice(
				message.from_device_id,
				approvalFrameMessage({ duvet: "approval", step: "reveal", data: reveal }),
			);
			attempt.offered = true;
			attempt.stop();
			attempt.stop = this.#overAfter(ATTEMPT_MS, attempt);
			return false;
		}
		if (frame.step !== "transfer") return false;
		try {
			const { wrapped_previous_backup_keys } = await api.identityBackup();
			await withPreviousKeys(wrapped_previous_backup_keys, (previous) =>
				host.handle({
					...{ cmd: "approval_receive", transfer: frame.data },
					...(previous ? { wrapped_previous_backup_keys: previous } : {}),
				}),
			);
		} catch (error) {
			if (!(error instanceof CoreError) || AGAIN.has(error.code)) throw error;
			// Sealed to the commitment's key, it counts once the code is accepted: kept, and taken after it.
			if (error.code === "not_found" && error.what === "code") return true;
			console.warn(`[e2e] A transfer to this device can't be taken (${error.code}), and goes.`);
			return false;
		}
		return "received";
	}
}
