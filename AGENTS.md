# Agent rules

Bun is the JavaScript runtime and package manager.

## Specs

Specs are ADRs in `docs/adr/`, written by a `grilling` session. Domain terms live in `GLOSSARY.md`.
No code before the ADR that names it.

## TDD

Behaviour ships with the test that proves it, written first: failing test, run it red, smallest code to green.
This code talks to grid-tied hardware. A red suite never leaves the machine.

## YAGNI

Build what the current task needs. No speculative options, extension points or flags. No abstraction until the second real use. Delete unused code.

## Prose

Minimum words. Code comments carry only the why or a constraint. Reports: findings first, one line each, end with `Recommendation:` and one concrete next action, or `none`.

## Commits

Conventional commits, lowercase types: `type(scope): summary`. One logical change per commit.
