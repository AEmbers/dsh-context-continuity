/**
 * The model-facing continuity tools, as one factory: `context_rollover`,
 * `context_checkpoint`, and `context_timeline`.
 *
 * These tools are the product surface, not an accessory: a subject manages its
 * own context through them and nothing else. Two halves, split by what is
 * universal and what is domain:
 *
 * - **The engine owns the contract and the safety.** Argument shape (non-blank
 *   handoff, the byte cap, the related-file list, a supplied `checkpointRef`),
 *   the anti-forgery gate, the `concludeTurn()` timing, and the render shapes.
 *   A host customizes prose; it never customizes safety, and a fabricated
 *   `checkpointRef` is a model-visible error rather than a silent fresh
 *   rollover.
 * - **The host owns mechanism and meaning.** {@link ContinuityToolAdapter}
 *   resolves the calling execution to its subject, asks whether a ref is
 *   restorable, performs the transition, records the checkpoint, and reads the
 *   timeline. {@link ContinuityToolText} is the subject-facing vocabulary.
 *
 * The rollover and checkpoint tools are *thin*: they validate, hand the durable
 * intent to the adapter, and let the successful result be the fact. Every
 * lifecycle effect — the generation swap, the successor Session, the carried
 * input — happens after the result is durably appended, which is what makes a
 * half-done rollover recoverable from the log.
 * @module @aembers/dsh-context-continuity/tools
 */
import { type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ContextTimeline } from './timeline.ts';
/** The handoff byte budget; larger handoffs are rejected before they reach the log. */
export declare const MAX_HANDOFF_CHARS: number;
/** How many related files one handoff may name. */
export declare const MAX_RELATED_FILES = 32;
/** One related file the handoff asks the next generation to look at first. */
export interface RelatedFileRequest {
    readonly path: string;
    readonly reason: string;
}
/** The validated rollover intent the engine hands to its host. */
export interface RolloverToolRequest {
    readonly handoff: string;
    /** Present only when the model cited a restorable anchor. */
    readonly checkpointRef?: string;
    readonly relatedFiles: readonly RelatedFileRequest[];
}
/** The validated checkpoint request; `callId` is what the durable ref derives from. */
export interface CheckpointToolRequest {
    readonly name: string;
    readonly callId: string;
}
/** What the host must do for the tools, and everything the engine will not guess. */
export interface ContinuityToolAdapter {
    /**
     * Whether one `checkpointRef` is an anchor this subject actually recorded and
     * a timeline offered. The engine decides what to do with the answer — reject
     * as a model-visible error when `false` — so the anti-forgery rule holds for
     * every host. The verdict must agree with the timeline's own `restorable`
     * flag: one policy, two readers.
     */
    isRestorableRef(checkpointRef: string, exec: ToolRunContext): Promise<boolean>;
    /**
     * Hand one validated rollover intent to the subject's lifecycle. Resolving
     * means the intent is durable (the swap itself follows at the idle boundary);
     * rejecting leaves the previous generation running, and the rejection is what
     * the model sees.
     */
    requestRollover(request: RolloverToolRequest, exec: ToolRunContext): Promise<{
        readonly mode: string;
    }>;
    /** Record one checkpoint through the host's binding and running-turn fencing. */
    recordCheckpoint(request: CheckpointToolRequest, exec: ToolRunContext): Promise<{
        readonly checkpointRef: string;
        readonly name: string;
    }>;
    /** Read the subject's bounded timeline. */
    timeline(request: {
        readonly limit?: number;
    }, exec: ToolRunContext): Promise<ContextTimeline>;
}
/** Subject-facing wording a host may override; the engine's defaults are domain-neutral. */
export interface ContinuityToolText {
    /** How the subject is addressed, e.g. `Team Member`, `Individual`, `agent`. */
    readonly subjectNoun?: string;
    /** What a handoff must cover, spliced into the rollover description. */
    readonly rolloverChecklist?: string;
    /** When burying an anchor is worth it, spliced into the checkpoint description. */
    readonly checkpointGuidance?: string;
    /**
     * What a rollover carries forward automatically, so the handoff need not
     * repeat it. The engine's default states the one universal truth — the
     * subject stays the same identity across the switch — and a host names its
     * own durable channels (a persistent memory file, a domain ledger, an
     * injected role) so the model writes only the irreducible delta instead of
     * re-deriving what a fresh generation already receives on its own.
     */
    readonly carriedContext?: string;
    /**
     * Domain guidance spliced into the timeline description: what a host's
     * boundaries mean and how its rows read. The engine keeps the structural
     * contract and the anti-forgery/return rules; this only adds the host's own
     * glossary. Empty by default.
     */
    readonly timelineGuidance?: string;
    /** How one attributable subject of a boundary is named, e.g. `topic`, `Thread`. */
    readonly topicNoun?: string;
    /** The plural of {@link ContinuityToolText.topicNoun}, e.g. `topics`, `Threads`. */
    readonly topicNounPlural?: string;
}
/** The three tools, ready to register. */
export interface ContinuityTools {
    readonly rollover: ToolDefinition;
    readonly checkpoint: ToolDefinition;
    readonly timeline: ToolDefinition;
}
/**
 * Build the three continuity tools for one host.
 *
 * The adapter is the host's half: it resolves the calling execution to its
 * subject and performs the effects. `text` only replaces subject-facing
 * wording — the safety-bearing sentences stay in the engine.
 */
export declare function createContinuityTools(adapter: ContinuityToolAdapter, text?: ContinuityToolText): ContinuityTools;
