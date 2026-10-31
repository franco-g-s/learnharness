/**
 * SIDE QUESTIONS (#16), server half. The answer route runs the side agent
 * (agent/subagents/side-question.ts) over the saved record and streams
 * its answer; it never starts a turn and never writes a message. The
 * thread lives on the client until it closes.
 *
 * Gates mirror the turn's (P3): 404 unknown chat, 400 practice session or
 * bad body, 503 for no model / no provider key, the subscription catalog
 * refresh, and the compaction gate (nothing model-facing interleaves with
 * a running compaction).
 *
 * Runs never abort on a client disconnect (F9): the answer finishes in
 * the background and is held in a registry keyed by thread id, so a close
 * that arrives mid-answer can wait for it.
 */

import type { Usage } from "@earendil-works/pi-ai";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { runSideQuestion } from "../agent/subagents/side-question.ts";
import type { CallUsage } from "../core/contracts.ts";
import { ChatInputError } from "../core/input-events.ts";
import { modelsNotConfigured, providerKeyMissing } from "../core/settings.ts";
import { resolveSideQuestionSpec, type EffectiveModelSpec } from "../core/settings-resolution.ts";
import {
	parseSideQuestionInput,
	sideTranscript,
	sideUserMessage,
	type SideNote,
	type SidePair,
	type SideQuestionInput,
} from "../core/side-questions.ts";
import { awaitCompaction } from "./compaction.ts";
import { providerKeyPresent } from "./keys.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";
import { stores } from "./stores.ts";

export type SideAnswerPair = SidePair & SideNote;

// ─── the in-flight registry (globalThis: routes share one module world) ─────

interface InFlightAnswer {
	question: string;
	answer: Promise<SideAnswerPair | null>;
}

/** How long a finished answer stays claimable by a late close. */
const SETTLED_ANSWER_TTL_MS = 10 * 60_000;

function inFlight(): Map<string, InFlightAnswer> {
	const g = globalThis as typeof globalThis & { __lhSideAnswers?: Map<string, InFlightAnswer> };
	return (g.__lhSideAnswers ??= new Map());
}

/** The thread's latest answer run (in flight, or settled within the TTL):
 *  resolves to its pair, or null when the run failed. */
export function inFlightSideAnswer(threadId: string): InFlightAnswer | undefined {
	return inFlight().get(threadId);
}

/** A close took the answer: it may not be claimed twice. */
export function forgetSideAnswer(threadId: string, entry: InFlightAnswer): void {
	if (inFlight().get(threadId) === entry) inFlight().delete(threadId);
}

function register(threadId: string, entry: InFlightAnswer): void {
	inFlight().set(threadId, entry);
	void entry.answer.finally(() => {
		setTimeout(() => forgetSideAnswer(threadId, entry), SETTLED_ANSWER_TTL_MS).unref?.();
	});
}

// ─── the answer route ────────────────────────────────────────────────────────

export interface SideQuestionDeps {
	/** Test seam: builds the engine from the resolved spec. */
	engineFor?: (spec: EffectiveModelSpec) => PiEngine;
}

/** P6: the note the toggle sends when the agent wrote none. */
export function fallbackSideNote(firstQuestion: string): SideNote {
	return { tell: false, note: `Already clarified in a side question: the learner asked "${firstQuestion}".` };
}

function toCallUsage(usage: Usage): CallUsage {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
		reasoningTokens: usage.reasoning ?? 0,
	};
}

const encoder = new TextEncoder();

export async function handleSideQuestion(chatId: string, body: unknown, deps: SideQuestionDeps = {}): Promise<Response> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	if (record.kind === "practice") return Response.json({ error: "Side questions are for teaching sessions" }, { status: 400 });
	let input: SideQuestionInput;
	try { input = parseSideQuestionInput(body); }
	catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	const spec = resolveSideQuestionSpec(record.settings, stores.settingsStore.readSettings());
	if (!spec) return Response.json(modelsNotConfigured(["strong"]), { status: 503 });
	if (isSubscriptionProvider(spec.provider)) await refreshConnectionCatalog(spec.provider);
	if (!providerKeyPresent(spec.provider)) return Response.json(providerKeyMissing(spec.provider, ["strong"]), { status: 503 });
	let engine: PiEngine;
	try {
		engine = deps.engineFor
			? deps.engineFor(spec)
			: piEngineForSpec(spec, false, undefined, () => stores.settingsStore.readSettings()?.models?.strong?.cacheRetention);
	} catch {
		return Response.json({ error: "The selected model is unavailable." }, { status: 503 });
	}

	// The conversation up to the last saved message, after any compaction.
	await awaitCompaction(chatId);
	const current = stores.chatStore.getChat(chatId);
	if (!current) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const userMessage = sideUserMessage(sideTranscript(current.messages), input);

	// Frames buffer until the client reads; a disconnect only stops delivery.
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	const pending: string[] = [];
	const send = (frame: unknown) => {
		const chunk = frame === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(frame)}\n\n`;
		if (controller) {
			try { controller.enqueue(encoder.encode(chunk)); } catch { controller = null; }
		} else pending.push(chunk);
	};
	let finished = false;
	const finish = () => {
		finished = true;
		if (controller) { try { controller.close(); } catch { /* the client left */ } controller = null; }
	};

	const answer = (async (): Promise<SideAnswerPair | null> => {
		try {
			const result = await runSideQuestion({
				engine,
				userMessage,
				chatId,
				onText: (delta) => send({ type: "text", delta }),
				onTool: (name, label) => send({ type: "tool", name, label }),
			});
			if (result.usage.length) {
				try {
					stores.chatStore.appendTurnUsage(chatId, {
						id: crypto.randomUUID(),
						// P5: the thread id becomes the marker's id at close.
						messageId: input.threadId,
						at: new Date().toISOString(),
						model: `${engine.model.provider}:${engine.model.id}`,
						steps: result.usage.map(toCallUsage),
					});
				} catch (err) {
					console.error(`[chat ${chatId}] side question usage append failed:`, err);
				}
			}
			const note = result.note ?? fallbackSideNote(input.thread[0]?.question ?? input.question);
			send({ type: "note", tell: note.tell, note: note.note });
			return {
				question: input.question,
				answer: result.answer,
				...(input.passage !== undefined ? { passage: input.passage } : {}),
				...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
				...note,
			};
		} catch (err) {
			console.error(`[chat ${chatId}] side question failed:`, err);
			send({ type: "error", errorText: "The side question failed. Try asking again." });
			return null;
		} finally {
			send("[DONE]");
			finish();
		}
	})();
	register(input.threadId, { question: input.question, answer });

	return new Response(
		new ReadableStream<Uint8Array>({
			start(c) {
				for (const chunk of pending.splice(0)) c.enqueue(encoder.encode(chunk));
				if (finished) c.close();
				else controller = c;
			},
			cancel() {
				controller = null; // the run continues (F9)
			},
		}),
		{ headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } },
	);
}
