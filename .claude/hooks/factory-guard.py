#!/usr/bin/env python3
"""PreToolUse guard for factory sessions (loaded by .claude/factory/settings.json).

Permission rules match command text only, so the hard limits live here. Exit 2 blocks the call."""

import json
import re
import shlex
import sys
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "scripts/factory/config.json"


def words(command):
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


def push_targets(args):
    """Branch names a `git push` writes to (refspec right side, or the bare name)."""
    refspecs = [a for a in args if not a.startswith("-")][2:]  # drop "push" and the remote
    return [r.split(":")[-1].lstrip("+").removeprefix("refs/heads/") for r in refspecs]


def check_push(args, cfg):
    targets = push_targets(args)
    protected = {cfg["base"], *cfg["protected_branches"]}
    if any(t in protected for t in targets) or "--all" in args or "--mirror" in args:
        return "Push to a protected branch: the factory lands work only through `scripts/factory/factory merge`."
    if not targets or not all(t.startswith("factory/") for t in targets):
        return "Name an explicit factory/* destination when pushing."
    forced = "-f" in args or any(a.startswith(("--force", "+")) for a in args)
    if forced:
        return "Force push blocked: merge the configured base into the branch and push normally."
    return None


def check(command, cfg):
    if re.search(r"--no-verify\b|core\.hooksPath|\bHUSKY=0\b", command):
        return "Hooks stay on: fix what the hook reports instead of skipping it."
    if re.search(r"\b(?:gh|fj)\b[^;&|]*\bpr\s+merge\b|/pulls/\d+/merge\b", command):
        return "Merging goes through `scripts/factory/factory merge <pr>`, which checks CI first."
    if re.search(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME)(\s|$)", command):
        return "Refusing to delete a root or home directory."
    for segment in re.split(r"&&|\|\||;|\|", command):
        args = words(segment.strip())
        if args[:1] == ["git"]:
            rest = [a for a in args[1:] if a != "-C"]
            if "push" in rest:
                reason = check_push(rest[rest.index("push"):], cfg)
                if reason:
                    return reason
            if "commit" in rest and any(re.fullmatch(r"-[a-zA-Z]*n[a-zA-Z]*", a) for a in rest):
                return "`git commit -n` skips hooks: commit without it."
    return None


def main():
    event = json.load(sys.stdin)
    if event.get("tool_name") != "Bash":
        return
    try:
        cfg = json.loads(CONFIG.read_text())
        if not isinstance(cfg["base"], str) or not cfg["base"] or not isinstance(cfg["protected_branches"], list):
            raise ValueError("invalid branch configuration")
        reason = check(event.get("tool_input", {}).get("command", ""), cfg)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Cannot load factory guard configuration: {error}", file=sys.stderr)
        sys.exit(2)
    if reason:
        print(reason, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
