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
 * @module @sophialin/dsh-context-continuity/timeline
 */
import { anchorCandidates, anchorRejection, retainedEstimate } from "./anchor.js";
import { foldContextProjection } from "./projection.js";
/** How many archived ancestors one walk follows by default. */
export const DEFAULT_TIMELINE_ANCESTORS = 8;
/** How many items one timeline returns by default. */
export const DEFAULT_TIMELINE_LIMIT = 12;
/** The topics the host had attributed to boundaries resolved by one anchor, order-stable and deduplicated. */
function topicsThrough(state, turnEndSeq) {
    const topics = [];
    for (const boundary of state.boundaries) {
        if (boundary.turnEndSeq === -1 || boundary.turnEndSeq > turnEndSeq)
            continue;
        for (const topic of boundary.attributions)
            if (!topics.includes(topic))
                topics.push(topic);
    }
    return topics;
}
/** Price and annotate one candidate of one source; nothing here mutates the fold. */
function itemFor(candidate, state, source, isCurrent, sourceUsage, request) {
    const retainedTokens = candidate.source === 'head'
        ? request.currentUsageTokens
        : retainedEstimate(sourceUsage ?? 0, source.events.length, candidate.turnEndSeq);
    // Returning inside the current generation replaces its suffix; returning to
    // an ancestor replaces this whole generation (an approximation: the
    // ancestor's own suffix is not part of it). Both numbers say so honestly.
    const discardedTokens = candidate.source === 'head'
        ? 0
        : isCurrent
            ? Math.max(0, request.currentUsageTokens - retainedTokens)
            : request.currentUsageTokens;
    const reason = anchorRejection(candidate, retainedTokens, sourceUsage, request.handoffAt);
    return {
        ref: candidate.ref,
        label: candidate.label,
        source: candidate.source,
        ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
        retainedTokens,
        discardedTokens,
        affectedTopics: topicsThrough(state, candidate.turnEndSeq),
        restorable: reason === undefined,
        ...(reason === undefined ? {} : { reason }),
        ...(isCurrent ? {} : { sourceSessionId: source.sessionId }),
    };
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
export async function readContextTimeline(request) {
    const limit = Math.max(1, Math.trunc(request.limit ?? DEFAULT_TIMELINE_LIMIT));
    const maxAncestors = Math.max(0, Math.trunc(request.maxAncestors ?? DEFAULT_TIMELINE_ANCESTORS));
    const items = [];
    const seen = new Set();
    let incompleteFrom;
    let source = request.current;
    let isCurrent = true;
    let ancestorsWalked = 0;
    for (;;) {
        const state = foldContextProjection(source.events, request.config, {
            sessionId: source.sessionId,
            inheritedEventCount: Number(source.inheritedEventCount),
        });
        const measured = request.measureSource === undefined ? undefined : await request.measureSource(source);
        const sourceUsage = typeof measured === 'number' && Number.isFinite(measured) ? measured : undefined;
        for (const candidate of anchorCandidates(state, request.config.host, isCurrent).slice(0, limit)) {
            if (seen.has(candidate.ref))
                continue;
            seen.add(candidate.ref);
            items.push(itemFor(candidate, state, source, isCurrent, sourceUsage, request));
            if (items.length >= limit)
                break;
        }
        if (items.length >= limit)
            break;
        const parentSessionId = source.header.parentSession;
        if (parentSessionId === undefined || ancestorsWalked >= maxAncestors)
            break;
        const read = await request.readAncestor(parentSessionId);
        if (!read.ok) {
            incompleteFrom = { sessionId: parentSessionId, reason: `${read.failure.kind}: ${read.failure.detail}` };
            break;
        }
        source = { sessionId: parentSessionId, ...read.inspection };
        ancestorsWalked += 1;
        isCurrent = false;
    }
    return {
        usageTokens: request.currentUsageTokens,
        handoffAt: request.handoffAt,
        ...(request.hardLimit === undefined ? {} : { hardLimit: request.hardLimit }),
        items,
        ...(incompleteFrom === undefined ? {} : { incompleteFrom }),
    };
}
