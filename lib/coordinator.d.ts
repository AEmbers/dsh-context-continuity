/**
 * The context-continuity coordinator: the one deep module that turns a
 * subject's successful `context_rollover` tool result into its next context
 * generation, and schedules the quiet follow-up owed to a resolved checkpoint.
 *
 * Authority split:
 * - the host's durable store owns the subject→Session binding and rollover audit;
 * - the Session log projection owns intent, checkpoints, and delivery state;
 * - this coordinator owns only process locks and is always reconstructible.
 *
 * The coordinator reacts exclusively after the successful `tool/result` is
 * durably appended — never inside a tool body — so a render/finalize failure
 * can never outrun result durability. The actual swap waits for the containing
 * turn to end and the Agent to be idle, captures later input so no
 * old-generation model request opens, and then defers to the host lifecycle
 * through {@link ContextContinuityHost.executeTransition}.
 * @module @aembers/dsh-context-continuity/coordinator
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { ContextContinuityHost } from './host.ts';
import type { ContextMessageCodec } from './message-codec.ts';
import { type ContextProjectionState } from './projection-state.ts';
import type { TransitionPlan } from './types.ts';
export declare class ContextContinuityCoordinator<SubjectId> {
    private readonly host;
    private readonly codec;
    private readonly subjects;
    private readonly capturedInput;
    /** Per-subject latch for the in-process scheduling→delivery window. */
    private readonly scheduledContinuations;
    private disposed;
    constructor(host: ContextContinuityHost<SubjectId>, codec: ContextMessageCodec);
    /** Whether one subject has a pending or in-flight rollover; tools use this to reject. */
    isTransitioning(id: SubjectId): boolean;
    /**
     * Root `session/event` observer for subject Sessions. The store's dispatch
     * carrier is untagged, so the host maps session ids to subjects and calls
     * this for every subject event. All reactions are gated on the projection
     * state, which itself only records successful durable pairs.
     */
    onSessionEvent(id: SubjectId, agent: Agent, event: SessionEvent): void;
    /** Build the first handoff message of one generation; the host lifecycle delivers it. */
    handoffMessageFor(plan: TransitionPlan): UserMessage;
    /**
     * Whether one Agent's pending transition requires the admission gate: a
     * pending rollover must stop old-generation turns from admitting queued
     * input. The gate arms only for the old-generation Agent instance — the new
     * generation activates mid-swap and must be free to consume the handoff and
     * carried input immediately.
     */
    needsAdmissionGate(agent: Agent): boolean;
    /**
     * Capture the inbox messages queued for an old generation at its turn-stop
     * boundary: real input is preserved verbatim for delivery after the handoff;
     * ephemeral domain notices are dropped because the new generation rederives
     * them. Removing them from the inbox lets the turn close cleanly instead of
     * admitting another old-generation step.
     */
    captureQueuedInput(agent: Agent): readonly UserMessage[];
    /**
     * Capture messages a racing pre-step already claimed from the inbox before
     * rejecting that old-generation step. A rejected step's claimed message is
     * otherwise neither discarded nor re-emitted, so the gate preserves it here.
     */
    captureClaimedInput(agent: Agent, messages: readonly UserMessage[]): readonly UserMessage[];
    private captureInput;
    /** Drain the captured input of one subject for delivery after the handoff. */
    drainCapturedInput(id: SubjectId): readonly UserMessage[];
    /** Drop one subject's bookkeeping; the host calls this on dispose/removal. */
    stopTracking(id: SubjectId): void;
    dispose(): void;
    private onToolResult;
    private onTurnEnd;
    /**
     * Claim the in-process latch for one resolved checkpoint continuation.
     * Returns the latch key when this caller won it, or undefined when the
     * checkpoint never concluded a turn, was already delivered durably, or is
     * latched already. The caller releases the latch on its own failure path.
     */
    private claimContinuationLatch;
    /**
     * Quiet follow-ups for checkpoints resolved by the turn that just ended. A
     * successful `context_checkpoint` result concludes its turn; work continues
     * in the next turn with one host-generated notice. The projection folds
     * delivery, so a restart repairs a missing follow-up through
     * repairContinuations without duplicating a delivered one; this live path
     * latches per checkpoint in memory for the scheduling window.
     */
    private scheduleCheckpointContinuations;
    private performTransition;
    /**
     * Crash-recovery hook the host runs during subject activation: re-derive
     * pending intent from the projection and finish a transition that a restart
     * interrupted after the successful result was durable.
     */
    recoverPendingTransition(id: SubjectId, agent: Agent, sessionId: SessionId): void;
    /**
     * Crash-recovery for quiet continuations: schedule the follow-up for one
     * resolved checkpoint exactly once when the result was durable but the
     * delivery never landed. The projection's continuations state is the durable
     * delivery record — a checkpoint whose delivery event exists in the log is
     * never re-scheduled.
     */
    repairContinuations(agent: Agent, state: ContextProjectionState): void;
}
