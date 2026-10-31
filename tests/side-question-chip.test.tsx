import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { SideQuestionChip } from "../components/side-question-chip.tsx";

const textOf = (node: React.ReactNode) => parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document.body.textContent!;

describe("SideQuestionChip", () => {
	it("shows the first question, the quoted passage and that the tutor was told", () => {
		const text = textOf(<SideQuestionChip onOpen={() => {}} details={{ thread: [{ question: "Why multiply?", answer: "a", passage: "the derivatives multiply" }, { question: "And?", answer: "b" }], note: "n", toldTutor: true }} />);
		assert.equal(text.replace(/\s+/g, " ").trim(), "Side question: Why multiply? “the derivatives multiply” · told tutor");
	});

	it("leaves out the passage and the told mark when there are none", () => {
		const text = textOf(<SideQuestionChip onOpen={() => {}} details={{ thread: [{ question: "Why?", answer: "a" }], note: "n", toldTutor: false }} />);
		assert.equal(text.trim(), "Side question: Why?");
	});

	it("clips long text at 80 characters", () => {
		const text = textOf(<SideQuestionChip onOpen={() => {}} details={{ thread: [{ question: "q".repeat(200), answer: "a" }], note: "n", toldTutor: false }} />);
		assert.equal(text.trim(), `Side question: ${"q".repeat(80)}…`);
	});
});
