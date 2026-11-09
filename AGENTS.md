# Agent rules

Bun is the JavaScript runtime and package manager.

## Specs

Specs are ADRs in `docs/adr/`, written by a `grilling` session. Domain terms live in `GLOSSARY.md`.
No code before the ADR that names it.

## TDD

Behaviour ships with the test that proves it, written first: failing test, run it red, smallest code to green.
This code talks to grid-tied hardware. A red suite never leaves the machine.

## YAGNI

YAGNI governs features, not seams (ADR 1).

- **Seams** an ADR names are built now, with one adapter and a test through the interface.
- **A missing seam** is one whose late arrival would migrate stored data, break a published contract (API, profile schema, file format) or touch every adapter. Build it now, and record it in the ADR it belongs to in the same change.
- **Features** serve the current task. Options, flags and abstractions wait for their second real use.
- Delete unused code.

## Prose

Minimum words. Code comments carry only the why or a constraint. Reports: findings first, one line each, end with `Recommendation:` and one concrete next action, or `none`.

## Commits

Conventional commits, lowercase types: `type(scope): summary`. One logical change per commit.
