"use client";

/**
 * THE OPEN SIDE THREAD (#16) on the client. The server is stateless: the
 * thread lives here until it closes, and every question sends the thread
 * so far. Closing (button, Esc, a new thread, leaving the chat, the page
 * hiding) posts it to the close route, which commits one marker. Nothing
 * reaches the tutor while the thread is open.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
	SIDE_THREAD_MAX_PAIRS,
	type SideNote,
	type SidePair,
	type SideQuestionDetails,
} from "@/src/core";
import { sseEvents } from "./session-core";

/** Where the popover sits: the selected passage (a live Range), the chip
 *  a closed thread reopens from, or just above the composer (/btw). */
export type SideThreadAnchor = { kind: "range"; range: Range } | { kind: "element"; element: HTMLElement } | { kind: "composer" };

export interface SideDraft {
	question: string;
	passage?: string;
	sourceMessageId?: string;
	answer: string;
	/** The file tool running now ("read notes.md"). */
	activity?: string;
}

export interface SideThreadState {
	threadId: string;
	pairs: Array<SidePair & SideNote>;
	/** The question being answered now (one at a time). */
	draft: SideDraft | null;
	/** The passage the next question quotes. */
	pendingPassage?: { text: string; sourceMessageId: string };
	/** The learner's last hand-set toggle; null = never flipped (F10). */
	learnerTell: boolean | null;
	mode: "popover" | "panel";
	anchor: SideThreadAnchor;
	/** A failed question, kept so the learner can ask it again. */
	failed?: { question: string; error: string };
	/** A closed thread reopened from its chip. */
	readOnly?: SideQuestionDetails;
}

export type SideThreadAction =
	| { type: "open"; threadId: string; anchor: SideThreadAnchor; passage?: { text: string; sourceMessageId: string } }
	| { type: "open-read-only"; details: SideQuestionDetails; anchor: SideThreadAnchor }
	| { type: "add-passage"; passage: { text: string; sourceMessageId: string } }
	| { type: "ask"; question: string }
	| { type: "text"; delta: string }
	| { type: "tool"; name: string; label: string }
	| { type: "note"; tell: boolean; note: string }
	| { type: "error"; error: string }
	| { type: "set-tell"; tell: boolean }
	| { type: "expand" }
	| { type: "close" };

export function sideThreadReducer(state: SideThreadState | null, action: SideThreadAction): SideThreadState | null {
	if (action.type === "open") {
		return {
			threadId: action.threadId, pairs: [], draft: null, learnerTell: null, mode: "popover", anchor: action.anchor,
			...(action.passage ? { pendingPassage: action.passage } : {}),
		};
	}
	if (action.type === "open-read-only") {
		const { details } = action;
		return {
			threadId: "", draft: null, learnerTell: details.toldTutor, mode: "popover", anchor: action.anchor, readOnly: details,
			pairs: details.thread.map((pair) => ({ ...pair, tell: details.toldTutor, note: details.note })),
		};
	}
	if (!state) return null;
	switch (action.type) {
		case "close":
			return null;
		case "expand":
			return { ...state, mode: "panel" };
		case "set-tell":
			return state.readOnly ? state : { ...state, learnerTell: action.tell };
		case "add-passage":
			return state.readOnly ? state : { ...state, pendingPassage: action.passage };
		case "ask": {
			const question = action.question.trim();
			if (state.readOnly || state.draft || !question || state.pairs.length >= SIDE_THREAD_MAX_PAIRS) return state;
			const { pendingPassage, failed: _failed, ...rest } = state;
			return {
				...rest,
				draft: {
					question,
					answer: "",
					...(pendingPassage ? { passage: pendingPassage.text, sourceMessageId: pendingPassage.sourceMessageId } : {}),
				},
			};
		}
		case "text": {
			if (!state.draft) return state;
			const { activity: _activity, ...draft } = state.draft;
			return { ...state, draft: { ...draft, answer: draft.answer + action.delta } };
		}
		case "tool":
			return state.draft ? { ...state, draft: { ...state.draft, activity: `${action.name} ${action.label}`.trim() } } : state;
		case "note": {
			if (!state.draft) return state;
			const { activity: _activity, ...draft } = state.draft;
			return { ...state, draft: null, pairs: [...state.pairs, { ...draft, tell: action.tell, note: action.note }] };
		}
		case "error": {
			if (!state.draft) return state;
			const { question, passage, sourceMessageId } = state.draft;
			return {
				...state,
				draft: null,
				failed: { question, error: action.error },
				...(passage && sourceMessageId ? { pendingPassage: { text: passage, sourceMessageId } } : {}),
			};
		}
	}
	return state;
}

/** The toggle as shown (F2): the learner's setting, else the newest recommendation. */
export function displayedTell(state: SideThreadState): boolean {
	if (state.readOnly) return state.readOnly.toldTutor;
	return state.learnerTell ?? state.pairs[state.pairs.length - 1]?.tell ?? false;
}

/** The close route's body. */
export function sideCloseBody(state: SideThreadState) {
	return {
		threadId: state.threadId,
		thread: state.pairs,
		learnerTell: state.learnerTell,
		...(state.draft ? {
			pending: {
				question: state.draft.question,
				...(state.draft.passage !== undefined ? { passage: state.draft.passage } : {}),
				...(state.draft.sourceMessageId !== undefined ? { sourceMessageId: state.draft.sourceMessageId } : {}),
			},
		} : {}),
	};
}

function newThreadId(): string {
	return `side_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

/** Keepalive requests are capped at 64 KiB; a longer thread uses a plain
 *  request (it still completes on an in-app navigation). */
const KEEPALIVE_MAX_BYTES = 60_000;

function postClose(chatId: string, state: SideThreadState): void {
	const body = JSON.stringify(sideCloseBody(state));
	const keepalive = new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES;
	void fetch(`/api/chats/${encodeURIComponent(chatId)}/side-question/close`, { method: "POST", body, keepalive })
		.catch((err) => console.error("side thread close failed:", err));
}

export interface SideThreadOpenArgs {
	anchor: SideThreadAnchor;
	passage?: { text: string; sourceMessageId: string };
	question?: string;
}

export function useSideThread(chatId: string) {
	const [state, dispatch] = useReducer(sideThreadReducer, null);
	// The ref is truth for the callbacks (a close right after a toggle or a
	// frame must send it): every change goes through apply, which updates
	// the ref at once; the pure reducer gives React the same result.
	const stateRef = useRef(state);
	const apply = useCallback((action: SideThreadAction) => {
		stateRef.current = sideThreadReducer(stateRef.current, action);
		dispatch(action);
	}, []);
	// The reader of the answer streaming now; closing stops reading only —
	// the server finishes the answer and the close waits for it (F9).
	const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

	const stopReading = useCallback(() => {
		void readerRef.current?.cancel().catch(() => undefined);
		readerRef.current = null;
	}, []);

	const close = useCallback(() => {
		const current = stateRef.current;
		if (!current) return;
		stopReading();
		if (!current.readOnly && (current.pairs.length || current.draft)) postClose(chatId, current);
		apply({ type: "close" });
	}, [apply, chatId, stopReading]);

	const ask = useCallback((question: string) => {
		const current = stateRef.current;
		if (!current) return;
		apply({ type: "ask", question });
		const next = stateRef.current;
		if (next === current || !next?.draft) return;
		const draft = next.draft;
		const threadId = current.threadId;
		const live = () => stateRef.current?.threadId === threadId;
		void (async () => {
			try {
				const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/side-question`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						threadId,
						thread: current.pairs.map(({ tell: _tell, note: _note, ...pair }) => pair),
						question: draft.question,
						...(draft.passage !== undefined ? { passage: draft.passage } : {}),
						...(draft.sourceMessageId !== undefined ? { sourceMessageId: draft.sourceMessageId } : {}),
						// F10: the next note rewrites this one to cover the whole thread.
						...(current.pairs.length ? { note: current.pairs[current.pairs.length - 1]!.note } : {}),
					}),
				});
				if (!res.ok || !res.body) {
					const body = (await res.json().catch(() => null)) as { error?: string } | null;
					if (live()) apply({ type: "error", error: body?.error ?? "The side question failed. Try asking again." });
					return;
				}
				const reader = res.body.getReader();
				readerRef.current = reader;
				for await (const frame of sseEvents(reader)) {
					if (!live()) return;
					if (frame.type === "text" && typeof frame.delta === "string") apply({ type: "text", delta: frame.delta });
					else if (frame.type === "tool") apply({ type: "tool", name: String(frame.name ?? ""), label: String(frame.label ?? "") });
					else if (frame.type === "note") apply({ type: "note", tell: frame.tell === true, note: String(frame.note ?? "") });
					else if (frame.type === "error") apply({ type: "error", error: String(frame.errorText ?? "The side question failed.") });
				}
			} catch {
				if (live()) apply({ type: "error", error: "The connection dropped. Try asking again." });
			} finally {
				if (live()) readerRef.current = null;
			}
		})();
	}, [apply, chatId]);

	/** Open a new thread; an open one closes (and commits) first (F7). */
	const open = useCallback((args: SideThreadOpenArgs) => {
		close();
		const action: SideThreadAction = { type: "open", threadId: newThreadId(), anchor: args.anchor, ...(args.passage ? { passage: args.passage } : {}) };
		apply(action);
		if (args.question?.trim()) ask(args.question);
	}, [apply, ask, close]);

	const reopenReadOnly = useCallback((details: SideQuestionDetails, anchor: SideThreadAnchor) => {
		close();
		const action: SideThreadAction = { type: "open-read-only", details, anchor };
		apply(action);
	}, [apply, close]);

	const addPassage = useCallback((passage: { text: string; sourceMessageId: string }) => apply({ type: "add-passage", passage }), [apply]);
	const setTell = useCallback((tell: boolean) => apply({ type: "set-tell", tell }), [apply]);
	const expand = useCallback(() => apply({ type: "expand" }), [apply]);

	// F6: leaving the chat or hiding the page commits the open thread.
	useEffect(() => {
		window.addEventListener("pagehide", close);
		return () => {
			window.removeEventListener("pagehide", close);
			close();
		};
	}, [close]);

	return { state, open, ask, addPassage, setTell, expand, close, reopenReadOnly };
}
