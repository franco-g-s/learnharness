import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { parseBtw, SideThreadBody, sideThreadPlaceholder, createSideQuestionActions } from "../components/side-thread.tsx";
import type { SideThreadState } from "../components/use-side-thread.ts";

const noop = () => {};
const handlers = { onAsk: noop, onSetTell: noop, onExpand: noop, onClose: noop };
const base: SideThreadState = { threadId: "side_1", pairs: [], draft: null, learnerTell: null, mode: "popover", anchor: { kind: "composer" } };
const answered: SideThreadState = { ...base, pairs: [{ question: "Why multiply?", answer: "The rates compose.", passage: "the derivatives multiply", tell: true, note: "Already clarified: chain rule." }] };

function documentFor(state: SideThreadState) {
	return parseHTML(`<html><body>${renderToStaticMarkup(<SideThreadBody state={state} {...handlers} />)}</body></html>`).document;
}

describe("parseBtw", () => {
	it("recognizes the command and its question", () => {
		assert.deepEqual(parseBtw("/btw why multiply?"), { question: "why multiply?" });
		assert.deepEqual(parseBtw("  /btw   spaced  "), { question: "spaced" });
		assert.deepEqual(parseBtw("/btw"), { question: "" });
		assert.deepEqual(parseBtw("/btw\nmultiline\nquestion"), { question: "multiline\nquestion" });
		assert.equal(parseBtw("/btwx"), null);
		assert.equal(parseBtw("by the way /btw"), null);
	});
});

describe("SideThreadBody", () => {
	it("shows the header, the pair, the note and the toggle at the recommendation", () => {
		const document = documentFor(answered);
		assert.match(document.body.textContent!, /Side question/);
		assert.match(document.body.textContent!, /Why multiply\?/);
		assert.match(document.body.textContent!, /the derivatives multiply/);
		assert.match(document.body.textContent!, /Already clarified: chain rule\./);
		const toggle = document.querySelector('[role="switch"]')!;
		assert.equal(toggle.getAttribute("aria-checked"), "true");
		assert.equal(toggle.hasAttribute("disabled"), false);
		assert.deepEqual([...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => l !== "Tell tutor"), ["Expand", "Close"]);
	});

	it("follows the learner's toggle and hides Expand in the panel", () => {
		const document = documentFor({ ...answered, learnerTell: false, mode: "panel" });
		assert.equal(document.querySelector('[role="switch"]')!.getAttribute("aria-checked"), "false");
		assert.equal(document.querySelector('button[aria-label="Expand"]'), null);
	});

	it("locks the toggle and drops the input when reopened read-only", () => {
		const document = documentFor({ ...answered, readOnly: { thread: [{ question: "Why multiply?", answer: "x" }], note: "n", toldTutor: false } });
		const toggle = document.querySelector('[role="switch"]')!;
		assert.equal(toggle.hasAttribute("disabled"), true);
		assert.equal(toggle.getAttribute("aria-checked"), "false");
		assert.equal(document.querySelector('[data-testid="side-thread-input"]'), null);
	});

	it("shows the answer streaming in", () => {
		const document = documentFor({ ...base, draft: { question: "q?", answer: "", activity: "read notes.md" } });
		assert.match(document.body.textContent!, /read notes\.md/);
	});
});

describe("sideThreadPlaceholder", () => {
	it("follows the thread's state", () => {
		assert.equal(sideThreadPlaceholder(base), "Ask a side question…");
		assert.equal(sideThreadPlaceholder({ ...base, pendingPassage: { text: "p", sourceMessageId: "m" } }), "Ask about this passage…");
		assert.equal(sideThreadPlaceholder(answered), "Ask a follow-up…");
		assert.equal(sideThreadPlaceholder({ ...base, pairs: Array.from({ length: 20 }, () => answered.pairs[0]!) }), "This side thread is full. Close it to start a new one.");
	});
});

describe("createSideQuestionActions", () => {
	it("offers Ask with no thread open, and New question / Add to question with one", () => {
		let open = false;
		const actions = createSideQuestionActions({ threadOpen: () => open, open: noop, addPassage: noop });
		const capture = { messageId: "m", range: {} as Range, selector: { text: "x", start: 0, end: 1, prefix: "", suffix: "" } };
		assert.deepEqual(actions.filter((a) => a.visible(capture)).map((a) => a.label), ["Ask"]);
		open = true;
		assert.deepEqual(actions.filter((a) => a.visible(capture)).map((a) => a.label), ["New question", "Add to question"]);
		const long = { ...capture, selector: { ...capture.selector, text: "x".repeat(8_001) } };
		assert.equal(actions[0]!.disabledLabel!(long), "Shorten selection");
	});
});
