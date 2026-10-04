/**
 * The read-only state one Session's context-continuity projection folds from
 * its durable event log. Every field here is derived from the log alone, so a
 * cold fold over stored events and the live incremental fold converge on the
 * same value — there is no second store.
 *
 * The state also carries the Session identity it folds and the length of the
 * prefix that Session inherited from the generation it continues. Both belong
 * here rather than in a fold closure: the framework keys one projection unit
 * per key and drives it for every Session, so identity must travel in the
 * state, and a seeded Session's log repeats its ancestor's events — which are
 * the ancestor's facts, not this generation's.
 *
 * The universal fields (checkpoints, pending rollover, quiet continuations,
 * carried candidates, open calls, turn cursors) are owned by the engine. The
 * one host-specific dimension is {@link ContextProjectionState.boundaries}:
 * which domain events count as timeline anchors, and how they are labelled and
 * attributed, is decided by the host through {@link DomainAnchorRule}. The Agent
 * Team anchors on committed messages, claim changes, and first Thread arrivals;
 * a single-Individual harness anchors on committed Input/Effect/Delivery facts.
 * @module @sophialin/dsh-context-continuity/projection-state
 */
/** Whether one checkpoint's quiet continuation has already been delivered durably. */
export function continuationDelivered(state, checkpointRef) {
    return state.continuations.some(entry => entry.checkpointRef === checkpointRef && entry.deliveredSeq !== -1);
}
