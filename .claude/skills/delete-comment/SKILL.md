---
name: delete-comment
description: Triage and delete code comments in simple-rss, then ratchet the comment baseline down. Sorts each comment into Tautology, Stale, Excuse, or Decision Record; deletes it; files a GitHub issue per Excuse and moves each Decision Record into docs/adr/. Use for /delete-comment, "delete comments in X", "burn down the comment baseline", or when `pnpm comments:check` fails.
argument-hint: "[path...]  (default: the files with the most comment lines in tools/comments/baseline.json)"
---

# Delete comments

Code comments are banned in this repo. Names, types, tests and ADRs carry meaning instead. `tools/comments/main.ts` counts comment lines per file against `tools/comments/baseline.json`, and `pnpm lint` fails when a count goes up or goes down without being locked in. Your job is to drive counts to zero for the paths you are given.

Read `AGENTS.md`, `CONTEXT.md`, and the ADRs in `docs/adr/` that touch the paths before you start.

## 1. Scope

```bash
pnpm -s comments:list <path...>
```

No paths given: take the top files from `tools/comments/baseline.json` by count, about 250 comment lines in total. Over 300 lines: split by folder and run one subagent per slice, each with this skill and its own file list. Slices never share a file. Subagents only delete and report. You file issues, write ADRs, and lock.

Exempt and not listed: `// SAFETY:` before an `as`, `biome-ignore <reason>`, `@ts-expect-error`. Leave them.

## 2. Triage

Put every listed comment in exactly one category.

| Category | Test | Action |
| --- | --- | --- |
| Tautology | Restates the code, a name, or a type. A local why that is obvious once you read the function counts. | Delete. |
| Stale | Untrue at HEAD, names a symbol that no longer exists, or is history. | Delete. |
| Excuse | Explains away a workaround, an invented fallback, duplication, a misleading name, or a shape that needs justifying. | Delete. File an issue to fix the code. |
| Decision Record | A non-obvious why a new maintainer would get wrong: a security rule, a protocol or browser quirk, a product rule, a cross-module invariant, a rejected alternative. | Delete. Move the decision into an ADR. |
| Directive | Read by a tool (`/* @vite-ignore */`, `/*#__PURE__*/`). | Keep. Add its pattern to `exemptions` in `tools/comments/main.ts`. |

Be strict about Decision Record. Most comments that sound wise are Tautologies. If a decision is better pinned by a test name or a type, say so in the ADR's consequences or in an issue, not in a comment.

## 3. Delete

Change only comments, then run `pnpm exec biome format --write <files>`. Never edit code in this step. A rename or reshape that a deleted comment was excusing belongs in its issue.

## 4. Excuses become issues

Group the comments that excuse the same hack into one issue. Follow `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Use `CONTEXT.md` terms. Each body has the `file:line` locations, the deleted comment quoted, what is hacky, and the reshape that removes the need for it. Label `ready-for-agent` when the reshape is concrete.

## 5. Decision Records become ADRs

When an existing ADR already states the decision, drop it. Otherwise group related decisions by theme. Add a paragraph to the ADR that owns the theme, or write a new `docs/adr/NNNN-<theme>.md` in the house style: a title naming the decision, then prose paragraphs covering the decision, why, and the rejected alternative. Name the code by module and symbol, not by line number.

## 6. Lock and verify

```bash
pnpm comments:lock
pnpm lint && pnpm typecheck && pnpm test
```

`comments:lock` refuses to raise any count. Commit `tools/comments/baseline.json` with the deletions. Report the comment lines removed, the issues filed (with links), the ADRs written or extended, and the new baseline total (`jq add tools/comments/baseline.json`).
