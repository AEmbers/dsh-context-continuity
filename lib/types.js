/**
 * Generic context-continuity vocabulary, parameterized over a host's own
 * subject identity.
 *
 * A "subject" is any durable identity that outlives a single model Session:
 * the Agent Team calls it a Member, a single-Individual harness calls it an
 * Individual, a solo long-running coding agent is its own single subject. The
 * engine never names the subject; it only needs a stable id and the Session
 * the subject is currently bound to.
 * @module @sophialin/dsh-context-continuity/types
 */
export {};
