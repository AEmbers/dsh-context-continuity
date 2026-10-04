/**
 * The context-continuity projection: the one fold that derives a Session's
 * continuity state from its durable events.
 *
 * The fold is a Harness `ProjectionDefinition`, so the framework owns the
 * drive — replay on attach, incremental application per committed event,
 * persistence, and cache invalidation — and this module owns only the pure
 * transition. Three rules hold every field here to the log alone:
 *
 * - `apply` never mutates: an event this unit does not care about returns the
 *   **same state reference**, because an unchanged reference is what tells the
 *   framework to do no downstream work at all.
 * - Nothing is read from outside the log. Durable refs are derived
 *   deterministically by the host from `(sessionId, callId)` or
 *   `(sessionId, seq)`, so a cold fold over stored events and the live
 *   incremental fold converge on exactly one state.
 * - One registration serves every Session. The framework keeps one unit per
 *   projection key, so the Session identity and the fork-inherited cut live in
 *   the state, seeded by `init` from the header — never in the definition's
 *   closure. Events below the cut are the ancestor's facts and stay folded
 *   under the ancestor's identity.
 *
 * The engine owns the universal structure — checkpoint records, the pending
 * rollover intent, quiet-continuation delivery, carry candidates, open calls,
 * and turn cursors. The one domain-specific dimension is
 * {@link ContextProjectionHost.domainBoundaryOf}: which events are worth
 * returning to, and what a boundary is attributable to, is the host's
 * judgement, delivered as a plain contribution.
 * @module @sophialin/dsh-context-continuity/projection
 */
import { z } from 'zod';
import { isDroppedNotice } from "./host.js";
/** The projection key this engine owns in `SessionProjectionStateMap`. */
export const CONTEXT_CONTINUITY_PROJECTION_KEY = 'contextContinuity';
/** The rollover tool name the engine folds by default. */
export const CONTEXT_ROLLOVER_TOOL_NAME = 'context_rollover';
/** The checkpoint tool name the engine folds by default. */
export const CONTEXT_CHECKPOINT_TOOL_NAME = 'context_checkpoint';
const relatedFileSchema = z.object({ path: z.string().min(1), reason: z.string() }).strict();
const openCallSchema = z.object({ callId: z.string().min(1), name: z.string(), arguments: z.string() }).strict();
const checkpointEntrySchema = z.object({
    checkpointRef: z.string().min(1),
    name: z.string(),
    resultSeq: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
    turnEndSeq: z.number().int(),
}).strict();
const pendingIntentSchema = z.object({
    handoff: z.string(),
    checkpointRef: z.string().min(1).optional(),
    relatedFiles: z.array(relatedFileSchema),
    toolCallId: z.string().min(1),
    resultSeq: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
    turnEndSeq: z.number().int(),
}).strict();
const carriedCandidateSchema = z.object({
    messageId: z.string().min(1),
    surfacedTurn: z.number().int(),
    consumed: z.boolean(),
}).strict();
const domainBoundarySchema = z.object({
    kind: z.string().min(1),
    label: z.string(),
    resultSeq: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
    turnEndSeq: z.number().int(),
    attributions: z.array(z.string()),
}).strict();
/**
 * The persisted-state contract. The framework validates a cached state with
 * this before seeding a fold from it, so a row written by an older shape is
 * discarded (the `stateVersion` bump is the deliberate version of the same
 * decision) rather than forward-applied into nonsense.
 */
export const contextProjectionStateSchema = z.object({
    sessionId: z.string().min(1),
    inheritedEventCount: z.number().int().nonnegative(),
    checkpoints: z.array(checkpointEntrySchema),
    pending: pendingIntentSchema.nullable(),
    continuations: z.array(z.object({ checkpointRef: z.string().min(1), deliveredSeq: z.number().int() }).strict()),
    carriedCandidates: z.array(carriedCandidateSchema),
    lastTurn: z.number().int().nonnegative(),
    openCalls: z.array(openCallSchema),
    boundaries: z.array(domainBoundarySchema),
    seenTopics: z.array(z.string()),
    lastTurnEndSeq: z.number().int(),
}).strict();
/** The empty state of one Session whose log carries no continuity fact yet. */
export function emptyContextProjectionState(target) {
    return {
        sessionId: target.sessionId,
        inheritedEventCount: target.inheritedEventCount ?? 0,
        checkpoints: [],
        pending: null,
        continuations: [],
        carriedCandidates: [],
        lastTurn: 0,
        openCalls: [],
        boundaries: [],
        seenTopics: [],
        lastTurnEndSeq: -1,
    };
}
/**
 * A model-supplied display string that must carry something. Blank prose is
 * treated as absent, exactly as the engine's own tool surface rejects it: a
 * handoff nobody can read back, or a checkpoint with no label to choose by,
 * must never enter the log as a fact.
 */
const nonBlankString = z.string().refine(value => value.trim() !== '');
const rolloverArgumentsSchema = z.object({
    handoff: nonBlankString,
    checkpointRef: z.string().min(1).optional(),
    relatedFiles: z.array(relatedFileSchema).optional(),
}).passthrough();
const checkpointArgumentsSchema = z.object({ name: nonBlankString }).passthrough();
/** One parsed JSON argument object, or undefined when the call carried none. */
function parseArguments(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
/**
 * The rollover arguments one successful call carried. Unparsable or incomplete
 * arguments produce no intent: the fold never invents a handoff it cannot read
 * back, and the model's own call already failed loudly on the tool surface.
 */
function parseRolloverArguments(raw) {
    const parsed = rolloverArgumentsSchema.safeParse(parseArguments(raw));
    if (!parsed.success)
        return undefined;
    return {
        handoff: parsed.data.handoff,
        ...(parsed.data.checkpointRef === undefined ? {} : { checkpointRef: parsed.data.checkpointRef }),
        relatedFiles: parsed.data.relatedFiles ?? [],
    };
}
/** The display name one successful checkpoint call carried; a call without one records nothing. */
function parseCheckpointName(raw) {
    const parsed = checkpointArgumentsSchema.safeParse(parseArguments(raw));
    return parsed.success ? parsed.data.name : undefined;
}
/** One pure transition plus everything it needs to name a fact. */
function createStep(config) {
    const { codec, host } = config;
    const rolloverToolNames = config.rolloverToolNames ?? [CONTEXT_ROLLOVER_TOOL_NAME];
    const checkpointToolName = config.checkpointToolName ?? CONTEXT_CHECKPOINT_TOOL_NAME;
    const isRolloverCall = (name) => rolloverToolNames.includes(name);
    /** Attach one host contribution as a timeline boundary, remembering its topics. */
    const withContribution = (state, contribution, seq, turn) => {
        const boundary = {
            kind: contribution.kind,
            label: contribution.label,
            resultSeq: seq,
            turn,
            turnEndSeq: -1,
            attributions: contribution.topics,
        };
        const unseen = contribution.topics.filter(topic => !state.seenTopics.includes(topic));
        return {
            ...state,
            boundaries: [...state.boundaries, boundary],
            seenTopics: unseen.length === 0 ? state.seenTopics : [...state.seenTopics, ...unseen],
        };
    };
    const boundaryOf = (input) => host.domainBoundaryOf?.(input);
    const applyToolResult = (state, event) => {
        const message = event.data.message;
        const index = state.openCalls.findIndex(call => call.callId === message.toolCallId);
        // An unpaired result (no matching open call) touches nothing: the engine
        // only ever reacts to calls it decided to track.
        if (index === -1)
            return state;
        const recorded = state.openCalls[index];
        const openCalls = state.openCalls.filter(call => call.callId !== message.toolCallId);
        // A landed result — success or failure — consumes its paired open call, so
        // a failed call can never dangle, and a provider retry reusing the call id
        // pairs its fresh result with fresh arguments. Only a successful pair
        // records a checkpoint, an intent, or a boundary.
        if (message.isError === true || event.data.error !== undefined)
            return { ...state, openCalls };
        const seq = event.seq;
        const turn = event.data.turn;
        if (isRolloverCall(recorded.name)) {
            const parsed = parseRolloverArguments(recorded.arguments);
            if (parsed === undefined)
                return { ...state, openCalls };
            // One pending intent per unresolved turn: a second successful call inside
            // the same turn replaces nothing, because the first owns the swap. An
            // intent whose turn already ended is ready, not spent — only once the
            // in-process lock is gone can a later-turn success replace it, which is
            // the retry path that recovers a subject whose swap never came.
            if (state.pending !== null && state.pending.turnEndSeq === -1)
                return { ...state, openCalls };
            const pending = {
                handoff: parsed.handoff,
                ...(parsed.checkpointRef === undefined ? {} : { checkpointRef: parsed.checkpointRef }),
                relatedFiles: parsed.relatedFiles,
                toolCallId: recorded.callId,
                resultSeq: seq,
                turn,
                turnEndSeq: -1,
            };
            return { ...state, openCalls, pending };
        }
        if (recorded.name === checkpointToolName) {
            const name = parseCheckpointName(recorded.arguments);
            if (name === undefined)
                return { ...state, openCalls };
            const entry = {
                checkpointRef: host.checkpointRefFor(state.sessionId, message.toolCallId),
                name,
                resultSeq: seq,
                turn,
                turnEndSeq: -1,
            };
            return { ...state, openCalls, checkpoints: [...state.checkpoints, entry] };
        }
        const contribution = boundaryOf({
            sessionId: state.sessionId,
            seq,
            turn,
            seenTopics: state.seenTopics,
            source: 'tool-result',
            name: recorded.name,
            arguments: recorded.arguments,
            meta: event.data.meta,
        });
        if (contribution === undefined)
            return { ...state, openCalls };
        return withContribution({ ...state, openCalls }, contribution, seq, turn);
    };
    /** One inbox splice: real input queued behind a pending intent becomes a carry candidate. */
    const applyInboxSpliced = (state, inserted) => {
        // Without a pending intent nothing can be carried: the input is ordinary
        // queued work the current generation will consume itself.
        if (state.pending === null || inserted.length === 0)
            return state;
        const fresh = [];
        for (const message of inserted) {
            if (isDroppedNotice(codec, host, message))
                continue;
            if (state.carriedCandidates.some(candidate => candidate.messageId === message.id))
                continue;
            if (fresh.some(candidate => candidate.messageId === message.id))
                continue;
            fresh.push({ messageId: message.id, surfacedTurn: -1, consumed: false });
        }
        if (fresh.length === 0)
            return state;
        return { ...state, carriedCandidates: [...state.carriedCandidates, ...fresh] };
    };
    const applyUserMessage = (state, event) => {
        let next = state;
        // A surfaced candidate is NOT consumed yet: the loop appends the
        // `user/message` before the step runs, so a cancellation can still land
        // between them. Only a completed, uninterrupted assistant answer for the
        // same turn proves the old generation handled it.
        const surfaced = next.carriedCandidates.some(candidate => !candidate.consumed && candidate.messageId === event.data.id);
        if (surfaced) {
            next = {
                ...next,
                carriedCandidates: next.carriedCandidates.map(candidate => candidate.messageId === event.data.id && !candidate.consumed
                    ? { ...candidate, surfacedTurn: next.lastTurn }
                    : candidate),
            };
        }
        const contribution = boundaryOf({
            sessionId: state.sessionId,
            seq: event.seq,
            turn: next.lastTurn,
            seenTopics: next.seenTopics,
            source: 'user-message',
            message: event.data,
        });
        if (contribution !== undefined)
            next = withContribution(next, contribution, event.seq, next.lastTurn);
        // The quiet continuation delivered for one checkpoint completes that
        // checkpoint's delivery state; a replay reads this to avoid re-scheduling
        // a continuation the log already proves was delivered.
        const continuationRef = codec.continuationCheckpointRefOf(event.data);
        if (continuationRef === undefined)
            return next;
        const existing = next.continuations.find(entry => entry.checkpointRef === continuationRef);
        if (existing !== undefined) {
            if (existing.deliveredSeq !== -1)
                return next;
            return {
                ...next,
                continuations: next.continuations.map(entry => entry.checkpointRef === continuationRef ? { ...entry, deliveredSeq: event.seq } : entry),
            };
        }
        return { ...next, continuations: [...next.continuations, { checkpointRef: continuationRef, deliveredSeq: event.seq }] };
    };
    /** A completed, uninterrupted assistant turn answers every candidate surfaced into it. */
    const applyAssistantMessage = (state, event) => {
        if (state.carriedCandidates.length === 0 || event.data.interrupted === true)
            return state;
        let changed = false;
        const carriedCandidates = state.carriedCandidates.map(candidate => {
            if (candidate.consumed || candidate.surfacedTurn !== event.data.turn)
                return candidate;
            changed = true;
            return { ...candidate, consumed: true };
        });
        return changed ? { ...state, carriedCandidates } : state;
    };
    /** One turn end resolves every open anchor it contains and becomes the timeline head. */
    const applyTurnEnd = (state, seq, turn) => {
        let changed = state.lastTurnEndSeq !== seq;
        const checkpoints = state.checkpoints.map(entry => {
            if (entry.turnEndSeq !== -1)
                return entry;
            changed = true;
            return { ...entry, turnEndSeq: seq };
        });
        let pending = state.pending;
        if (pending !== null && pending.turnEndSeq === -1) {
            pending = { ...pending, turnEndSeq: seq };
            changed = true;
        }
        const boundaries = state.boundaries.map(entry => {
            if (entry.turnEndSeq !== -1)
                return entry;
            changed = true;
            return { ...entry, turnEndSeq: seq, turn: entry.turn === -1 ? turn : entry.turn };
        });
        return changed ? { ...state, checkpoints, pending, boundaries, lastTurnEndSeq: seq } : state;
    };
    return (state, event) => {
        // A seeded Session's log opens with the ancestor generation's events. They
        // are that generation's facts — folding them here would key its checkpoints
        // to this Session and arm its rollover intent as this one's pending swap —
        // so everything below the cut returns the same state reference.
        if (event.seq < state.inheritedEventCount)
            return state;
        switch (event.type) {
            case 'tool/call': {
                const { name, arguments: raw } = event.data;
                const tracked = isRolloverCall(name) || name === checkpointToolName || host.tracksCall?.(name, raw) === true;
                if (!tracked)
                    return state;
                return { ...state, openCalls: [...state.openCalls, { callId: event.data.callId, name, arguments: raw }] };
            }
            case 'tool/result':
                return applyToolResult(state, event);
            case 'turn/start':
                return event.data.turn === state.lastTurn ? state : { ...state, lastTurn: event.data.turn };
            case 'turn/end':
                return applyTurnEnd(state, event.seq, event.data.turn);
            case 'user/message':
                return applyUserMessage(state, event);
            case 'assistant/message':
                return applyAssistantMessage(state, event);
            case 'agent/inbox/spliced':
                return applyInboxSpliced(state, event.data.inserted);
            default:
                return state;
        }
    };
}
/**
 * Cold-fold one immutable event log into its continuity state, with exactly the
 * transition the live unit uses. The target names the Session the log belongs
 * to and, for a seeded generation, how much of its opening is the ancestor's.
 */
export function foldContextProjection(events, config, target) {
    const step = createStep(config);
    let state = emptyContextProjectionState(target);
    for (const event of events)
        state = step(state, event);
    return state;
}
/**
 * The host-only projection unit for one subject's Sessions. No wire view is
 * published: the state is read through `ctx.sessionProjections.stateOf(session,
 * key)`, and the derived client surface (timeline candidates) belongs to a
 * later increment.
 *
 * Register it **once per host**: the framework keeps one unit per projection
 * key and drives it for every Session, so the definition closes over no Session
 * identity. `init` records the header's id and its fork-inherited prefix length
 * in the state, which is what keys every ref to the right generation and keeps
 * a seeded successor from adopting its ancestor's facts.
 */
export function createContextProjectionDefinition(config) {
    const step = createStep(config);
    return {
        key: CONTEXT_CONTINUITY_PROJECTION_KEY,
        // v2: the state carries the Session identity it folds and the fork-inherited
        // cut, so one registration serves every Session. A v1 row carries neither
        // and is discarded by `stateSchema` instead of being folded onward.
        stateVersion: 2,
        stateSchema: contextProjectionStateSchema,
        init: (header, inheritedEventCount) => emptyContextProjectionState({ sessionId: header.id, inheritedEventCount: Number(inheritedEventCount) }),
        apply: (state, event) => step(state, event),
    };
}
