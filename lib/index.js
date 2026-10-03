/**
 * Context continuity: a subject's context lived as one continuous timeline
 * across many physical Session generations.
 *
 * A subject rolls forward into a fresh generation (`context_rollover`), returns
 * to a recorded anchor (`context_checkpoint` + rollover), walks its own lineage
 * as one timeline (`context_timeline`), recalls what it has forgotten
 * (`context_search` + `context_read`), and is told to prepare a handoff before
 * its context runs out (the context-pressure policy) — physically many Session
 * files, one continuous context in the subject's understanding. The engine owns
 * these mechanics generically; a host binds them to its own subject and domain
 * through {@link ContextContinuityHost} and {@link ContextSearchAdapter}.
 * @module @aembers/dsh-context-continuity
 */
export { continuationDelivered } from "./projection-state.js";
export { isDroppedNotice } from "./host.js";
export { CONTEXT_CONTINUITY_PROJECTION_KEY, CONTEXT_CHECKPOINT_TOOL_NAME, CONTEXT_ROLLOVER_TOOL_NAME, contextProjectionStateSchema, emptyContextProjectionState, foldContextProjection, createContextProjectionDefinition, } from "./projection.js";
export { ContextContinuityCoordinator } from "./coordinator.js";
export { DEFAULT_TIMELINE_ANCESTORS, DEFAULT_TIMELINE_LIMIT, readContextTimeline, } from "./timeline.js";
export { MAX_HANDOFF_CHARS, MAX_RELATED_FILES, createContinuityTools, } from "./tools.js";
export { CONTEXT_SEARCH_RESULT_LIMIT, CONTEXT_READ_BEFORE, CONTEXT_READ_AFTER, CONTEXT_READ_EVENT_CHARS, readContextHit, searchContext, } from "./search.js";
export { CONTEXT_REF_PREFIX, contextRefFor, parseContextRef } from "./context-ref.js";
export { createSearchTools } from "./search-tools.js";
export { ContextMessageCodec, HANDOFF_SECTION_NAME, CHECKPOINT_SECTION_NAME, CHECKPOINT_CONTINUATION_TEXT, HANDOFF_PREVIOUS_SESSION, HANDOFF_NEW_SESSION, HANDOFF_TRIGGER, HANDOFF_EVENT_SEQ, HANDOFF_CHECKPOINT, HANDOFF_RELATED_FILES, } from "./message-codec.js";
export { StoredSessionReader, StoredSessionReadError, classifyStoredSessionFailure, sessionFailureOf, } from "./stored-session-reader.js";
export { PRESSURE_NOTICE_SUMMARY, ContextPressurePolicy, contextPressureNoticeText, } from "./pressure.js";
