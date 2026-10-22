import type { GatewaySpace, MemberOnSidebar, Modal } from "$lib/types";

/** Where an interaction happened: what a modal it opens needs for its submit and its selects. */
export interface ModalContext {
	roomId: string;
	/** The message whose component was used. */
	messageId?: string;
	space: GatewaySpace | null;
	members: MemberOnSidebar[];
	/** The bot that answers, for the modal's header. */
	from: { name: string; avatarUrl: string | null };
}

/** A modal a bot opened for the user, with the application its submit goes to. */
export interface OpenedModal extends ModalContext {
	modal: Modal;
	applicationId: string;
}

// The modal the user has open: one at a time, a newer one in its place (InteractionModal draws it).
class InteractionModalStore {
	current = $state<OpenedModal | null>(null);

	open(opened: OpenedModal) {
		this.current = opened;
	}

	close() {
		this.current = null;
	}
}

export const interactionModal = new InteractionModalStore();
