/**
 * How a reaction's count rolls when it changes from `previous` to `next`: the vertical offsets, in percent of the
 * number's height (positive is down), that the new number enters from and the old one leaves to. A count going up
 * rolls up, the new number coming from below as the old one leaves upward; one going down rolls down.
 */
export function countRoll(previous: number, next: number): { enter: number; leave: number } {
	if (next === previous) return { enter: 0, leave: 0 };
	return next > previous ? { enter: 100, leave: -100 } : { enter: -100, leave: 100 };
}
