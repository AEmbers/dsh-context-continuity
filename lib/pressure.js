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
 * @module @sophialin/dsh-context-continuity/pressure
 */
import { CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage } from '@deepseek-ai/dsh-llm';
import { producerNoticeSource, v3RenamedSourceKind } from "./message-codec.js";
import { CONTEXT_ROLLOVER_TOOL_NAME } from "./projection.js";
/**
 * The `source.summary` of the one-shot pressure notice. Frozen: notices already
 * written into live Session logs must keep decoding as this policy's own.
 */
export const PRESSURE_NOTICE_SUMMARY = 'Context pressure: prepare a handoff';
const DEFAULT_TEXT = {
    inHandLabel: 'Work in hand',
    jobsLabel: 'Background jobs',
    rolloverToolName: CONTEXT_ROLLOVER_TOOL_NAME,
};
const CONTINUE = Object.freeze({ kind: 'continue' });
const NOTICE = Object.freeze({ kind: 'notice' });
const REJECT = Object.freeze({ kind: 'reject' });
/** One error as a readable sentence: the message when there is one, the value otherwise. */
function describeFailure(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * The notice one subject near its handoff budget receives: the measured numbers,
 * what it is holding, and the default action. Deliberately short — it competes
 * with the work for the very context it is warning about.
 */
export function contextPressureNoticeText(input, text = {}) {
    const wording = {
        inHandLabel: text.inHandLabel ?? DEFAULT_TEXT.inHandLabel,
        jobsLabel: text.jobsLabel ?? DEFAULT_TEXT.jobsLabel,
        rolloverToolName: text.rolloverToolName ?? DEFAULT_TEXT.rolloverToolName,
    };
    const inHand = input.inHand.length === 0 ? 'none' : input.inHand.join(', ');
    const jobs = input.jobs.length === 0 ? 'none' : `${input.jobs.length} running (collect or stop them before switching)`;
    return [
        `Context pressure: ${input.usageTokens} tokens measured; the handoff budget is ${input.handoffAt} and the hard limit is ${input.hardLimit}.`,
        `${wording.inHandLabel}: ${inHand}. ${wording.jobsLabel}: ${jobs}.`,
        `Finish the current atomic action, then call ${wording.rolloverToolName} with a handoff covering your objective, the action in flight, and external side effects and their verification state — write only what a fresh generation could not reconstruct on its own, and a fresh context is the default path. Record anything durable in your private memory/notes first.`,
    ].join(' ');
}
/**
 * Whether one message is this policy's own one-shot notice. It is attributed
 * under the host's own producer kind, and the format's read-time conversion of
 * this producer's released V3 rows renames that kind to `plugin:<id>`; both
 * identities are this policy's own, matched by exact equality — a `plugin:`
 * prefix test would claim another producer's notices as its own evidence.
 */
function isPressureNotice(pluginId, message) {
    const source = message?.source;
    if (source?.summary !== PRESSURE_NOTICE_SUMMARY)
        return false;
    return source.kind === pluginId || source.kind === v3RenamedSourceKind(pluginId);
}
/** Whether one own-span event already carries the notice: surfaced, or queued in a durable splice. */
function noticeInEvent(pluginId, event) {
    if (event.type === 'user/message')
        return isPressureNotice(pluginId, event.data);
    if (event.type === 'agent/inbox/spliced')
        return event.data.inserted.some(message => isPressureNotice(pluginId, message));
    return false;
}
/** Whether a reduction is proven: the durable surface advanced, or pressure measurably fell. */
function reductionProven(before, after) {
    if (after.generation > before.generation)
        return true;
    return before.tokens !== undefined && after.tokens !== undefined && after.tokens < before.tokens;
}
/** Whether the durable surface itself advanced, which is what makes a retry more than a repeat. */
function surfaceAdvanced(before, after) {
    return after.generation > before.generation;
}
/** Whether the event a latch stopped on still occupies that position with the type it had. */
function anchorHolds(anchor, event) {
    return anchor !== undefined && event !== undefined && Number(event.seq) === anchor.seq && event.type === anchor.type;
}
/**
 * The one context-pressure policy of one host. It reads budgets and surfaces
 * through the host, steers the notice through the host, and owns the decision
 * order, the once-per-generation latch, and the fail-closed reduction proof.
 */
export class ContextPressurePolicy {
    host;
    text;
    /**
     * Retry budget per subject for the current provider-overflow sequence.
     * Process-only by design: a restart re-earns one sequence per chain.
     */
    overflowRetries = new Map();
    /**
     * Whether the one-shot notice already reached this subject's current
     * generation, folded incrementally per subject. Identity is the subject, so a
     * rollover replaces the entry rather than adding one, and the Session id kept
     * beside it is what stops that replacement from being read as a hit.
     */
    noticeSeen = new Map();
    disposed = false;
    constructor(host, text = {}) {
        this.host = host;
        this.text = text;
    }
    /**
     * Pre-step policy for one subject: below the handoff budget nothing happens;
     * at the handoff budget one structured notice per generation is steered into
     * the running turn; at the hard limit the request is forced through a
     * reduction first and refused when that cannot be proven.
     */
    async onPreStep(subject, signal) {
        if (this.disposed || signal.aborted)
            return CONTINUE;
        const limits = await this.host.limitsFor(subject);
        if (limits === undefined) {
            // A missing route capacity must be explicit, never an accidental
            // unlimited policy: refuse the step with a recoverable diagnostic.
            this.host.failedFor(subject, 'context pressure policy: the routed model capacity is unknown; refusing to forward a request without a bounded context budget');
            return REJECT;
        }
        const { usageTokens, hardLimit, handoffAt } = limits;
        if (usageTokens >= hardLimit)
            return (await this.enforceHardLimit(subject, signal)) ? CONTINUE : REJECT;
        if (usageTokens >= handoffAt && !this.noticeDelivered(subject)) {
            const inHand = this.host.inHandFor(subject);
            const notice = createUserMessage({
                content: [{
                        type: 'text',
                        text: contextPressureNoticeText({
                            usageTokens,
                            handoffAt,
                            hardLimit,
                            inHand: inHand.inHand,
                            jobs: inHand.jobs,
                        }, this.text),
                    }],
                source: producerNoticeSource(this.host.pluginId, PRESSURE_NOTICE_SUMMARY),
            });
            try {
                this.host.steer(subject, notice);
            }
            catch (error) {
                this.host.log(`context pressure notice failed: ${describeFailure(error)}`, subject);
            }
            return NOTICE;
        }
        return CONTINUE;
    }
    /**
     * Provider-overflow recovery: one bounded reduce-and-retry sequence per open
     * failure chain. Returns whether the request may retry once.
     */
    async onRequestError(subject, failure, signal) {
        if (this.disposed || signal.aborted)
            return false;
        if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE)
            return false;
        const retries = this.overflowRetries.get(subject) ?? 0;
        if (retries >= 1)
            return false;
        const compaction = this.host.compactionFor(subject);
        if (compaction === undefined)
            return false;
        const before = this.host.surfaceFor(subject);
        try {
            await compaction.reduce('context-overflow', signal);
        }
        catch (error) {
            // Durable reduction progress before a later failure justifies the single
            // retry; cancellation never does.
            if (!signal.aborted && surfaceAdvanced(before, this.host.surfaceFor(subject))) {
                this.overflowRetries.set(subject, retries + 1);
                return true;
            }
            this.host.log(`context-overflow recovery failed: ${describeFailure(error)}`, subject);
            return false;
        }
        // Only a changed durable surface makes a retry more than a repeat: the
        // provider rejected the request as it stood, so re-sending it unchanged
        // would overflow again.
        if (signal.aborted || !surfaceAdvanced(before, this.host.surfaceFor(subject)))
            return false;
        this.overflowRetries.set(subject, retries + 1);
        return true;
    }
    /** A successful assistant response ends any open overflow-recovery sequence. */
    onAssistantMessage(subject) {
        this.overflowRetries.delete(subject);
    }
    dispose() {
        this.disposed = true;
        this.overflowRetries.clear();
        this.noticeSeen.clear();
    }
    /**
     * The one-shot pressure notice is durable Session evidence, not process
     * state: a notice already surfaced as a `user/message`, or still queued in a
     * durable `agent/inbox/spliced` insert, marks the current generation as
     * already notified. A resume or restart therefore stays quiet, while a
     * rollover starts a fresh Session whose own span has no notice yet — which is
     * exactly the documented re-arm. Only the own span counts: a notice inherited
     * from the generation this one continues belongs to that generation.
     */
    noticeDelivered(subject) {
        const span = this.host.logSpanFor(subject);
        const own = span.events.filter(event => Number(event.seq) >= span.inheritedEventCount);
        const previous = this.noticeSeen.get(subject);
        // Resume only for the same Session's span, while it still covers what was
        // folded and the event it stopped on is still there; every other case —
        // a rollover, a shorter log, a rebuilt one — re-folds cold, which is how a
        // rollover re-arms and how a lost notice is re-delivered.
        const resumable = previous !== undefined
            && previous.sessionId === span.sessionId
            && previous.foldedThrough <= own.length
            && (previous.foldedThrough === 0 || anchorHolds(previous.anchor, own[previous.foldedThrough - 1]));
        if (resumable && previous.delivered)
            return true;
        let delivered = resumable ? previous.delivered : false;
        if (!resumable || previous.foldedThrough < own.length) {
            for (let index = resumable ? previous.foldedThrough : 0; index < own.length; index += 1) {
                if (noticeInEvent(this.host.pluginId, own[index]))
                    delivered = true;
            }
        }
        const last = own[own.length - 1];
        this.noticeSeen.set(subject, {
            sessionId: span.sessionId,
            foldedThrough: own.length,
            anchor: last === undefined ? undefined : { seq: Number(last.seq), type: last.type },
            delivered,
        });
        return delivered;
    }
    /**
     * Force a reduction in the subject's scope and prove it advanced the durable
     * surface or measurably reduced pressure before the request may continue.
     * Background jobs are untouched — a reduction never cancels or discards them.
     * @returns whether the request may proceed.
     */
    async enforceHardLimit(subject, signal) {
        const compaction = this.host.compactionFor(subject);
        if (compaction === undefined) {
            this.host.failedFor(subject, 'context hard limit reached and compaction is unavailable in this scope; the request was blocked');
            return false;
        }
        const before = this.host.surfaceFor(subject);
        let result;
        try {
            result = await compaction.reduce('context-overflow', signal);
        }
        catch (error) {
            this.host.failedFor(subject, `context hard limit compaction failed: ${describeFailure(error)}; the request was blocked`);
            return false;
        }
        if (signal.aborted)
            return false;
        if (!reductionProven(before, this.host.surfaceFor(subject))) {
            // No-op or unchanged surface: fail closed rather than knowingly submit
            // over the subject's limit.
            this.host.failedFor(subject, result === null
                ? 'context hard limit reached and no compactable range exists; the request was blocked'
                : 'context hard limit compaction produced no measurable reduction; the request was blocked');
            return false;
        }
        return true;
    }
}
