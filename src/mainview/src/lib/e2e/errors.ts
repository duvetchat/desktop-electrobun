// The core's errors as the engine meets them (PLAN-E2E-CLIENTES.md, its section on the core's host): each host rejects
// a command with a CoreError, whose code (the stable codes of the core's contract) the engine decides by, never its
// message.

/** What an error of the core names beside its code. */
export interface CoreErrorFields {
	/** bad_command: the field of the command it refused. */
	field?: string;
	/** not_found: what isn't there (a group, a message, a device...). */
	what?: string;
	/** gap: the first number missing. */
	from?: number;
	/** needs_identities: the users to observe before the command goes again. */
	users?: string[];
	/** rule_violation: the rule. */
	rule?: string;
	/** decrypt_failed: what didn't open. */
	kind?: string;
	/** too_large: the limit passed. */
	limit?: number;
}

const FIELDS = ["field", "what", "from", "users", "rule", "kind", "limit"] as const;

export class CoreError extends Error implements CoreErrorFields {
	readonly code: string;
	declare readonly field?: string;
	declare readonly what?: string;
	declare readonly from?: number;
	declare readonly users?: string[];
	declare readonly rule?: string;
	declare readonly kind?: string;
	declare readonly limit?: number;

	constructor(code: string, message?: string, fields: CoreErrorFields = {}) {
		super(message || code);
		this.code = code;
		for (const key of FIELDS) if (fields[key] !== undefined) Object.assign(this, { [key]: fields[key] });
	}

	/**
	 * The error of a core's reply, `{error: {code, message, ...}}`: its code, its message, and those of the fields it
	 * names that are what the core writes there.
	 */
	static of(error: { code: string } & Record<string, unknown>): CoreError {
		const fields: CoreErrorFields = {};
		for (const key of ["field", "what", "rule", "kind"] as const) {
			const value = error[key];
			if (typeof value === "string") fields[key] = value;
		}
		for (const key of ["from", "limit"] as const) {
			const value = error[key];
			if (typeof value === "number") fields[key] = value;
		}
		const { users, message } = error;
		if (Array.isArray(users) && users.every((user) => typeof user === "string")) fields.users = users;
		return new CoreError(error.code, typeof message === "string" ? message : undefined, fields);
	}
}
// On the prototype, so an error's own keys are the core's alone.
Object.defineProperty(CoreError.prototype, "name", { value: "CoreError" });

/**
 * A core's reply, as every host reads one: its `ok`, typed by the command it answers, else its error thrown as a
 * CoreError; anything else is internal.
 */
export function replyOk(reply: unknown): any {
	if (typeof reply === "object" && reply !== null) {
		if ("ok" in reply && !("error" in reply)) return reply.ok;
		const error = "ok" in reply || !("error" in reply) ? null : reply.error;
		if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
			throw CoreError.of({ ...error, code: error.code });
		}
	}
	throw new CoreError("internal", "the core's reply is neither ok nor an error");
}
