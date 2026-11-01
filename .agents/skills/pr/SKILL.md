---
name: pr
description: "Use when writing a PR body."
---

PR body: 3-6 bullets of what changed, one gate line (`scripts/ci` green, or the known flake), `Closes #<issue>`. Use the domain language of `GLOSSARY.md`. Example:

```markdown
- Add `GET /v1/wallets/:id/ledger` with cursor paging
- Gate the route on `wallet.read` and audit the read
- Generate the web client

`scripts/ci --e2e` green.

Closes #123
```

Fix-round comment: one line per finding, `F1: fixed in <file>`.
