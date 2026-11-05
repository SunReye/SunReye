---
name: pr
description: "Use when writing a PR body."
---

PR body: at most 5 lines. One line per change in the domain language of `GLOSSARY.md`, one gate line, `Closes #<issue>`. No process narration, no recap. Numbers as `before → after`. Example:

```markdown
- Reuse a green per-PR gate record when the train gate sees the same tree and base tip
- Reviewers read `gate-result`; only defects with a failing scenario fail a verdict
- Dispatcher skips reviews for merge-only rounds, skips overlapping tickets, files `Follow-up:` lines
`scripts/factory/factory gate` green.
Closes #489
```

Fix-round and merge-round comment: one line per finding, nothing else: `F1: fixed in <file>` or `F2: not a defect: <reason>`.
