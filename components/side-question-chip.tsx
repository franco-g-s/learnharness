"use client";

import { MessageCircleQuestion } from "lucide-react";
import type { SideQuestionDetails } from "@/src/core";

const CHIP_TEXT_MAX = 80;

function clip(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > CHIP_TEXT_MAX ? `${flat.slice(0, CHIP_TEXT_MAX).trimEnd()}…` : flat;
}

/** A closed side thread in the transcript (#16): a compact centred line at
 *  its position. Clicking reopens the thread read-only. */
export function SideQuestionChip({ details, onOpen }: { details: SideQuestionDetails; onOpen: (element: HTMLElement) => void }) {
	const first = details.thread[0];
	if (!first) return null;
	const passage = details.thread.find((pair) => pair.passage)?.passage;
	return (
		<div className="my-4 flex justify-center">
			<button
				type="button"
				data-testid="side-question-chip"
				onClick={(event) => onOpen(event.currentTarget)}
				className="flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<MessageCircleQuestion aria-hidden="true" className="size-3 shrink-0" />
				<span className="truncate">
					Side question: {clip(first.question)}
					{passage && <span className="italic"> “{clip(passage)}”</span>}
					{details.toldTutor && <span> · told tutor</span>}
				</span>
			</button>
		</div>
	);
}
