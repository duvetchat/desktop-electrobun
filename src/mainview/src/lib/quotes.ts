// Quote in reply, in the default right-click menu on selected text (#423): the chats' message lists that take a quote
// of one of their messages into their box, as a reply to it. Each list adds itself while it's mounted; a selection in
// one is quoted there, and nowhere else (two panes on one chat each have their own list).

/** A chat's message list, as it takes quotes. */
export interface QuoteTaker {
	/** The list's element: a selection inside it is in it. */
	el: Pick<HTMLElement, "contains">;
	/** Whether a quote of this message goes to the box as a reply: one the list has, that a reply can be to. */
	takes: (messageId: string) => boolean;
	quote: (messageId: string, text: string) => void;
}

const takers = new Set<QuoteTaker>();

/** Adds a list; returns what takes it out. */
export function takeQuotes(taker: QuoteTaker): () => void {
	takers.add(taker);
	return () => takers.delete(taker);
}

function takerOf(at: Element): QuoteTaker | undefined {
	for (const taker of takers) if (taker.el.contains(at)) return taker;
	return undefined;
}

/** Whether the list a selection is in (at: an element in it) quotes that message. */
export function canQuote(at: Element, messageId: string): boolean {
	return takerOf(at)?.takes(messageId) ?? false;
}

/** Quotes the selected text of a message, as a reply to it, in the box of the list the selection is in. */
export function quoteIn(at: Element, messageId: string, text: string): void {
	takerOf(at)?.quote(messageId, text);
}
