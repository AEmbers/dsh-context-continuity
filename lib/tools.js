/**
 * The model-facing continuity tools, as one factory: `context_rollover`,
 * `context_checkpoint`, and `context_timeline`.
 *
 * These tools are the product surface, not an accessory: a subject manages its
 * own context through them and nothing else. Two halves, split by what is
 * universal and what is domain:
 *
 * - **The engine owns the contract and the safety.** Argument shape (non-blank
 *   handoff, the byte cap, the related-file list, a supplied `checkpointRef`),
 *   the anti-forgery gate, the `concludeTurn()` timing, and the render shapes.
 *   A host customizes prose; it never customizes safety, and a fabricated
 *   `checkpointRef` is a model-visible error rather than a silent fresh
 *   rollover.
 * - **The host owns mechanism and meaning.** {@link ContinuityToolAdapter}
 *   resolves the calling execution to its subject, asks whether a ref is
 *   restorable, performs the transition, records the checkpoint, and reads the
 *   timeline. {@link ContinuityToolText} is the subject-facing vocabulary.
 *
 * The rollover and checkpoint tools are *thin*: they validate, hand the durable
 * intent to the adapter, and let the successful result be the fact. Every
 * lifecycle effect — the generation swap, the successor Session, the carried
 * input — happens after the result is durably appended, which is what makes a
 * half-done rollover recoverable from the log.
 * @module @aembers/dsh-context-continuity/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { brief } from "./context-ref.js";
/** The handoff byte budget; larger handoffs are rejected before they reach the log. */
export const MAX_HANDOFF_CHARS = 32 * 1024;
/** How many related files one handoff may name. */
export const MAX_RELATED_FILES = 32;
const DEFAULT_TEXT = {
    subjectNoun: 'agent',
    rolloverChecklist: 'the current objective and the atomic action in flight; facts and evidence not already recorded elsewhere; unresolved conflicts; current external side effects and their verification state (files, git, jobs, browser state, remote calls); one explicit next step',
    checkpointGuidance: 'Record one before a noisy or risky phase — a broad refactor, an experiment whose value is unproven — when returning to the current completed state may later be useful.',
    timelineGuidance: '',
    topicNoun: 'topic',
    topicNounPlural: 'topics',
};
/**
 * What a rollover carries forward when a host names nothing more: only the one
 * fact true for every subject — it stays the same identity — so a handoff that
 * re-states who it is and its standing role is wasting the very context it is
 * trying to preserve. A host with a durable memory file or a domain ledger
 * extends this with those channels.
 */
function defaultCarriedContext(subjectNoun) {
    return `You remain the same ${subjectNoun} across a rollover: your identity and standing role carry forward automatically — do not restate them.`;
}
/**
 * The rollover intent's own contract, worded as the model must read it. Two
 * sentences are not host knobs: the anti-forgery sentence (a synthesized ref is
 * the one input that could silently produce a context the subject never had),
 * and the delta framing — the handoff is what a fresh generation could not
 * reconstruct on its own, not a full state dump that repeats what carries
 * forward.
 */
function rolloverDescription(text) {
    return `context_rollover: end this context generation and continue as the same ${text.subjectNoun} in a new one. Without checkpointRef the context starts fresh and empty, seeded only by your handoff — the default, cheapest path at context pressure, and the right choice for ordinary generation changes and pressure-driven handoffs. Omit checkpointRef unless you are deliberately returning to a restorable anchor you just selected from a context_timeline result: supply a checkpointRef only when that timeline listed it as restorable and you are citing its exact ref — never synthesize, guess, or reconstruct one; a fabricated ref rejects as a model-visible error. ${text.carriedContext} Write the handoff as the live working state a fresh generation could not reconstruct on its own, as one prose string covering: ${text.rolloverChecklist}. A context change never rolls back any external effect — describe current state so the next generation can re-verify. Record anything worth keeping in your private memory/notes first. Collect or stop your background jobs before calling: a rollover is refused while jobs this ${text.subjectNoun} owns are still running.`;
}
function checkpointDescription(text) {
    return `context_checkpoint: record a named checkpoint at the end of the current turn — an opaque, private, restorable anchor for this ${text.subjectNoun}'s context lineage. ${text.checkpointGuidance} The checkpoint resolves only when this turn completes; the host continues work in the next turn automatically. A checkpoint never snapshots files, git, jobs, or any external state: returning to one (via context_rollover with its checkpointRef) resumes the conversation prefix and nothing else. Checkpoints are private context structure, not shared facts, and are never visible to other subjects.`;
}
function timelineDescription(text) {
    const guidance = text.timelineGuidance === '' ? '' : ` ${text.timelineGuidance}`;
    return `context_timeline: inspect the bounded structural timeline of this ${text.subjectNoun}'s context lineage: the named checkpoints recorded, the boundaries the host contributed (a fact that entered your context and is worth returning to), and the current head — across the current generation and its archived ancestors.${guidance} Returns approximate retained/discarded token estimates, current usage against the handoff budget, the ${text.topicNounPlural} whose facts entered your context by each anchor, and which anchors are restorable. An anchor is a selectable default exactly when it resolved at a completed turn and is attributable to exactly one ${text.topicNoun}; an anchor that is not selectable states its reason. Structural only: no transcript content. A fresh context_rollover (no checkpointRef) never requires consulting this timeline first — call it directly. Use this tool when you specifically intend a checkpointRef return: to pick the smallest sufficient ref, or to confirm that a fresh handoff is the better path when every anchor is non-restorable.`;
}
/** One non-blank string the model supplied, or a rejection naming what was wrong. */
function requireNonBlank(value, message) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new Error(message);
    return value;
}
/**
 * The related files one rollover call named, validated entry by entry: the
 * Harness schema rejects at the execute boundary, and this body adds what a
 * schema cannot express — a blank path or reason must never enter the handoff
 * envelope as an empty field.
 */
function relatedFilesOf(input) {
    if (!Array.isArray(input))
        return [];
    if (input.length > MAX_RELATED_FILES)
        throw new Error(`context_rollover accepts at most ${MAX_RELATED_FILES} related files`);
    const files = [];
    for (const [index, entry] of input.entries()) {
        if (typeof entry !== 'object' || entry === null)
            throw new Error(`context_rollover relatedFiles[${index}] must be an object with path and reason`);
        const candidate = entry;
        files.push({
            path: requireNonBlank(candidate.path, `context_rollover relatedFiles[${index}].path must be a non-empty string`),
            reason: requireNonBlank(candidate.reason, `context_rollover relatedFiles[${index}].reason must be a non-empty string`),
        });
    }
    return files;
}
/**
 * The timeline result, spelled the way the model must read it: a restorable
 * anchor spells out the ref the rollover call has to cite, and a non-restorable
 * one states its reason and quotes its own anchor as an identifier that is
 * explicitly not selectable — a reader has to be able to name the row it is
 * being told it cannot return to.
 */
function renderTimeline(value, topicNounPlural) {
    const budget = value.hardLimit === undefined ? '' : `, hard limit ${value.hardLimit}`;
    const lines = [`Context timeline: ${value.usageTokens} tokens used (handoff at ${value.handoffAt}${budget}). ${value.items.length} item(s):`];
    for (const item of value.items) {
        const topics = item.affectedTopics.length === 0 ? `no ${topicNounPlural}` : `${topicNounPlural} ${item.affectedTopics.join(', ')}`;
        const kind = item.kind === undefined ? '' : ` — ${item.kind}`;
        const verdict = item.restorable
            ? `restorable — ref: ${item.ref}`
            : `not restorable — ${item.reason ?? 'no reason given'} (anchor: ${brief(item.ref)} — not selectable)`;
        lines.push(`- ${item.label} [source: ${item.source}${kind}] (retained ~${item.retainedTokens}, discarded ~${item.discardedTokens}; ${topics}) — ${verdict}`);
    }
    if (value.incompleteFrom !== undefined) {
        lines.push(`History incomplete: the lineage walk stopped at Session ${value.incompleteFrom.sessionId} (${value.incompleteFrom.reason}); ancestors before it could not be read and are not reflected above.`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
/**
 * Build the three continuity tools for one host.
 *
 * The adapter is the host's half: it resolves the calling execution to its
 * subject and performs the effects. `text` only replaces subject-facing
 * wording — the safety-bearing sentences stay in the engine.
 */
export function createContinuityTools(adapter, text = {}) {
    const wording = {
        subjectNoun: text.subjectNoun ?? DEFAULT_TEXT.subjectNoun,
        rolloverChecklist: text.rolloverChecklist ?? DEFAULT_TEXT.rolloverChecklist,
        checkpointGuidance: text.checkpointGuidance ?? DEFAULT_TEXT.checkpointGuidance,
        carriedContext: text.carriedContext ?? defaultCarriedContext(text.subjectNoun ?? DEFAULT_TEXT.subjectNoun),
        timelineGuidance: text.timelineGuidance ?? DEFAULT_TEXT.timelineGuidance,
        topicNoun: text.topicNoun ?? DEFAULT_TEXT.topicNoun,
        topicNounPlural: text.topicNounPlural ?? DEFAULT_TEXT.topicNounPlural,
    };
    const rollover = defineTool({
        name: 'context_rollover',
        description: rolloverDescription(wording),
        parameters: {
            handoff: { type: 'string', required: true, description: `Prose handoff for the next context generation — the live working state it could not reconstruct on its own: ${wording.rolloverChecklist}.` },
            checkpointRef: { type: 'string', description: 'Optional. Omit for the default fresh rollover — ordinary generation changes and pressure-driven handoffs must not supply this. Provide it only to resume from a restorable anchor you just selected in a context_timeline result, citing that exact ref; never synthesize or guess a ref.' },
            relatedFiles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, reason: { type: 'string', required: true } } }, description: 'Workspace paths the next generation should look at first, each with one reason.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', required: true }, status: { type: 'string', required: true } } },
            render: (_args, value) => [{ type: 'text', text: `Context rollover scheduled (${value.mode}). Finish this turn; the host switches you to the next context generation afterward.` }],
        },
        async execute(args, exec) {
            const handoff = typeof args.handoff === 'string' ? args.handoff : '';
            if (handoff.trim() === '')
                throw new Error('context_rollover requires a non-empty handoff');
            if (handoff.length > MAX_HANDOFF_CHARS)
                throw new Error(`context_rollover handoff exceeds ${MAX_HANDOFF_CHARS} characters`);
            const relatedFiles = relatedFilesOf(args.relatedFiles);
            // The declared schema rejects a wrong type but cannot express "non-blank":
            // a blank string would otherwise read as absent, and an absent ref means
            // "fresh" — not what the model asked for.
            const supplied = Object.hasOwn(args, 'checkpointRef') ? args.checkpointRef : undefined;
            if (supplied !== undefined && (typeof supplied !== 'string' || supplied.trim() === '')) {
                throw new Error('context_rollover checkpointRef must be a non-empty string when supplied');
            }
            const checkpointRef = typeof supplied === 'string' ? supplied.trim() : undefined;
            if (checkpointRef !== undefined && !await adapter.isRestorableRef(checkpointRef, exec)) {
                throw new Error(`context_rollover checkpointRef ${checkpointRef} is not a restorable anchor this ${wording.subjectNoun} recorded; cite a ref a context_timeline listed as restorable, or omit checkpointRef for a fresh generation`);
            }
            const outcome = await adapter.requestRollover({
                handoff,
                ...(checkpointRef === undefined ? {} : { checkpointRef }),
                relatedFiles,
            }, exec);
            // The intent is durable; closing the turn here is what lets the swap land
            // at the idle boundary in model order.
            exec.concludeTurn();
            return { mode: outcome.mode, status: 'scheduled' };
        },
    });
    const checkpoint = defineTool({
        name: 'context_checkpoint',
        description: checkpointDescription(wording),
        parameters: {
            name: { type: 'string', required: true, description: 'Short semantic label for this checkpoint, shown in context_timeline.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: { checkpointRef: { type: 'string', required: true }, name: { type: 'string', required: true } } },
            // The ref is the selection surface for `context_rollover`: rendering only
            // the name would leave the model with no legitimate way to cite the anchor
            // it just recorded, and renders are the only channel results reach it.
            render: (_args, value) => [{ type: 'text', text: `Checkpoint recorded: ${value.name} (ref: ${value.checkpointRef}). Work continues in the next turn; the host will continue automatically.` }],
        },
        async execute(args, exec) {
            const name = requireNonBlank(args.name, 'context_checkpoint requires a non-empty name');
            const outcome = await adapter.recordCheckpoint({ name, callId: exec.callId }, exec);
            exec.concludeTurn();
            return { checkpointRef: outcome.checkpointRef, name: outcome.name };
        },
    });
    const timeline = defineTool({
        name: 'context_timeline',
        description: timelineDescription(wording),
        parameters: {
            limit: { type: 'number', description: 'Maximum number of items to return (default 12, at most 24).' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: {
                    usageTokens: { type: 'number', required: true },
                    handoffAt: { type: 'number', required: true },
                    hardLimit: { type: 'number' },
                    items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                                ref: { type: 'string', required: true },
                                label: { type: 'string', required: true },
                                source: { type: 'string', required: true },
                                kind: { type: 'string' },
                                retainedTokens: { type: 'number', required: true },
                                discardedTokens: { type: 'number', required: true },
                                affectedTopics: { type: 'array', required: true, items: { type: 'string' } },
                                restorable: { type: 'boolean', required: true },
                                reason: { type: 'string' },
                                sourceSessionId: { type: 'string' },
                            } } },
                    incompleteFrom: { type: 'object', additionalProperties: false, properties: {
                            sessionId: { type: 'string', required: true },
                            reason: { type: 'string', required: true },
                        } },
                } },
            // The item list is the whole decision surface: without each anchor's ref,
            // label, size estimates, topics and restorable verdict, the model cannot
            // pick a ref for `context_rollover`.
            render: (_args, value) => renderTimeline(value, wording.topicNounPlural),
        },
        async execute(args, exec) {
            const limit = typeof args.limit === 'number' ? args.limit : undefined;
            const result = await adapter.timeline({ ...(limit === undefined ? {} : { limit }) }, exec);
            // The host result is deeply immutable; the tool output contract carries
            // plain mutable arrays, so re-shape without changing any meaning.
            return {
                usageTokens: result.usageTokens,
                handoffAt: result.handoffAt,
                ...(result.hardLimit === undefined ? {} : { hardLimit: result.hardLimit }),
                items: result.items.map(item => ({ ...item, affectedTopics: [...item.affectedTopics] })),
                ...(result.incompleteFrom === undefined ? {} : { incompleteFrom: result.incompleteFrom }),
            };
        },
    });
    return { rollover, checkpoint, timeline };
}
