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
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { type ContextContinuityHost } from './host.ts';
import type { ContextMessageCodec } from './message-codec.ts';
import type { ContextProjectionState } from './projection-state.ts';
/** The projection key this engine owns in `SessionProjectionStateMap`. */
export declare const CONTEXT_CONTINUITY_PROJECTION_KEY = "contextContinuity";
/** The rollover tool name the engine folds by default. */
export declare const CONTEXT_ROLLOVER_TOOL_NAME = "context_rollover";
/** The checkpoint tool name the engine folds by default. */
export declare const CONTEXT_CHECKPOINT_TOOL_NAME = "context_checkpoint";
/**
 * The domain contribution for one event the engine could anchor on. The host
 * returns one only when the event is worth returning to; `seenTopics` lets it
 * decide what a *first* arrival is in its own terms (the Agent Team suppresses
 * every re-delivery of a Thread's facts; another host may never suppress).
 */
export type DomainBoundaryInput = {
    readonly sessionId: string;
    /** Seq of the anchoring event. */
    readonly seq: number;
    /** Turn the event landed in; -1 when the event carries no turn. */
    readonly turn: number;
    /** Topics whose first anchor already landed in this Session. */
    readonly seenTopics: readonly string[];
} & ({
    readonly source: 'user-message';
    readonly message: UserMessage;
} | {
    readonly source: 'tool-result';
    readonly name: string;
    readonly arguments: string;
    readonly meta: unknown;
});
/** One host-contributed timeline boundary: what it is, how it reads, what it is about. */
export interface DomainBoundaryContribution {
    /** Host-defined anchor kind, e.g. `team_message`, `loom_delivery`. */
    readonly kind: string;
    /** Model-facing display label. */
    readonly label: string;
    /** Domain topics this boundary belongs to; recorded as seen once it lands. */
    readonly topics: readonly string[];
}
/**
 * Everything the fold asks of a host: its durable ref naming, its judgement of
 * ephemeral notices, and its own timeline anchors. A host that also drives the
 * coordinator implements this beside {@link ContextContinuityHost}.
 */
export interface ContextProjectionHost extends Pick<ContextContinuityHost<never>, 'isEphemeralNotice'> {
    /**
     * The durable, collision-resistant ref of one checkpoint, derived from the
     * recording Session and the successful call id. Two Sessions repeating one
     * provider call id must produce two distinct refs.
     */
    checkpointRefFor(sessionId: string, toolCallId: string): string;
    /**
     * The durable ref of one host boundary at one anchoring seq. Consecutive
     * generations repeat event seqs, so the Session identity must be part of the
     * key or an ancestor's boundary would collide with this Session's.
     *
     * The fold stores no boundary refs — a candidate's ref is derived when the
     * lineage read renders it, never persisted — so this names facts for that
     * read, and the fold itself does not call it.
     */
    boundaryRefFor(sessionId: string, seq: number): string;
    /**
     * Whether one open tool call is this host's own effect call — a call whose
     * successful result may anchor a boundary. The engine tracks its own
     * rollover and checkpoint calls without asking.
     */
    tracksCall?(name: string, raw: string): boolean;
    /** The host's boundary for one event, or undefined when the event anchors nothing. */
    domainBoundaryOf?(input: DomainBoundaryInput): DomainBoundaryContribution | undefined;
}
/** How one fold reads the log: the codec it recognizes and the host it asks. */
export interface ContextProjectionConfig {
    /** The codec recognizing this engine's own handoff and continuation envelopes. */
    readonly codec: ContextMessageCodec;
    readonly host: ContextProjectionHost;
    /** Overrides the engine's own tool names, e.g. a legacy alias a host still folds. */
    readonly rolloverToolNames?: readonly string[];
    readonly checkpointToolName?: string;
}
/**
 * The Session one fold covers. Its identity keys every derived ref, and the
 * inherited cut is the length of the prefix a seeded Session repeated from the
 * ancestor generation it continues.
 */
export interface ContextFoldTarget {
    readonly sessionId: string;
    /** Omit for a Session whose log inherited no prefix. */
    readonly inheritedEventCount?: number;
}
/**
 * The persisted-state contract. The framework validates a cached state with
 * this before seeding a fold from it, so a row written by an older shape is
 * discarded (the `stateVersion` bump is the deliberate version of the same
 * decision) rather than forward-applied into nonsense.
 */
export declare const contextProjectionStateSchema: z.ZodType<ContextProjectionState>;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        contextContinuity: ContextProjectionState;
    }
}
/** The empty state of one Session whose log carries no continuity fact yet. */
export declare function emptyContextProjectionState(target: ContextFoldTarget): ContextProjectionState;
/**
 * Cold-fold one immutable event log into its continuity state, with exactly the
 * transition the live unit uses. The target names the Session the log belongs
 * to and, for a seeded generation, how much of its opening is the ancestor's.
 */
export declare function foldContextProjection(events: readonly SessionEvent[], config: ContextProjectionConfig, target: ContextFoldTarget): ContextProjectionState;
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
export declare function createContextProjectionDefinition(config: ContextProjectionConfig): ProjectionDefinition<typeof CONTEXT_CONTINUITY_PROJECTION_KEY, ContextProjectionState>;
