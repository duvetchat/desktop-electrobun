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
// putFirstList). The approving device changes no list and no key until that device's list is up (task 24's review, M2),
// and asks of no other new device meanwhile (task 27's review, M5).
import type { InboxMessage } from "$lib/api/e2e";
import { base64Bytes } from "$lib/activity-thumbnail";
import { commitmentDevice, listDevices } from "../cbor";
import { approvalFingerprint, approvalFrameMessage, readApprovalFrame, type ApprovalFrame } from "../conventions";
import { CoreError } from "../errors";
import { coreStatus } from "./bootstrap";
import { signWithout } from "./devices";
import type { EngineParts } from "./engine";
import { approvedHere, forgetApproved, noteApproved, observeOwn, servedIdentity } from "./identity";
import { withPreviousKeys } from "./recover";
import { KEPT_APPROVALS } from "./store";

/** What a new device shows as the person sets it up, one way at a time: its QR, or its code's progress; or, the core
 * holding its identity, starting over's recovery key (`reset`) or its first list (`finishing`) still to go up. */
export type DeviceSetup =
	| { way: "qr"; qr: string }
	| { way: "code"; fingerprint: string; offered: boolean; accepted: boolean }
	| { way: "reset"; recoveryKey: string | null; finishing: boolean }
	| { way: "finishing"; leavingOut?: string[] };

/**
 * What a device of the user's shows of a new one that asks to be approved: its name and the fingerprint its screen
 * shows (Ruling 35); `asked` until the person's yes, `offered` until the new device's reveal, then the `code` to type
 * into it; `confirmed` once its transfer went, until its list is up; `ended` when it can't go on (`over`: its attempt
 * ended, or can't be confirmed here any more; `listed`: the device is set up already). `unfinished`: this device
 * approved it before, by its own record, and no list it took names it yet, so it comes off this device's list first
 * (the core's way out).
 */
export interface DeviceApproval {
	device: string;
	name: string;
	fingerprint: string;
	step: "asked" | "offered" | "code" | "confirmed" | "ended";
	code?: string;
	ended?: "over" | "listed";
	unfinished?: true;
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
	step: "asked" | "offered" | "code" | "ended";
	code?: string;
	ended?: "over" | "listed";
	unfinished: boolean;
	/**
	 * A confirmed approval's transfer while its send failed, with the device the core approved, which it goes to: the
	 * same bytes go on the next Confirm.
	 */
	transfer?: { device: string; data: string };
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

/** When a commitment's attempt ends, by the API's word on when it came: nothing it asks for can be done after. */
const endsAt = (message: InboxMessage) => Date.parse(message.created_at) + ATTEMPT_MS;

export class Approvals {
	readonly #parts: EngineParts;
	/** Runs work in the engine's turn. */
	readonly #soon: (work: () => Promise<void>) => void;
	/** What the views show changed. */
	readonly #changed: () => void;
	/** The hold ended by its timer: the questions that waited for it are asked, in the engine's turn. */
	readonly #released: () => Promise<void>;
	#attempt: Attempt | null = null;
	#asked: Asked | null = null;
	#confirmed: Confirmed | null = null;

	constructor(
		parts: EngineParts,
		soon: (work: () => Promise<void>) => void,
		changed: () => void,
		released: () => Promise<void>,
	) {
		this.#parts = parts;
		this.#soon = soon;
		this.#changed = changed;
		this.#released = released;
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
			const { device, name, fingerprint, step, code, ended, unfinished } = asked;
			return {
				...{ device, name, fingerprint, step },
				...(code ? { code } : {}),
				...(ended ? { ended } : {}),
				...(unfinished ? { unfinished: true as const } : {}),
			};
		}
		if (!this.#confirmed) return null;
		const { device, name, fingerprint } = this.#confirmed;
		return { device, name, fingerprint, step: "confirmed" };
	}

	/** A device this one approved hasn't put up its list yet: no list or key change of this device's may leave it out. */
	holds(): boolean {
		return this.#confirmed !== null;
	}

	/**
	 * While a device this one approved sets up, no other one is approved (task 27's review, M5): its transfer would carry
	 * a list naming the first one without its certificate. The same device again is its way out (`unfinished`).
	 */
	#refuseWhileHeld(device: string) {
		if (this.#confirmed && this.#confirmed.device !== device) {
			throw new CoreError("approval_waits", "a device this one approved hasn't put up its list yet");
		}
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
			// Its approval_begin replaced the QR's attempt: a new QR, as the one on screen would open nothing (review M3).
			await this.begin();
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

	/**
	 * The person's yes on the approving device: its own user observed, then the offer to the new device. Nothing while
	 * the identity it holds was replaced (`not_own_identity`: another device changed the keys, whose transfer this one
	 * hasn't taken): the engine takes its inbox first. A device this one approved before that never took its transfer is
	 * still on this device's list, where the core refuses to approve it again: it comes off first, and alone (the core's
	 * way out, `sign_device_list`, which Bun asks about in its own box on the desktop). Only this device's record says
	 * which device that is: never the list the API serves, nor which devices it registers (desktop-electrobun#542).
	 */
	async approve(device: string): Promise<"replaced" | void> {
		this.#refuseWhileHeld(device);
		const asked = this.#asked;
		if (asked?.device !== device || asked.step !== "asked") return;
		const { api, host, store } = this.#parts;
		const frame = this.#commitmentOf(asked);
		if (!frame) return this.#end(asked, "over");
		const served = await servedIdentity(this.#parts);
		if (served && (await observeOwn(this.#parts, served)) === "not_own_identity") return "replaced";
		if (served && (await this.#unfinished(device))) {
			await signWithout(this.#parts, device, { alone: true });
			forgetApproved(store, [device]);
			if (this.#confirmed?.device === device) this.#release();
		}
		let offer: string;
		try {
			({ offer } = await host.handle<{ offer: string }>({ cmd: "approval_offer", commitment: frame.data }));
		} catch (error) {
			// No device this one may approve: one set up already, another user's, or this one off its own list.
			if (error instanceof CoreError && ["exists", "rule_violation", "bad_command"].includes(error.code)) {
				console.warn(`[e2e] A new device's request can't be approved here (${error.code}).`);
				return this.#end(asked, error.code === "exists" ? "listed" : "over");
			}
			throw error;
		}
		await api.sendToDevice(device, approvalFrameMessage({ duvet: "approval", step: "offer", data: offer }));
		asked.step = "offered";
		asked.unfinished = false;
		asked.stop();
		asked.stop = this.#after(ATTEMPT_MS, () => (this.#asked === asked ? this.#end(asked, "over") : undefined));
		this.#changed();
	}

	/** The commitment the question is about, as the record keeps it. */
	#commitmentOf(asked: Asked): ApprovalFrame | null {
		const message = keptIn(this.#parts).find(({ id }) => id === asked.message);
		return (message && readApprovalFrame(message.message)) || null;
	}

	/** Approved here before, by this device's record, with no list it took naming it since, and still on the list it
	 * holds: its transfer never taken. */
	async #unfinished(device: string): Promise<boolean> {
		if (!approvedHere(this.#parts.store).some((one) => one.device === device)) return false;
		return (listDevices((await coreStatus(this.#parts.host)).device_list ?? "") ?? []).includes(device);
	}

	/** The approval can't go on: it says why until the person closes it, and its timer is called off. */
	#end(asked: Asked, ended: "over" | "listed") {
		asked.stop();
		asked.stop = () => {};
		asked.step = "ended";
		asked.ended = ended;
		delete asked.code;
		this.#changed();
	}

	/** The person's no, or their Close of an approval that ended: the question goes, and what the new device sent. */
	decline(device: string) {
		if (this.#asked?.device === device) this.#forget(device);
	}

	/**
	 * The person's Confirm, after they saw the new device accept the code: approval_confirm (on the desktop, after Bun's
	 * box, whose no keeps the code shown), then the transfer to the device the core approved, which its answer names
	 * (duvetchat/e2e#53; the inbox's sender is the API's word: task 27's review, M6), the same bytes again after a send
	 * that failed. The same offer is made again right before (the core answers it alike): Bun, its core worker started
	 * again, knows only from an offer what its box names. An attempt the core no longer has (`not_found`: another offer
	 * since, or its ten minutes) is over, and says so.
	 */
	async confirm(device: string): Promise<void> {
		const asked = this.#asked;
		if (asked?.device !== device || asked.step !== "code" || !asked.code) return;
		this.#refuseWhileHeld(device);
		if (!asked.transfer) {
			const { host } = this.#parts;
			const frame = this.#commitmentOf(asked);
			if (!frame) return this.#end(asked, "over");
			try {
				await host.handle({ cmd: "approval_offer", commitment: frame.data });
				const confirmed = await host.handle<{ device_id: string; transfer: string }>({
					cmd: "approval_confirm",
					code: asked.code,
				});
				// The core put it on this device's list: an approval of this device's, until a list it takes names it.
				noteApproved(this.#parts.store, confirmed.device_id, this.#parts.clock.now());
				asked.transfer = { device: confirmed.device_id, data: confirmed.transfer };
			} catch (error) {
				// The person's no in Bun's box: not yet, the code still shown.
				if (error instanceof CoreError && error.code === "refused") return;
				if (error instanceof CoreError && error.code === "not_found") return this.#end(asked, "over");
				throw error;
			}
		}
		const approved = asked.transfer.device;
		const message = approvalFrameMessage({ duvet: "approval", step: "transfer", data: asked.transfer.data });
		await this.#parts.api.sendToDevice(approved, message);
		this.#forget(device);
		this.#confirmed?.stop();
		const confirmed: Confirmed = { device: approved, name: asked.name, fingerprint: asked.fingerprint, stop: () => {} };
		// The new device's attempt is over within ten minutes of its offer, which came first: so is the wait, after which
		// the questions that waited for it are asked.
		confirmed.stop = this.#after(ATTEMPT_MS, async () => {
			if (this.#confirmed !== confirmed) return;
			this.#release();
			await this.#released();
		});
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
			const left = endsAt(message) - this.#parts.clock.now();
			if (left <= 0) {
				if (asked?.message === message.id && asked.step === "asked") this.#forget(device);
				return false;
			}
			// One that names another device than its sender, which the API names, asks nothing (task 27's review, M6).
			if (commitmentDevice(frame.data) !== device) {
				console.warn("[e2e] A new device's request names another device than the one that sent it, and goes.");
				return false;
			}
			// While a device this one approved sets up, another one's question waits for its list (M5).
			if (this.#confirmed && this.#confirmed.device !== device) return true;
			if (asked && asked.device !== device) return true;
			if (asked?.message === message.id) return true;
			// A new attempt of the device's, or the first ask: the question starts over, and ends with that attempt.
			asked?.stop();
			const fingerprint = await approvalFingerprint(base64Bytes(frame.data));
			const unfinished = await this.#unfinished(device);
			const question: Asked = {
				...{ device, name: frame.name ?? "", fingerprint, message: message.id },
				...{ step: "asked", unfinished, stop: () => {} },
			};
			question.stop = this.#after(left, () =>
				this.#asked === question && question.step === "asked" ? this.#forget(device) : undefined,
			);
			this.#asked = question;
			return true;
		}
		if (frame.step !== "reveal" || asked?.device !== device) return false;
		// Kept until the approval ends: a restart asks again, and the yes's offer (the same) takes it again (review M1).
		if (asked.step !== "offered") return true;
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
		return true;
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
