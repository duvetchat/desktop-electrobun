/**
 * What a click on a code block's copy button does, for whatever shows renderMarkdown's HTML: the button carries its code
 * and no handler, so the click is heard around it. Any other click is left alone.
 */
export function copyCode(e: Pick<MouseEvent, "target">) {
	const btn = e.target instanceof Element ? e.target.closest<HTMLElement>(".msg-code-copy") : null;
	if (!btn) return;
	const code = btn.dataset.code;
	if (!code) return;
	navigator.clipboard.writeText(code).then(() => {
		btn.classList.add("copied");
		btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
		setTimeout(() => {
			btn.classList.remove("copied");
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
		}, 1500);
	});
}
