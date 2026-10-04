/**
 * The one return-anchor policy: which point in a generation's history may be
 * entered again, and what it costs.
 *
 * Three readers ask that question — the timeline read, a search hit's
 * enrichment, and the rollover executed later against mutable guards — and they
 * must never answer it differently: a ref one surface offers has to be a ref
 * `context_rollover` accepts. Everything here is a read-only evaluation of a
 * generation that has already been folded; nothing mutates a fold, measures a
 * source, or performs an effect.
 *
 * Two rules are deliberately separated. What an anchor *is* decides before what
 * it *costs*, so a boundary that entered the context through several topics
 * never reads as a budget problem; and an unmeasurable source is never priced
 * as free, because "the budget cannot be proven" is exactly the state in which
 * a return must not be offered.
 * @module @sophialin/dsh-context-continuity/anchor
 */
import type { ContextProjectionHost } from './projection.ts';
import type { ContextProjectionState } from './projection-state.ts';
/** Which structural source produced one anchor. */
export type AnchorSourceKind = 'checkpoint' | 'boundary' | 'head';
/** One structural anchor inside one generation's folded state. */
export interface AnchorCandidate {
    /** Durable selection ref: the checkpoint ref, the host's boundary ref, or the head marker. */
    readonly ref: string;
    /** Model-facing label: the recorded checkpoint name or the host's boundary label. */
    readonly label: string;
    readonly source: AnchorSourceKind;
    /** The host's boundary kind, for `boundary` candidates — engine-opaque domain vocabulary. */
    readonly kind?: string;
    /** The seq the anchor's own event occupies. */
    readonly seq: number;
    /** The completed turn the anchor resolved at, or `-1` while it is unresolved. */
    readonly turnEndSeq: number;
    /** The boundary's own topics; empty for checkpoints and the head. */
    readonly attributions: readonly string[];
}
/**
 * Monotonic anchor-share estimate of a seed's retained cost, priced in the
 * SOURCE Session's own measurement: the fraction of the source log the seed
 * prefix covers, scaled to the source's replayed token count. The anchor
 * position is exact and the share grows monotonically toward the source's head,
 * so a large ancestor's anchor prices at the ancestor's real size even inside a
 * small current generation.
 */
export declare function retainedEstimate(sourceUsageTokens: number, sourceLength: number, anchorTurnEndSeq: number): number;
/**
 * The structural anchors of one generation, newest first: resolved checkpoints,
 * resolved host boundaries, and — when asked for — its head.
 *
 * An unresolved anchor is not a candidate: a return target must be a turn the
 * log proved completed. An archived generation's head is not one either: "the
 * current working set" is precisely what that generation is not, and its marker
 * ref would be ambiguous across sources. Callers that only need to know whether
 * a prefix *exists* still see every candidate; truncating a list for display is
 * their own decision.
 */
export declare function anchorCandidates(state: ContextProjectionState, host: ContextProjectionHost, includeHead: boolean): readonly AnchorCandidate[];
/**
 * Why one candidate is not a selectable return anchor, or `undefined` when it
 * is. The order is deliberate: what the anchor *is* decides before what it
 * costs, so a multi-topic boundary never reads as a budget problem.
 */
export declare function anchorRejection(candidate: AnchorCandidate, retainedTokens: number, sourceUsage: number | undefined, handoffAt: number): string | undefined;
