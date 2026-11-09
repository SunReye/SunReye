---
name: pr
description: "Use when writing a PR body."
---

PR body: at most 5 lines. One line per change in the domain language of `GLOSSARY.md`, one gate line, `Closes #<issue>`. No process narration, no recap. Numbers as `before → after`. Example:

```markdown
- One endpoint task serialises reads for every device behind it
- A silence over three poll cadences, at least 15 s, is stored as a gap
`bun run gate` green.
Closes #616
```

`v5` is not the default branch, so `Closes` does not fire on merge: close the issue by hand afterwards.

Fix-round and merge-round comment: one line per finding, nothing else: `F1: fixed in <file>` or `F2: not a defect: <reason>`.
