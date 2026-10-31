/**
 * Where a citation's words live in the transcript, shown with the CSS Custom
 * Highlight API (the same mechanism session find uses) so the transcript's
 * React-owned markup is never touched.
 */

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): boolean };

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}

/** ::highlight() rules ship in an injected <style>, never globals.css —
 *  the PostCSS/Tailwind pipeline rejects the pseudo-element (session find's
 *  precedent). */
const STYLE_ID = "lh-citation-style";
function injectStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
::highlight(lh-citation-comment) { background-color: color-mix(in oklab, var(--primary) 30%, transparent); }
::highlight(lh-citation) { background-color: color-mix(in oklab, var(--primary) 45%, transparent); }`;
	document.head.appendChild(style);
}

/** Paint a named highlight over a range; returns the cleanup. No-op where
 *  the Highlight API is missing. */
export function highlightRange(name: "lh-citation" | "lh-citation-comment", range: Range): () => void {
	const highlights = registry();
	if (!highlights) return () => {};
	injectStyles();
	const HighlightCtor = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
	highlights.set(name, new HighlightCtor(range));
	return () => { highlights.delete(name); };
}
