/**
 * The host hook contract for context continuity.
 *
 * The engine owns the universal mechanics — the idle-boundary generation swap,
 * the admission gate, carried input, checkpoint continuations, the timeline
 * lineage walk, and the shared return-anchor policy. It knows nothing about
 * what a subject is or what the subject's domain treats as meaningful. A host
 * supplies that through this contract: how to resolve a subject to its live
 * Agent and back, how to fold one Session's projection, how to actually perform
 * a swap in its own lifecycle, and the two domain-specific dimensions —
 * which queued messages are ephemeral domain notices, and how to derive a
 * durable idempotency identity for a rollover.
 *
 * The Agent Team implements this over its Member ledger; a single-Individual
 * harness implements it over one Individual and its continuity store. Neither
 * shape leaks into the engine.
 * @module @aembers/dsh-context-continuity/host
 */
/**
 * Whether one queued message is an ephemeral domain notice the successor
 * generation rederives, and so must be dropped rather than carried.
 *
 * The engine's own handoff and continuation envelopes carry the host's plugin
 * attribution but are ordinary delivered context the successor keeps, so they
 * are excluded before the host's domain judgement is consulted. Both the
 * transition coordinator and the projection apply this one rule.
 */
export function isDroppedNotice(codec, host, message) {
    if (codec.isContextSource(message))
        return false;
    return host.isEphemeralNotice(message);
}
