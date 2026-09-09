# AI context workflow

Applies to any AI coding agent working in this repo (Claude, Codex, or otherwise) — no path restriction, unlike the other rule files here.

## Before changing code in a domain

Read, in this order:
1. That domain's page in [`.claude/wiki/`](../wiki/README.md) — current-state reference (how it actually works right now).
2. The relevant section of [`.claude/graph/functionality-graph.md`](../graph/functionality-graph.md) — what it depends on and what depends on it, so a change doesn't silently break a consumer in another domain.
3. [`.claude/wiki/mistakes.md`](../wiki/mistakes.md) — check whether the area you're about to touch has already burned someone once.

This is in addition to, not instead of, the relevant `.claude/specs/<domain>/` (requirements/design/tasks — the historical *why*) and `.claude/rules/*.md` (the narrow *how* for that surface).

## After a nontrivial change

- Update the relevant `.claude/wiki/*.md` page if the change makes it inaccurate — a stale wiki page is worse than none; fix it in the same pass as the code change that made it stale, not as a follow-up.
- If a change spans domains or adds a new cross-cutting dependency, update `.claude/graph/functionality-graph.md`'s relevant section.
- If you found and fixed a bug whose root cause wasn't obvious — the kind of thing that would burn the *next* session the same way — append an entry to `.claude/wiki/mistakes.md`: what happened, root cause, fix, how to avoid it. Don't log routine bugs with an obvious cause; this is for the ones worth not rediscovering.

The point of all of this is token efficiency and continuity across sessions, not ceremony — if a change is small enough that none of this would change, skip it. The judgment call is the same one that governs comments elsewhere in this codebase: write it down when it would surprise a future reader, not by default.
