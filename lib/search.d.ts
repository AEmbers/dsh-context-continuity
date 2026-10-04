/**
 * Search and read across everything a subject is authorized to remember.
 *
 * The engine owns the ladder — a bounded ranked search, then one expanded
 * neighbourhood — and every rule that makes its answers trustworthy: the
 * authorized set is host-derived and the model can only *select* inside it, a
 * hit is folded to the generation that actually recorded it, the same inherited
 * experience is never presented twice, and a return anchor is offered only from
 * the shared policy in {@link anchor.ts}. The host owns mechanism and domain:
 * which Sessions a subject may reach ({@link SearchScopeProvider}), the query
 * capability (`ctx.sessionQuery` in a Team or Harness host), the fold
 * configuration, and the token meter.
 *
 * Two absences are deliberate. There is no second index and no engine-side
 * cache of history: every answer is read from the host's own corpus. And there
 * is no cursor, page size, session id, or event-type knob on the model surface
 * — a capped answer says so and asks for a narrower query, because paging a
 * model through raw rows is the failure mode this ladder exists to avoid.
 * @module @sophialin/dsh-context-continuity/search
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionEventResultFilter, SessionEventSearchDocument, SessionEventSearchPage, SessionEventSearchRequest, SessionEventSurface, SessionLogSnapshot, SessionSearchExecContext, SessionSearchHit, SessionSearchPage, SessionSearchRequest } from '@deepseek-ai/dsh-session-query';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { type ContextProjectionConfig } from './projection.ts';
import { type ContextTimelineSource } from './timeline.ts';
/** How many canonical hits one search presents. */
export declare const CONTEXT_SEARCH_RESULT_LIMIT = 8;
/** How many preceding events one context read expands around its target. */
export declare const CONTEXT_READ_BEFORE = 4;
/** How many following events one context read expands around its target. */
export declare const CONTEXT_READ_AFTER = 6;
/** The render budget for one expanded event: a longer one is excerpted and says so. */
export declare const CONTEXT_READ_EVENT_CHARS = 1200;
/**
 * The query capability the engine uses, and nothing more of it: the Harness
 * session-query service satisfies this structurally, so a host passes
 * `ctx.sessionQuery` unchanged. Only the four reads the ladder needs are named.
 */
export interface ContextSearchPort {
    /** Cross-Session full-text search, one ranked strongest match per Session. */
    searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>;
    /** Within-Session full-text search: several ranked matches from one generation. */
    searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>;
    /** Every event of one Session in one seq range, with its semantic text and folded surface. */
    filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]>;
    /** One complete logical Session log plus the identity the fold keys on. */
    readSession(sessionId: SessionId): Promise<SessionLogSnapshot>;
}
/** One named scope a host offers: the model may select it, never define it. */
export interface SearchScopeOption {
    readonly scopeId: string;
    readonly label: string;
}
/**
 * Which Sessions a subject may search, answered by the host from subject
 * identity alone. The engine knows no workspace, team, or project: a named
 * scope is opaque here, and a model-supplied `scopeId` can only select among
 * what this provider already offered.
 */
export interface SearchScopeProvider<SubjectId> {
    /** The default range: every Session the subject itself ever lived in. */
    ownedSessions(subject: SubjectId): readonly SessionId[] | Promise<readonly SessionId[]>;
    /** The named scopes the subject may search, or absent when the host has none. */
    availableScopes?(subject: SubjectId): readonly SearchScopeOption[] | Promise<readonly SearchScopeOption[]>;
    /** Resolve a scope the model selected into the Sessions it authorizes. */
    sessionsInScope?(subject: SubjectId, scopeId: string): readonly SessionId[] | Promise<readonly SessionId[]>;
}
/** The scope a search actually ran against, as reported back to the model. */
export type ContextSearchScope = {
    readonly kind: 'owned';
} | {
    readonly kind: 'named';
    readonly scopeId: string;
    readonly label: string;
};
/**
 * Everything the search tools need from a host. Every member is per-exec: one
 * factory serves every subject a host runs, so identity, the current
 * generation, the meter, and the budget are resolved at call time.
 */
export interface ContextSearchAdapter<SubjectId> {
    /** The subject whose authorized history is searched. */
    subject(exec: ToolRunContext): SubjectId | Promise<SubjectId>;
    /** The generation the subject lives in now: where the active lineage starts. */
    activeSessionId(exec: ToolRunContext): SessionId | Promise<SessionId>;
    /** Which Sessions that subject may ever search. */
    scope: SearchScopeProvider<SubjectId>;
    /** The query capability, e.g. the host's `ctx.sessionQuery`. */
    query: ContextSearchPort;
    /** The fold configuration shared with the registered projection unit. */
    config: ContextProjectionConfig;
    /** One source's replayed measurement; absent means no meter exists. */
    measureSource?(source: ContextTimelineSource, exec: ToolRunContext): number | undefined | Promise<number | undefined>;
    /** The retained-context budget above which a return anchor stops being worth selecting. */
    handoffAt(exec: ToolRunContext): number | Promise<number>;
    /** How many archived ancestors the active-lineage walk follows. */
    maxAncestors?: number;
}
/** One bounded search over the subject's authorized history. */
export interface ContextSearchRequest {
    readonly exec: ToolRunContext;
    /** Full-text query; the provider interprets it as data, never as FTS syntax. */
    readonly query: string;
    /** Search only this generation deeply, instead of every authorized generation. */
    readonly within?: SessionId;
    /** Inclusive lower time bound, in epoch milliseconds. */
    readonly after?: number;
    /** Inclusive upper time bound, in epoch milliseconds. */
    readonly before?: number;
    /** A named scope the host offered, or absent for the subject's own history. */
    readonly scope?: string;
}
/** Where a remembered event's generation sits relative to the active lineage. */
export type ContextHitGeneration = 'current' | 'prior' | 'archived';
/**
 * The return anchor one hit carries: a ref `context_rollover` may accept, or
 * the reason no prefix of that history would contain the hit. An unavailable
 * anchor is never a synthesized ref.
 */
export type ContextHitAnchor = {
    readonly available: true;
    readonly ref: string;
    readonly label: string;
} | {
    readonly available: false;
    readonly reason: string;
};
/** One remembered event, canonicalized to the generation that recorded it. */
export interface ContextSearchHit {
    /** Opaque ref for `context_read`; it carries no authority of its own. */
    readonly contextRef: string;
    readonly generation: ContextHitGeneration;
    /** The Session that actually recorded the event, not a generation inheriting it. */
    readonly sessionId: SessionId;
    readonly seq: number;
    readonly eventType: string;
    /** ISO 8601 UTC. */
    readonly time: string;
    /** The provider's own surface verdict for the matched event. */
    readonly surface: SessionEventSurface;
    /** The provider's bounded excerpt around the match. */
    readonly snippet: string;
    readonly anchor: ContextHitAnchor;
}
/** What one search did not present, and why — never a silent omission. */
export interface ContextSearchDrops {
    /** Hits folded into an entry already presented: the same experience, once. */
    readonly duplicate: number;
    /** Hits whose generation or own span could not be resolved and read. */
    readonly incomplete: number;
    /** Hits the provider returned outside the authorized set; never presented. */
    readonly outOfScope: number;
}
/** One bounded, deduplicated search answer. */
export interface ContextSearchResult {
    readonly query: string;
    readonly scope: ContextSearchScope;
    /** Every named scope the host offers this subject, so a search need not guess. */
    readonly availableScopes: readonly SearchScopeOption[];
    readonly hits: readonly ContextSearchHit[];
    readonly dropped: ContextSearchDrops;
    /** Whether the provider holds more matching generations than this answer presents. */
    readonly capped: boolean;
    /** Set when the active lineage could not be walked past one generation. */
    readonly lineageIncompleteAt?: {
        readonly sessionId: SessionId;
        readonly reason: string;
    };
}
/** One expanded event of a neighbourhood. */
export interface ContextReadEvent {
    readonly seq: number;
    readonly type: string;
    readonly time: string;
    readonly surface: SessionEventSurface;
    /** Whether this is the event the ref named. */
    readonly target: boolean;
    readonly text: string;
    /** Whether the text was excerpted at the engine's own render budget. */
    readonly truncated: boolean;
}
/** One remembered event expanded into its bounded neighbourhood. */
export interface ContextReadResult {
    readonly sessionId: SessionId;
    readonly seq: number;
    readonly generation: ContextHitGeneration;
    readonly eventType: string;
    readonly time: string;
    readonly surface: SessionEventSurface;
    readonly events: readonly ContextReadEvent[];
    readonly anchor: ContextHitAnchor;
}
/** Read one remembered event and its bounded neighbourhood. */
export interface ContextReadRequest {
    readonly exec: ToolRunContext;
    /** The Session named by a decoded `contextRef`. */
    readonly sessionId: SessionId;
    readonly seq: number;
}
/**
 * Search one subject's authorized history: ranked, canonicalized, deduplicated,
 * bounded, and enriched with a return anchor only where the shared policy
 * proves one.
 */
export declare function searchContext<SubjectId>(adapter: ContextSearchAdapter<SubjectId>, request: ContextSearchRequest): Promise<ContextSearchResult>;
/**
 * Expand one remembered event into its bounded neighbourhood. The ref is
 * revalidated against the host's authorization on every call, the target is
 * always present, and the window is the engine's own budget — the model never
 * guesses raw event counts.
 */
export declare function readContextHit<SubjectId>(adapter: ContextSearchAdapter<SubjectId>, request: ContextReadRequest): Promise<ContextReadResult>;
