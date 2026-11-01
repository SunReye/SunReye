# Domain Docs

This repo uses a single-context layout across its Bun workspaces: `GLOSSARY.md` at the repository root and shared decisions in `docs/adr/`.

## Before exploring

- Read root `GLOSSARY.md` when it exists.
- Read ADRs in `docs/adr/` that touch the area being explored, including the existing automation I/O decision when working on automation.
- Follow root and area `AGENTS.md` routing for package-specific instructions.

If a glossary or ADR directory is absent, proceed silently. Domain-modeling work creates documentation lazily as terms and decisions are resolved; setup does not create an empty glossary or invent decisions.

## Use the glossary's vocabulary

Use defined domain terms in issue titles, proposals, hypotheses and tests. Avoid synonyms the glossary explicitly rejects. If a needed concept is missing, reconsider the term or record the gap for domain-modeling work.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, name the ADR and explain why reopening the decision is justified instead of silently overriding it.
