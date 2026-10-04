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
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { anchorCandidates, anchorRejection, retainedEstimate } from "./anchor.js";
import { contextRefFor } from "./context-ref.js";
import { foldContextProjection } from "./projection.js";
import { DEFAULT_TIMELINE_ANCESTORS } from "./timeline.js";
/** How many canonical hits one search presents. */
export const CONTEXT_SEARCH_RESULT_LIMIT = 8;
/** How many preceding events one context read expands around its target. */
export const CONTEXT_READ_BEFORE = 4;
/** How many following events one context read expands around its target. */
export const CONTEXT_READ_AFTER = 6;
/** The render budget for one expanded event: a longer one is excerpted and says so. */
export const CONTEXT_READ_EVENT_CHARS = 1200;
/** One message a model may read: never a stack, never an unbounded provider dump. */
function describeFailure(error) {
    const message = (error instanceof Error ? error.message : String(error)).trim();
    if (message === '')
        return 'no reason given';
    return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
function sessionAccess(adapter, exec) {
    const reads = new Map();
    const usage = new Map();
    return {
        source(sessionId) {
            const cached = reads.get(String(sessionId));
            if (cached !== undefined)
                return cached;
            const pending = (async () => {
                try {
                    const snapshot = await adapter.query.readSession(sessionId);
                    const source = {
                        sessionId,
                        header: snapshot.session,
                        inheritedEventCount: snapshot.inheritedEventCount,
                        events: snapshot.events,
                    };
                    return {
                        ok: true,
                        value: {
                            source,
                            state: foldContextProjection(source.events, adapter.config, {
                                sessionId,
                                inheritedEventCount: Number(source.inheritedEventCount),
                            }),
                        },
                    };
                }
                catch (error) {
                    return { ok: false, reason: describeFailure(error) };
                }
            })();
            reads.set(String(sessionId), pending);
            return pending;
        },
        usage(source) {
            const cached = usage.get(String(source.sessionId));
            if (cached !== undefined)
                return cached;
            const pending = (async () => {
                if (adapter.measureSource === undefined)
                    return undefined;
                try {
                    const measured = await adapter.measureSource(source, exec);
                    return typeof measured === 'number' && Number.isFinite(measured) ? measured : undefined;
                }
                catch {
                    // An unmeasured source is not a free one: the anchor policy refuses it.
                    return undefined;
                }
            })();
            usage.set(String(source.sessionId), pending);
            return pending;
        },
    };
}
/**
 * Walk from the current generation through `parentSession`, bounded. A
 * generation that cannot be read ends the walk loudly: everything beyond it is
 * unknown, and an unknown generation must never be offered as a return target.
 */
async function activeLineage(adapter, access, exec, maxAncestors) {
    const activeSessionId = await adapter.activeSessionId(exec);
    const depth = new Map();
    let id = activeSessionId;
    for (let walked = 0; id !== undefined && walked <= maxAncestors; walked += 1) {
        depth.set(String(id), walked);
        const read = await access.source(id);
        if (!read.ok)
            return { activeSessionId, depth, incompleteAt: { sessionId: id, reason: read.reason } };
        id = read.value.source.header.parentSession;
    }
    return { activeSessionId, depth };
}
/** Which generation one canonical source is, seen from the active lineage. */
function generationOf(sessionId, lineage) {
    if (String(sessionId) === String(lineage.activeSessionId))
        return 'current';
    return lineage.depth.has(String(sessionId)) ? 'prior' : 'archived';
}
/**
 * Fold one provider hit to the generation that recorded it. A seeded generation
 * inherits its source's events at the same seqs, so an inherited hit is
 * canonicalized by following `parentSession` while the seq stays below that
 * generation's own start; deduplicating on the canonical source is what makes
 * one experience appear once across a lineage.
 */
async function canonicalSource(access, sessionId, seq, maxAncestors) {
    const first = await access.source(sessionId);
    if (!first.ok)
        return { ok: false, reason: first.reason };
    const ownSpanFrom = Number(first.value.source.inheritedEventCount);
    let id = sessionId;
    let at = seq;
    for (let depth = 0; depth <= maxAncestors; depth += 1) {
        const read = depth === 0 ? first : await access.source(id);
        if (!read.ok)
            return { ok: false, reason: read.reason };
        if (at >= Number(read.value.source.inheritedEventCount)) {
            return {
                ok: true,
                sessionId: id,
                seq: at,
                ownSpanFrom,
                ...(String(id) === String(sessionId) ? {} : { foldedFrom: sessionId }),
            };
        }
        const parent = read.value.source.header.parentSession;
        // An inherited prefix with no parent to attribute it to is the log's own
        // claim about its history; take the claim at face value rather than guess.
        if (parent === undefined) {
            return {
                ok: true,
                sessionId: id,
                seq: at,
                ownSpanFrom,
                ...(String(id) === String(sessionId) ? {} : { foldedFrom: sessionId }),
            };
        }
        id = parent;
    }
    return {
        ok: true,
        sessionId: id,
        seq: at,
        ownSpanFrom,
        ...(String(id) === String(sessionId) ? {} : { foldedFrom: sessionId }),
    };
}
/** The event predicates one search's time window compiles to. */
function timeFilters(after, before) {
    if (after === undefined && before === undefined)
        return [];
    return [{ kind: 'time', ...(after === undefined ? {} : { from: after }), ...(before === undefined ? {} : { to: before }) }];
}
/**
 * The authorized set of one search, or a refusal: an empty set never means "all
 * of them". A blank id is dropped rather than searched for.
 */
function authorizedIds(ids, what) {
    const unique = [];
    const seen = new Set();
    for (const id of ids) {
        const key = String(id);
        if (key === '' || seen.has(key))
            continue;
        seen.add(key);
        unique.push(id);
    }
    if (unique.length === 0) {
        throw new Error(`context search has no authorized Session for ${what}; authorization comes from the host, and an empty set fails closed instead of searching everything`);
    }
    return unique;
}
async function resolveScope(adapter, subject, scopeId) {
    const availableScopes = adapter.scope.availableScopes === undefined ? [] : await adapter.scope.availableScopes(subject);
    if (scopeId === undefined) {
        const owned = authorizedIds(await adapter.scope.ownedSessions(subject), 'the subject\'s own history');
        return { ids: owned, idSet: new Set(owned.map(String)), scope: { kind: 'owned' }, availableScopes };
    }
    const offered = availableScopes.find(option => option.scopeId === scopeId);
    if (offered === undefined) {
        const listing = availableScopes.length === 0
            ? 'no named scope is offered for this subject'
            : `offered scopes: ${availableScopes.map(option => `${option.label} (${option.scopeId})`).join(', ')}`;
        throw new Error(`context_search scope ${scopeId} is not a scope this subject may search; ${listing}`);
    }
    if (adapter.scope.sessionsInScope === undefined) {
        throw new Error(`context_search scope ${scopeId} is offered but cannot be resolved: the host offers named scopes without implementing sessionsInScope`);
    }
    const ids = authorizedIds(await adapter.scope.sessionsInScope(subject, scopeId), `scope ${scopeId}`);
    return {
        ids,
        idSet: new Set(ids.map(String)),
        scope: { kind: 'named', scopeId, label: offered.label },
        availableScopes,
    };
}
/**
 * Everything the host authorizes this subject to read: its own history plus
 * every offered scope. A read takes no scope parameter, so it has to accept a
 * ref that a scoped search legitimately returned; the union is still entirely
 * host-derived, and the model can neither name it nor widen it.
 */
async function readAuthorizedSessions(adapter, subject) {
    const ids = [...await adapter.scope.ownedSessions(subject)];
    if (adapter.scope.availableScopes !== undefined && adapter.scope.sessionsInScope !== undefined) {
        for (const option of await adapter.scope.availableScopes(subject)) {
            ids.push(...await adapter.scope.sessionsInScope(subject, option.scopeId));
        }
    }
    const set = new Set(ids.map(String));
    set.delete('');
    if (set.size === 0) {
        throw new Error('context read has no authorized Session for this subject; authorization comes from the host, and an empty set fails closed');
    }
    return set;
}
/**
 * The nearest return anchor for one remembered event, or why there is none.
 * Only a generation on the active lineage can be entered again, and only from
 * an anchor whose completed turn actually contains the hit — otherwise the seed
 * would not include the experience the model asked to return to.
 */
async function returnAnchorFor(adapter, access, generation, sessionId, seq, handoffAt) {
    if (generation === 'archived') {
        return {
            available: false,
            reason: 'the generation holding this hit is not on the active lineage; an abandoned branch is searchable but is not a return target',
        };
    }
    const read = await access.source(sessionId);
    if (!read.ok)
        return { available: false, reason: `the source Session could not be read (${read.reason})` };
    const after = anchorCandidates(read.value.state, adapter.config.host, false)
        .filter(candidate => candidate.turnEndSeq >= seq)
        .sort((a, b) => a.turnEndSeq - b.turnEndSeq || a.seq - b.seq);
    if (after.length === 0) {
        return { available: false, reason: 'no anchor on that generation ends at or after the hit, so no return prefix would contain it' };
    }
    const sourceUsage = await access.usage(read.value.source);
    let nearestRejection;
    for (const candidate of after) {
        const retained = retainedEstimate(sourceUsage ?? 0, read.value.source.events.length, candidate.turnEndSeq);
        const rejection = anchorRejection(candidate, retained, sourceUsage, handoffAt);
        if (rejection === undefined)
            return { available: true, ref: candidate.ref, label: candidate.label };
        nearestRejection ??= rejection;
    }
    return { available: false, reason: nearestRejection ?? 'no restorable anchor exists after this hit' };
}
/**
 * Search one subject's authorized history: ranked, canonicalized, deduplicated,
 * bounded, and enriched with a return anchor only where the shared policy
 * proves one.
 */
export async function searchContext(adapter, request) {
    const exec = request.exec;
    const subject = await adapter.subject(exec);
    const resolved = await resolveScope(adapter, subject, request.scope);
    const access = sessionAccess(adapter, exec);
    const maxAncestors = Math.max(0, Math.trunc(adapter.maxAncestors ?? DEFAULT_TIMELINE_ANCESTORS));
    const handoffAt = await adapter.handoffAt(exec);
    // The lineage is walked only once a hit has survived scope and provenance: an
    // answer with nothing to label or enrich must not pay for the walk.
    let walked;
    const lineage = () => walked ??= activeLineage(adapter, access, exec, maxAncestors);
    const eventFilters = timeFilters(request.after, request.before);
    const hits = [];
    const seen = new Set();
    const dropped = { duplicate: 0, incomplete: 0, outOfScope: 0 };
    let capped = false;
    /** Canonicalize one provider hit and keep it when it is an experience not yet shown. */
    async function admit(raw) {
        if (!resolved.idSet.has(String(raw.sessionId))) {
            dropped.outOfScope += 1;
            return { ok: false, reason: 'the hit is outside the authorized set' };
        }
        const canonical = await canonicalSource(access, raw.sessionId, raw.seq, maxAncestors);
        if (!canonical.ok) {
            dropped.incomplete += 1;
            return canonical;
        }
        const key = `${String(canonical.sessionId)}:${canonical.seq}`;
        if (seen.has(key)) {
            dropped.duplicate += 1;
            return canonical;
        }
        seen.add(key);
        const generation = generationOf(canonical.sessionId, await lineage());
        hits.push({
            contextRef: contextRefFor(canonical.sessionId, SessionSeq(canonical.seq)),
            generation,
            sessionId: canonical.sessionId,
            seq: canonical.seq,
            eventType: String(raw.type),
            time: new Date(raw.time).toISOString(),
            surface: raw.surface,
            snippet: raw.snippet,
            anchor: await returnAnchorFor(adapter, access, generation, canonical.sessionId, canonical.seq, handoffAt),
        });
        return canonical;
    }
    const within = request.within;
    if (within !== undefined) {
        if (!resolved.idSet.has(String(within))) {
            throw new Error(`context_search within ${within} names a Session outside the authorized history being searched; copy a contextRef from a hit in the scope you are searching`);
        }
        const read = await access.source(within);
        if (!read.ok)
            throw new Error(`context_search within ${within} could not be read: ${read.reason}`);
        // Deep-searching one generation means its own span: its inherited prefix is
        // another generation's history, already covered by the broad search and
        // attributed there by provenance folding.
        const page = await providerCall(() => adapter.query.searchEvents({
            sessionId: within,
            query: request.query,
            filters: [
                { kind: 'seq', from: Number(read.value.source.inheritedEventCount) },
                ...eventFilters,
            ],
            limit: CONTEXT_SEARCH_RESULT_LIMIT,
        }, { signal: exec.signal }));
        capped = page.nextCursor !== undefined;
        for (const hit of page.items) {
            if (hits.length >= CONTEXT_SEARCH_RESULT_LIMIT) {
                capped = true;
                break;
            }
            await admit(hit);
        }
    }
    else {
        const page = await providerCall(() => adapter.query.searchSessions({
            query: request.query,
            sessionFilters: [{ kind: 'id', values: resolved.ids }],
            ...(eventFilters.length === 0 ? {} : { eventFilters }),
            limit: CONTEXT_SEARCH_RESULT_LIMIT,
        }, { signal: exec.signal }));
        capped = page.nextCursor !== undefined;
        for (const item of page.items) {
            if (hits.length >= CONTEXT_SEARCH_RESULT_LIMIT) {
                capped = true;
                break;
            }
            const canonical = await admit(item.bestMatch);
            // A generation whose strongest match is inherited still gets its own later
            // experience represented, rather than being swallowed by its ancestor's.
            if (canonical.ok && canonical.foldedFrom !== undefined && hits.length < CONTEXT_SEARCH_RESULT_LIMIT) {
                try {
                    const own = await adapter.query.searchEvents({
                        sessionId: canonical.foldedFrom,
                        query: request.query,
                        filters: [
                            { kind: 'seq', from: canonical.ownSpanFrom },
                            ...eventFilters,
                        ],
                        limit: 1,
                    }, { signal: exec.signal });
                    for (const hit of own.items)
                        await admit(hit);
                }
                catch {
                    dropped.incomplete += 1;
                }
            }
        }
    }
    const resolvedLineage = walked === undefined ? undefined : await walked;
    return {
        query: request.query,
        scope: resolved.scope,
        availableScopes: resolved.availableScopes,
        hits,
        dropped,
        capped,
        ...(resolvedLineage?.incompleteAt === undefined ? {} : { lineageIncompleteAt: resolvedLineage.incompleteAt }),
    };
}
/** One provider call whose failure reaches the model as a readable sentence. */
async function providerCall(operation) {
    try {
        return await operation();
    }
    catch (error) {
        throw new Error(`context search could not run: ${describeFailure(error)}`);
    }
}
/**
 * Expand one remembered event into its bounded neighbourhood. The ref is
 * revalidated against the host's authorization on every call, the target is
 * always present, and the window is the engine's own budget — the model never
 * guesses raw event counts.
 */
export async function readContextHit(adapter, request) {
    const exec = request.exec;
    const subject = await adapter.subject(exec);
    const authorized = await readAuthorizedSessions(adapter, subject);
    if (!authorized.has(String(request.sessionId))) {
        throw new Error(`context_read names Session ${request.sessionId}, which is not part of the history this subject may read`);
    }
    const access = sessionAccess(adapter, exec);
    const maxAncestors = Math.max(0, Math.trunc(adapter.maxAncestors ?? DEFAULT_TIMELINE_ANCESTORS));
    const lineage = await activeLineage(adapter, access, exec, maxAncestors);
    const from = Math.max(0, request.seq - CONTEXT_READ_BEFORE);
    const to = request.seq + CONTEXT_READ_AFTER;
    let documents;
    try {
        documents = await adapter.query.filterEvents(request.sessionId, [{ kind: 'seq', from, to }]);
    }
    catch (error) {
        throw new Error(`context_read could not read Session ${request.sessionId}: ${describeFailure(error)}`);
    }
    const target = documents.find(document => Number(document.seq) === request.seq);
    if (target === undefined) {
        throw new Error(`context_read: seq ${request.seq} is not in Session ${request.sessionId}'s current log; the ref may predate a compaction or come from another engine`);
    }
    const generation = generationOf(request.sessionId, lineage);
    return {
        sessionId: request.sessionId,
        seq: request.seq,
        generation,
        eventType: String(target.type),
        time: new Date(target.time).toISOString(),
        surface: target.surface,
        events: documents.map((document) => {
            const truncated = document.text.length > CONTEXT_READ_EVENT_CHARS;
            return {
                seq: Number(document.seq),
                type: String(document.type),
                time: new Date(document.time).toISOString(),
                surface: document.surface,
                target: Number(document.seq) === request.seq,
                text: truncated ? `${document.text.slice(0, CONTEXT_READ_EVENT_CHARS)}…` : document.text,
                truncated,
            };
        }),
        anchor: await returnAnchorFor(adapter, access, generation, request.sessionId, request.seq, await adapter.handoffAt(exec)),
    };
}
