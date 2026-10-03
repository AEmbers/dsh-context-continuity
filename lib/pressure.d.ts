/**
 * The one context-pressure policy: when a subject near its budget is told to
 * prepare a handoff, and what happens at the hard limit.
 *
 * Two thresholds, one order, and no host-side re-derivation of either. Below the
 * handoff budget nothing happens. At it, one structured notice is steered into
 * the running turn — once per generation, latched by durable Session evidence
 * rather than process state, so a restart stays quiet and a rollover re-arms.
 * At the hard limit the request is forced through a reduction first and fails
 * closed unless that reduction is *proven*: the durable surface advanced, or
 * pressure measurably fell. A subject whose route capacity cannot be resolved is
 * refused rather than treated as unbounded.
 *
 * What the notice says about work in hand is the host's vocabulary (a Team
 * Member has Claims and jobs; another subject has whatever it has), and so are
 * the meter, the compaction capability, and the steer itself. What the notice
 * must say — the measured numbers, the default action, and the discipline of
 * recording durable knowledge before switching — is the engine's, because a
 * subject that loses context without those has lost work.
 *
 * The notice's `source.summary` is frozen: hosts read their own history back,
 * and a notice already in a live log has to keep decoding as one. It rides the
 * host's own producer kind — format V4 admits nothing else — and the latch
 * below recognizes both that kind and the read-time conversion of the released
 * rows written before it.
 * @module @aembers/dsh-context-continuity/pressure
 */
import { type UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * The `source.summary` of the one-shot pressure notice. Frozen: notices already
 * written into live Session logs must keep decoding as this policy's own.
 */
export declare const PRESSURE_NOTICE_SUMMARY = "Context pressure: prepare a handoff";
/** The effective context budget of one subject's current route. */
export interface PressureLimits {
    /** Context tokens measured for the current generation. */
    readonly usageTokens: number;
    /** At or above this the request is reduced first, or refused. */
    readonly hardLimit: number;
    /** At or above this the subject is told to prepare a handoff. */
    readonly handoffAt: number;
}
/**
 * One observation of a subject's durable surface, which is how the engine
 * proves a reduction happened instead of taking the capability's word for it.
 */
export interface PressureSurface {
    /** Monotone counter of the durable replacement generation. */
    readonly generation: number;
    /** Measured total context tokens, or absent when no meter exists. */
    readonly tokens?: number | undefined;
}
/** The reduction capability in one subject's scope, e.g. the harness compaction engine. */
export interface PressureCompaction {
    /**
     * Force one reduction now and leave the durable surface reduced. Resolves with
     * the capability's own result — `null` means there was no compactable range —
     * and rejects to report a failure after whatever progress it made.
     */
    reduce(reason: 'context-overflow', signal: AbortSignal): Promise<unknown>;
}
/**
 * One subject's durable log, as the notice latch reads it. `events` may be the
 * whole log or its own slice; everything below `inheritedEventCount` belongs to
 * the generation this one continues, so it is not this generation's notice.
 */
export interface PressureLogSpan {
    readonly sessionId: string;
    readonly inheritedEventCount: number;
    readonly events: readonly SessionEvent[];
}
/** What one subject has in hand, in the host's own vocabulary. */
export interface PressureInHand {
    /** Durable work the subject is holding, as labels for the notice. */
    readonly inHand: readonly string[];
    /** Background jobs still running, as labels for the notice. */
    readonly jobs: readonly string[];
}
/**
 * Everything the pressure policy needs from a host. Every member is per-subject
 * and resolved at call time: one policy serves every subject a host runs.
 */
export interface PressurePolicyHost<SubjectId> {
    /** The plugin id this notice is attributed to, so a later run recognizes its own. */
    readonly pluginId: string;
    /** Effective budgets for one subject's current route; absent means unknown. */
    limitsFor(subject: SubjectId): PressureLimits | undefined | Promise<PressureLimits | undefined>;
    /** The subject's durable surface right now, for proving a reduction. */
    surfaceFor(subject: SubjectId): PressureSurface;
    /** The reduction capability in this subject's scope, or absent when unavailable. */
    compactionFor(subject: SubjectId): PressureCompaction | undefined;
    /** The subject's durable log, for the once-per-generation notice latch. */
    logSpanFor(subject: SubjectId): PressureLogSpan;
    /** What the subject has in hand, for the notice. */
    inHandFor(subject: SubjectId): PressureInHand;
    /**
     * Steer one notice into the subject's running turn. The host must record it in
     * the subject's own durable log — the latch reads that evidence back, so a
     * notice that was steered but not logged is delivered again.
     */
    steer(subject: SubjectId, notice: UserMessage): void;
    /** Report a blocked request with a recoverable diagnostic. */
    failedFor(subject: SubjectId, diagnostic: string): void;
    /** Log one diagnostic, attributable to the subject it names. */
    log(message: string, subject: SubjectId): void;
}
/** Subject-facing wording a host may override; the notice's substance is not a knob. */
export interface PressureNoticeText {
    /** The label naming durable work in hand, e.g. `Active Claims`. */
    readonly inHandLabel?: string;
    /** The label naming background jobs, e.g. `Owner jobs`. */
    readonly jobsLabel?: string;
    /** The rollover tool a subject should call, when a host renamed it. */
    readonly rolloverToolName?: string;
}
/** What one pre-step policy call decided. */
export type PressureStepDecision = {
    readonly kind: 'continue';
} | {
    readonly kind: 'notice';
} | {
    readonly kind: 'reject';
};
/**
 * The notice one subject near its handoff budget receives: the measured numbers,
 * what it is holding, and the default action. Deliberately short — it competes
 * with the work for the very context it is warning about.
 */
export declare function contextPressureNoticeText(input: {
    readonly usageTokens: number;
    readonly handoffAt: number;
    readonly hardLimit: number;
    readonly inHand: readonly string[];
    readonly jobs: readonly string[];
}, text?: PressureNoticeText): string;
/**
 * The one context-pressure policy of one host. It reads budgets and surfaces
 * through the host, steers the notice through the host, and owns the decision
 * order, the once-per-generation latch, and the fail-closed reduction proof.
 */
export declare class ContextPressurePolicy<SubjectId> {
    private readonly host;
    private readonly text;
    /**
     * Retry budget per subject for the current provider-overflow sequence.
     * Process-only by design: a restart re-earns one sequence per chain.
     */
    private readonly overflowRetries;
    /**
     * Whether the one-shot notice already reached this subject's current
     * generation, folded incrementally per subject. Identity is the subject, so a
     * rollover replaces the entry rather than adding one, and the Session id kept
     * beside it is what stops that replacement from being read as a hit.
     */
    private readonly noticeSeen;
    private disposed;
    constructor(host: PressurePolicyHost<SubjectId>, text?: PressureNoticeText);
    /**
     * Pre-step policy for one subject: below the handoff budget nothing happens;
     * at the handoff budget one structured notice per generation is steered into
     * the running turn; at the hard limit the request is forced through a
     * reduction first and refused when that cannot be proven.
     */
    onPreStep(subject: SubjectId, signal: AbortSignal): Promise<PressureStepDecision>;
    /**
     * Provider-overflow recovery: one bounded reduce-and-retry sequence per open
     * failure chain. Returns whether the request may retry once.
     */
    onRequestError(subject: SubjectId, failure: {
        readonly code?: string | undefined;
    }, signal: AbortSignal): Promise<boolean>;
    /** A successful assistant response ends any open overflow-recovery sequence. */
    onAssistantMessage(subject: SubjectId): void;
    dispose(): void;
    /**
     * The one-shot pressure notice is durable Session evidence, not process
     * state: a notice already surfaced as a `user/message`, or still queued in a
     * durable `agent/inbox/spliced` insert, marks the current generation as
     * already notified. A resume or restart therefore stays quiet, while a
     * rollover starts a fresh Session whose own span has no notice yet — which is
     * exactly the documented re-arm. Only the own span counts: a notice inherited
     * from the generation this one continues belongs to that generation.
     */
    private noticeDelivered;
    /**
     * Force a reduction in the subject's scope and prove it advanced the durable
     * surface or measurably reduced pressure before the request may continue.
     * Background jobs are untouched — a reduction never cancels or discards them.
     * @returns whether the request may proceed.
     */
    private enforceHardLimit;
}
