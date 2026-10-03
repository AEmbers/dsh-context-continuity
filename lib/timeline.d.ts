/**
 * The continuity timeline: a subject's lineage read as one bounded, priced list
 * of return anchors.
 *
 * One timeline spans many physical Sessions. The walk starts at the current
 * generation, follows `header.parentSession` through the archived ancestors, and
 * folds **every source with the same projection unit** — so an ancestor's
 * anchors are exactly the anchors its own log recorded, keyed by its own
 * Session (see {@link foldContextProjection}). Candidates are then deduplicated
 * by ref, priced against the *source's own* replayed measurement, and truncated
 * at the requested limit.
 *
 * Two things this module deliberately does not own:
 *
 * - **Measurement.** The engine is a pure library with no `ctx`, so the meter
 *   arrives as {@link ContextTimelineRequest.measureSource}. An unmeasurable
 *   source prices as unknown, never as zero: its candidates stay visible and
 *   say why they are not selectable, which is the fail-closed direction.
 * - **Domain meaning.** A boundary's `attributions` are the host's contribution
 *   (a Team Thread, a Loom continuity line); the engine only applies the shared
 *   rule — a boundary is a selectable default anchor exactly when it resolved
 *   at a completed turn and is attributable to exactly one topic.
 *
 * That rule and the pricing are not this module's private judgement: they live
 * in {@link anchor.ts} because a search hit's enrichment answers the same
 * question and must answer it identically.
 *
 * An unreadable ancestor ends the walk where it broke and is reported in
 * {@link ContextTimeline.incompleteFrom}: history is then complete through the
 * last listed generation and provably absent beyond it. It is never a
 * subject-availability fact, and the truncation is never silent.
 * @module @aembers/dsh-context-continuity/timeline
 */
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { type AnchorSourceKind } from './anchor.ts';
import { type ContextProjectionConfig } from './projection.ts';
import type { StoredSessionReadResult } from './stored-session-reader.ts';
/** How many archived ancestors one walk follows by default. */
export declare const DEFAULT_TIMELINE_ANCESTORS = 8;
/** How many items one timeline returns by default. */
export declare const DEFAULT_TIMELINE_LIMIT = 12;
/**
 * One generation in a subject's lineage: its durable log plus the identity the
 * fold keys on. A stored read spreads into it directly, so an ancestor source
 * is `{ sessionId, ...read.inspection }`.
 */
export interface ContextTimelineSource {
    readonly sessionId: SessionId;
    readonly header: SessionHeader;
    readonly inheritedEventCount: SessionLogOffset;
    readonly events: readonly SessionEvent[];
}
/** Which structural source produced one timeline item. */
export type ContextTimelineSourceKind = AnchorSourceKind;
/**
 * One priced return anchor. A non-restorable item is still returned — with its
 * reason — because "why this anchor cannot be returned to" is exactly what the
 * subject needs in order to choose a different one.
 */
export interface ContextTimelineItem {
    /** Durable selection ref: the checkpoint ref, the host's boundary ref, or the head marker. */
    readonly ref: string;
    /** Model-facing label: the recorded checkpoint name or the host's boundary label. */
    readonly label: string;
    readonly source: ContextTimelineSourceKind;
    /** The host's boundary kind, for `boundary` items — engine-opaque domain vocabulary. */
    readonly kind?: string;
    /** Tokens a return would retain (the prefix through this anchor), in the source's own measurement. */
    readonly retainedTokens: number;
    /** Tokens a return would discard (the suffix after this anchor). */
    readonly discardedTokens: number;
    /**
     * Topics whose facts had entered this generation's context by this anchor:
     * what the host attributed to the boundaries resolved by then. Display only —
     * the restorable rule below reads a boundary's own attributions.
     */
    readonly affectedTopics: readonly string[];
    /** Whether `context_rollover` accepts this ref as a seed target. */
    readonly restorable: boolean;
    /** Why this anchor is not selectable, when it is not. */
    readonly reason?: string;
    /** The Session the anchor lives in; absent when it is the current generation. */
    readonly sourceSessionId?: SessionId;
}
/** One subject's bounded structural timeline. */
export interface ContextTimeline {
    /** The current generation's measured usage, the basis every price was computed against. */
    readonly usageTokens: number;
    /** The budget above which a retained context is no longer worth returning to. */
    readonly handoffAt: number;
    /**
     * The subject's hard limit, echoed back for display. Like `handoffAt` it is
     * the host's own number: the engine prices nothing against it and only lets a
     * reader see where the handoff budget sits relative to the wall.
     */
    readonly hardLimit?: number;
    /** Newest first, deduplicated across generations, truncated at the requested limit. */
    readonly items: readonly ContextTimelineItem[];
    /** The unreadable ancestor that ended the walk early, when one did. */
    readonly incompleteFrom?: {
        readonly sessionId: SessionId;
        readonly reason: string;
    };
}
/** Everything one timeline read needs; the engine supplies all policy, the host all mechanism. */
export interface ContextTimelineRequest {
    /** The generation the subject lives in now. */
    readonly current: ContextTimelineSource;
    /** The fold configuration shared by every source — the same one the registered unit uses. */
    readonly config: ContextProjectionConfig;
    /** Reads one archived ancestor's stored log; the host wraps its own stored-Session reader. */
    readonly readAncestor: (sessionId: SessionId) => Promise<StoredSessionReadResult>;
    /**
     * One source's replayed token measurement, in that source's own tokens. Omit
     * when no meter exists: every candidate then reports that its budget cannot
     * be proven, rather than being priced as free.
     */
    readonly measureSource?: (source: ContextTimelineSource) => number | undefined | Promise<number | undefined>;
    /** The current generation's measured usage; the head prices against it. */
    readonly currentUsageTokens: number;
    /** The retained-context budget above which a return target stops being worth selecting. */
    readonly handoffAt: number;
    /**
     * The subject's hard limit, echoed into {@link ContextTimeline.hardLimit} for
     * display. Omit when the host has no such limit to show.
     */
    readonly hardLimit?: number;
    /** How many items to return; defaults to {@link DEFAULT_TIMELINE_LIMIT}. */
    readonly limit?: number;
    /** How many archived ancestors to follow; defaults to {@link DEFAULT_TIMELINE_ANCESTORS}. */
    readonly maxAncestors?: number;
}
/**
 * Walk one subject's lineage and return its bounded, priced timeline. Sources
 * are folded with the caller's {@link ContextProjectionConfig}, so a seeded
 * generation contributes only its own span and every ref stays keyed to the
 * generation that recorded it.
 *
 * Items stay in lineage order, newest generation first: seqs are per-Session,
 * so they could never order two generations against each other, and the newest
 * generation is the one the subject is living in.
 */
export declare function readContextTimeline(request: ContextTimelineRequest): Promise<ContextTimeline>;
