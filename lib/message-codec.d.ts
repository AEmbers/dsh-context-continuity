/**
 * The durable message codec for context continuity: handoff envelopes and
 * checkpoint continuations, written and read under the producing host's own
 * kind.
 *
 * Both messages ride ordinary `UserMessage`s under the host's plugin id with
 * the `snapshot` context form. Session format V4 admits exactly that shape and
 * refuses the retired `{ kind: 'plugin', plugin: … }` wrapper at write time.
 * Released V3 history is not rewritten on disk: the format's read-time
 * conversion renames one released `plugin` source into `plugin:<producer>`,
 * dropping the `plugin` key and keeping every payload field, so the read side
 * here recognizes both identities by exact match. Everything a host reads back
 * therefore rides named {@link ContextSnapshotSection} contributions
 * distinguished by stable section names, never bespoke source members and
 * never localized body text.
 *
 * The codec is parameterized by the host's plugin id and the two subject-facing
 * prose lines. Section names are host-independent and fixed, because they are
 * read back out of durable logs written by every generation: a host that
 * changed them could not decode its own history.
 * @module @aembers/dsh-context-continuity/message-codec
 */
import type { ContextSnapshotSection, MessageSource, UserMessage } from '@deepseek-ai/dsh-llm';
import type { RolloverTrigger } from './types.ts';
/** Handoff snapshot section name carrying the model-authored prose. */
export declare const HANDOFF_SECTION_NAME = "HANDOFF";
/** Stable section name marking a checkpoint continuation and carrying its ref. */
export declare const CHECKPOINT_SECTION_NAME = "Checkpoint";
/** Fixed text of the quiet checkpoint continuation delivered on the next turn. */
export declare const CHECKPOINT_CONTINUATION_TEXT = "A context checkpoint was recorded at the end of the previous turn. Continue the work you were doing.";
/** Envelope section names; stable, because they are read back from the log. */
export declare const HANDOFF_PREVIOUS_SESSION = "Previous session";
export declare const HANDOFF_NEW_SESSION = "New session";
export declare const HANDOFF_TRIGGER = "Trigger";
export declare const HANDOFF_EVENT_SEQ = "Handoff event seq";
export declare const HANDOFF_CHECKPOINT = "Continued from checkpoint";
export declare const HANDOFF_RELATED_FILES = "Related files";
/**
 * The source of one snapshot-form context message: the producer's own kind plus
 * the named contributions it carries.
 */
export declare function producerSnapshotSource(pluginId: string, sections: readonly ContextSnapshotSection[]): MessageSource;
/** The source of one notice-form context message: the producer's own kind plus its one-line account. */
export declare function producerNoticeSource(pluginId: string, summary: string): MessageSource;
/** The read-time conversion of one producer's released V3 rows, as format V4 renames them. */
export declare function v3RenamedSourceKind(pluginId: string): string;
/**
 * Host-specific codec configuration. `pluginId` attributes every message and
 * is matched on read, so it is durable identity a host must keep fixed across
 * its own generations. The two prose lines are the only subject-facing text;
 * everything else is host-independent.
 */
export interface MessageCodecConfig {
    readonly pluginId: string;
    /** The handoff body's opening line, naming the subject in the host's terms. */
    readonly handoffIntro: string;
    /** The verify-before-relying caution line, naming what a rollover never rolls back. */
    readonly handoffVerifyNote: string;
}
/** The rollover handoff envelope: model-authored prose plus verifiable host facts. */
export interface ContextHandoff {
    readonly previousSessionId: string;
    readonly newSessionId: string;
    readonly trigger: RolloverTrigger;
    readonly handoffEventSeq: number;
    readonly checkpointRef?: string;
    readonly relatedFiles?: readonly string[];
    readonly sections: readonly ContextSnapshotSection[];
}
interface HandoffInput {
    readonly handoff: string;
    readonly previousSessionId: string;
    readonly newSessionId: string;
    readonly trigger: RolloverTrigger;
    readonly handoffEventSeq: number;
    readonly checkpointRef?: string;
    readonly relatedFiles?: readonly {
        readonly path: string;
        readonly reason?: string;
    }[];
}
/**
 * The one place that builds and recognizes context-continuity messages. A host
 * constructs it once with its own plugin identity and prose; callers never
 * match on body text.
 */
export declare class ContextMessageCodec {
    private readonly config;
    constructor(config: MessageCodecConfig);
    /** The plugin id every message this codec writes is attributed to. */
    get pluginId(): string;
    /** Build the first model-facing context of one rollover generation. */
    createHandoffMessage(input: HandoffInput): UserMessage;
    /** Build the quiet follow-up that continues work after a checkpoint concluded its turn. */
    createCheckpointContinuationMessage(checkpointRef: string): UserMessage;
    /** This codec's own snapshot sections on one message, or undefined when another producer owns it. */
    private ownSections;
    /** The rollover handoff one message carries, when it is one. */
    handoffOf(message: UserMessage): ContextHandoff | undefined;
    /** The checkpoint ref one continuation notice carries, when the message is one. */
    continuationCheckpointRefOf(message: UserMessage): string | undefined;
    /** Whether one user message is a rollover handoff snapshot. */
    isHandoffMessage(message: UserMessage): boolean;
    /** Whether one user message is a checkpoint continuation, optionally for one checkpoint. */
    isCheckpointContinuationMessage(message: UserMessage, checkpointRef?: string): boolean;
    /**
     * Whether one message carries a handoff or checkpoint-continuation envelope.
     * Ordinary host notices share this plugin's attribution, so callers that
     * replace rederived notices must exclude these two families explicitly.
     */
    isContextSource(message: UserMessage): boolean;
    private handoffSections;
    private handoffBody;
}
export {};
