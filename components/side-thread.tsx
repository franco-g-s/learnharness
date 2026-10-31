"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MessageCirclePlus, MessageCircleQuestion, PanelRightOpen, TextQuote, X } from "lucide-react";
import { SIDE_PASSAGE_MAX_CHARS, SIDE_THREAD_MAX_PAIRS } from "@/src/core";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MenuShell } from "./menu-shell";
import type { CapturedSelection } from "./selection-text";
import type { SelectionAction } from "./selection-toolbar";
import { displayedTell, type SideThreadAnchor, type SideThreadOpenArgs, type SideThreadState } from "./use-side-thread";

/** `/btw <question>` in the composer (teaching sessions): the question, or
 *  "" for a bare `/btw`; null when the text is not the command. */
export function parseBtw(text: string): { question: string } | null {
	const match = /^\s*\/btw(?:\s+([\s\S]*))?$/.exec(text);
	return match ? { question: (match[1] ?? "").trim() } : null;
}

/** The selection toolbar's side-question buttons (teaching sessions): "Ask"
 *  with no thread open; "New question" and "Add to question" with one (F7). */
export function createSideQuestionActions({ threadOpen, open, addPassage }: {
	threadOpen: () => boolean;
	open: (args: SideThreadOpenArgs) => void;
	addPassage: (passage: { text: string; sourceMessageId: string }) => void;
}): SelectionAction[] {
	const passageOf = (capture: CapturedSelection) => ({ text: capture.selector.text, sourceMessageId: capture.messageId });
	const tooLong = (capture: CapturedSelection) => (capture.selector.text.length > SIDE_PASSAGE_MAX_CHARS ? "Shorten selection" : null);
	const openFrom = (capture: CapturedSelection) => {
		open({ anchor: { kind: "range", range: capture.range.cloneRange() }, passage: passageOf(capture) });
		return true;
	};
	return [
		{ id: "side-ask", label: "Ask", ariaLabel: "Ask a side question about this selection", icon: MessageCircleQuestion, disabledLabel: tooLong, visible: () => !threadOpen(), onSelect: openFrom },
		{ id: "side-new", label: "New question", ariaLabel: "Ask a new side question about this selection", icon: MessageCirclePlus, disabledLabel: tooLong, visible: () => threadOpen(), onSelect: openFrom },
		{
			id: "side-add", label: "Add to question", ariaLabel: "Quote this selection in the next side question", icon: TextQuote, disabledLabel: tooLong, visible: () => threadOpen(),
			onSelect: (capture) => { addPassage(passageOf(capture)); return true; },
		},
	];
}

export function sideThreadPlaceholder(state: SideThreadState): string {
	if (state.pairs.length >= SIDE_THREAD_MAX_PAIRS) return "This side thread is full. Close it to start a new one.";
	if (state.pendingPassage) return "Ask about this passage…";
	return state.pairs.length || state.draft ? "Ask a follow-up…" : "Ask a side question…";
}

export interface SideThreadHandlers {
	onAsk: (question: string) => void;
	onSetTell: (tell: boolean) => void;
	onExpand: () => void;
	onClose: () => void;
	/** A closed thread reopened read-only and kept private: tell the tutor now. */
	onTellTutor?: () => void;
}

/** What happens to the note, and the one action that changes it. */
export function noteStatus(state: SideThreadState): { text: string; action?: { label: string; tell: boolean } } {
	const tell = displayedTell(state);
	if (state.readOnly) return tell ? { text: "Told the tutor" } : { text: "Kept private", action: { label: "Tell tutor", tell: true } };
	return tell
		? { text: "Sent to the tutor when you close", action: { label: "Don't send", tell: false } }
		: { text: "Kept private", action: { label: "Send to tutor", tell: true } };
}

/** Roughly two lines of the note at the popover's width, before layout
 *  can measure (static renders, the first paint). */
const NOTE_CLAMP_GUESS_CHARS = 110;

function SideNoteBlock({ state, onSetTell, onTellTutor }: { state: SideThreadState; onSetTell: (tell: boolean) => void; onTellTutor?: () => void }) {
	const note = state.pairs[state.pairs.length - 1]!.note;
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(note.length > NOTE_CLAMP_GUESS_CHARS);
	const textRef = useRef<HTMLParagraphElement>(null);
	useLayoutEffect(() => {
		const el = textRef.current;
		if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
	}, [note, expanded, state.mode]);
	const status = noteStatus(state);
	const act = () => {
		if (!status.action) return;
		if (state.readOnly) onTellTutor?.();
		else onSetTell(status.action.tell);
	};
	return (
		<div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2" data-testid="side-note">
			<p ref={textRef} className={`font-prose text-xs text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}>{note}</p>
			{(overflows || expanded) && (
				<button type="button" className="self-start font-ui text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setExpanded(!expanded)}>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
			<div className="flex items-center gap-1.5 font-ui text-xs" data-testid="side-note-status">
				<span className="text-foreground">{status.text}</span>
				{status.action && (state.readOnly ? onTellTutor : true) && (
					<>
						<span aria-hidden="true" className="text-muted-foreground">·</span>
						<button type="button" className="cursor-pointer text-foreground underline underline-offset-2 hover:text-primary" onClick={act}>
							{status.action.label}
						</button>
					</>
				)}
			</div>
		</div>
	);
}

function Passage({ text }: { text: string }) {
	return (
		<blockquote className="line-clamp-4 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
			{text}
		</blockquote>
	);
}

/** The thread itself: header, Q&A pairs, the note with its toggle, the
 *  follow-up input. Shared by the popover and the panel. */
export function SideThreadBody({ state, onAsk, onSetTell, onExpand, onClose, onTellTutor }: { state: SideThreadState } & SideThreadHandlers) {
	const [question, setQuestion] = useState(state.failed?.question ?? "");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const failedQuestion = state.failed?.question;
	useEffect(() => { if (failedQuestion) setQuestion(failedQuestion); }, [failedQuestion]);
	// The input stays focused through asking and expanding.
	useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [state.mode]);

	const readOnly = state.readOnly !== undefined;
	const full = state.pairs.length >= SIDE_THREAD_MAX_PAIRS;
	const hasNote = state.pairs.length > 0;
	const submit = () => {
		if (!question.trim() || state.draft || full) return;
		onAsk(question);
		setQuestion("");
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="side-thread">
			<div className="flex items-center gap-1.5">
				<MessageCircleQuestion aria-hidden="true" className="size-3.5 text-muted-foreground" />
				<span className="flex-1 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">Side question</span>
				{state.mode === "popover" && (
					<Button type="button" size="icon-xs" variant="ghost" aria-label="Expand" title="Expand" onClick={onExpand}>
						<PanelRightOpen aria-hidden="true" />
					</Button>
				)}
				<Button type="button" size="icon-xs" variant="ghost" aria-label="Close" title="Close" onClick={onClose}>
					<X aria-hidden="true" />
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto font-prose">
				{state.pairs.map((pair, i) => (
					<div key={i} className="flex flex-col gap-1.5" data-testid="side-pair">
						{pair.passage && <Passage text={pair.passage} />}
						<p className="text-sm font-medium">{pair.question}</p>
						<div className="text-sm"><MessageResponse>{pair.answer}</MessageResponse></div>
					</div>
				))}
				{state.draft && (
					<div className="flex flex-col gap-1.5" data-testid="side-draft">
						{state.draft.passage && <Passage text={state.draft.passage} />}
						<p className="text-sm font-medium">{state.draft.question}</p>
						{state.draft.answer ? (
							<div className="text-sm"><MessageResponse>{state.draft.answer}</MessageResponse></div>
						) : null}
						{(state.draft.activity || !state.draft.answer) && (
							<span className="flex items-center gap-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
								<BrailleSpinner label="Answering" />
								<Shimmer duration={1}>{state.draft.activity ?? "THINKING…"}</Shimmer>
							</span>
						)}
					</div>
				)}
				{state.failed && <p role="alert" className="text-sm text-destructive">{state.failed.error}</p>}
			</div>

			{hasNote && <SideNoteBlock state={state} onSetTell={onSetTell} onTellTutor={onTellTutor} />}

			{!readOnly && (
				<div className="flex flex-col gap-1.5 font-prose">
					{state.pendingPassage && <Passage text={state.pendingPassage.text} />}
					<Textarea
						ref={inputRef}
						aria-label="Side question"
						data-testid="side-thread-input"
						className="min-h-9 resize-none font-prose text-sm"
						rows={1}
						value={question}
						disabled={full}
						placeholder={sideThreadPlaceholder(state)}
						onChange={(event) => setQuestion(event.target.value)}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								event.stopPropagation();
								submit();
							} else if (event.key === "Escape") {
								// F11: Esc closes the thread before anything else.
								event.preventDefault();
								event.stopPropagation();
								onClose();
							}
						}}
					/>
				</div>
			)}
		</div>
	);
}

function anchorRect(anchor: SideThreadAnchor, composer: () => HTMLElement | null) {
	if (anchor.kind === "range") {
		// A re-rendered transcript can detach the range: keep the last spot.
		const lines = Array.from(anchor.range.getClientRects()).filter((r) => r.width || r.height);
		return lines.at(-1) ?? null;
	}
	const element = anchor.kind === "element" ? anchor.element : composer();
	return element?.isConnected ? element.getBoundingClientRect() : null;
}

/** The popover: anchored to the passage, the chip, or above the composer. */
export function SideThreadPopover({ state, composer, ...handlers }: { state: SideThreadState; composer: () => HTMLElement | null } & SideThreadHandlers) {
	const up = state.anchor.kind === "composer";
	return (
		<MenuShell
			testid="side-thread-popover"
			getAnchorRect={() => anchorRect(state.anchor, composer)}
			preferredSide={up ? "up" : "down"}
			align={up ? "left" : "right"}
			menuClass="flex w-[26rem] max-w-[calc(100vw-1rem)] flex-col rounded-xl border bg-popover p-3 text-sm shadow-xl"
		>
			<div role="dialog" aria-label="Side question" className="flex min-h-0 flex-col">
				<SideThreadBody state={state} {...handlers} />
			</div>
		</MenuShell>
	);
}

/** The expanded thread: a panel beside the lesson, below the top bar (F8). */
export function SideThreadPanel({ children }: { children: ReactNode }) {
	return (
		<aside aria-label="Side question" data-testid="side-thread-panel" className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-background p-3">
			{children}
		</aside>
	);
}
