"use client";

import React, { createContext, useContext } from "react";
import { Pencil, Quote } from "lucide-react";
import { citationLabel, type TutorCitation } from "@/src/core";

/** Where a composer chip's link sits in the draft (for comment edits). */
export type ComposerCitationSource = { start: number; end: number; link: string; host: HTMLElement };

/** The chat provides these; chips in the composer and the transcript read
 *  them through context (composer chips render in portals, which keep it). */
export interface CitationActions {
	openSource?: (citation: TutorCitation, anchor: HTMLElement) => void;
	editComment?: (citation: TutorCitation, source: ComposerCitationSource) => void;
}
export const CitationActionsContext = createContext<CitationActions | null>(null);

export interface CitationChipProps {
	citation: TutorCitation;
	variant: "composer" | "transcript";
	/** Editors make the chip atomic; transcript renderers omit this. */
	contentEditable?: false;
	/** Composer chips only: the link's place in the draft. */
	source?: ComposerCitationSource;
}

export function CitationChip({ citation, variant, contentEditable, source }: CitationChipProps) {
	const actions = useContext(CitationActionsContext);
	const label = citationLabel(citation);
	return (
		<span
			data-testid="citation-chip"
			contentEditable={contentEditable}
			className="inline-flex max-w-[16em] items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 align-middle text-sm"
		>
			<button
				type="button"
				aria-label={`View cited tutor text: ${label}`}
				title={citation.text}
				className="inline-flex min-w-0 items-center gap-1 text-left"
				onPointerDown={(event) => event.preventDefault()}
				onClick={(event) => actions?.openSource?.(citation, event.currentTarget)}
			>
				<Quote aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 truncate">{label}</span>
			</button>
			{variant === "composer" ? (
				<button
					type="button"
					aria-label={citation.comment ? "Edit citation comment" : "Add comment to citation"}
					className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
					onPointerDown={(event) => event.preventDefault()}
					onClick={() => { if (source) actions?.editComment?.(citation, source); }}
				>
					<Pencil aria-hidden="true" className="size-3" />
				</button>
			) : null}
		</span>
	);
}
