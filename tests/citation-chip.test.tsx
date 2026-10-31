import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { CitationChip } from "../components/citation-chip.tsx";
import type { TutorCitation } from "../src/core/citations.ts";

const citation: TutorCitation = { version: 1, chatId: "c", messageId: "m", text: "the derivatives multiply", start: 0, end: 24, prefix: "", suffix: "" };
function documentFor(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

describe("CitationChip", () => {
	it("composer variant offers the source and an add-comment pencil", () => {
		const document = documentFor(<CitationChip citation={citation} variant="composer" contentEditable={false} />);
		const buttons = [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
		assert.deepEqual(buttons, ["View cited tutor text: the derivatives multiply", "Add comment to citation"]);
	});

	it("labels with the comment and switches the pencil to editing", () => {
		const document = documentFor(<CitationChip citation={{ ...citation, comment: "I thought they add" }} variant="composer" />);
		assert.match(document.body.textContent!, /I thought they add/);
		assert.ok(document.querySelector('button[aria-label="Edit citation comment"]'));
	});

	it("transcript variant has no pencil", () => {
		const document = documentFor(<CitationChip citation={citation} variant="transcript" />);
		assert.equal(document.querySelector('button[aria-label="Add comment to citation"]'), null);
		assert.ok(document.querySelector('[data-testid="citation-chip"]'));
	});
});
