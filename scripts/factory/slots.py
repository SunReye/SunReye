"""Persistent build slots, shared state and disk control.

A slot is a reused git worktree with its own node_modules. Repository setup and cleanup
come from configuration. Reuse bounds disk to (slots × cap)."""

import contextlib
import fcntl
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

GB = 1024 ** 3


def sh(*args, cwd=None, check=True):
    res = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and res.returncode != 0:
        raise SystemExit(f"{' '.join(args)}: {res.stderr.strip()[:500]}")
    return res.stdout.strip()


def main_root():
    common = Path(sh("git", "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return common.parent


class Store:
    """JSON state under <main checkout>/.factory, guarded by a file lock."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.root = main_root()
        self.dir = self.root / ".factory"
        self.dir.mkdir(exist_ok=True)
        (self.dir / "reviews").mkdir(exist_ok=True)
        (self.dir / "logs").mkdir(exist_ok=True)
        self.file = self.dir / "state.json"

    @contextlib.contextmanager
    def locked(self):
        with open(self.dir / "state.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = json.loads(self.file.read_text()) if self.file.exists() else {}
            state.setdefault("slots", {})
            state.setdefault("attempts", {})
            state.setdefault("runs", {})
            yield state
            self.file.write_text(json.dumps(state, indent=2))

    def slot_ids(self, kind):
        return [f"{kind}-{i}" for i in range(1, self.cfg["slots"][kind] + 1)]

    def slot_path(self, slot):
        return self.dir / "slots" / slot

    def env(self, slot):
        # Port and worker hints are available to project commands that support them.
        # Project test harnesses remain responsible for their own resource isolation.
        n = (self.slot_ids("impl") + self.slot_ids("merge")).index(slot) + 1
        return {"FACTORY_SLOT": slot, "WORKER_PORT": 8787 + n, "WEB_PORT": 4173 + n,
                "VITEST_MAX_WORKERS": self.cfg["vitest_workers_per_slot"],
                "PW_WORKERS": self.cfg["playwright_workers_per_slot"],
                # Rust: no incremental cache, line tables only, and never a target dir shared across slots.
                "CARGO_INCREMENTAL": "0",
                "CARGO_PROFILE_DEV_DEBUG": "line-tables-only",
                "CARGO_PROFILE_TEST_DEBUG": "line-tables-only",
                "CARGO_BUILD_JOBS": str(self.cfg["cargo_build_jobs"]),
                "CARGO_TARGET_DIR": str(self.slot_path(slot) / "target")}


def env_file_text(env, nice):
    """Source-able slot env; implementer shells are reniced so the merge slot's gate wins the CPU."""
    text = "".join(f"export {k}={v}\n" for k, v in env.items())
    if env["FACTORY_SLOT"].startswith("impl-"):
        text += f'[ "$(ps -o ni= -p $$)" -ge {nice} ] || renice -n {nice} -p $$ >/dev/null 2>&1 || true\n'
    return text


def run_commands(cfg, phase, path):
    """Run configured argv commands in order; stop on the first failure."""
    commands = cfg["commands"].get(phase, [])
    if phase == "gate" and not commands:
        raise SystemExit("configure at least one gate command before running the factory")
    for command in commands:
        subprocess.run(command, cwd=path, check=True)


def prepare(store, slot, branch, new_branch=False):
    """Check out ref (new branch from base, or an existing PR branch) in the slot."""
    path = store.slot_path(slot)
    base = store.cfg["base"]
    sh("git", "fetch", "-q", "origin", base, *([branch] if branch and not new_branch else []), cwd=store.root)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        sh("git", "worktree", "add", "-q", "--detach", str(path), f"origin/{base}", cwd=store.root)
    sh("git", "reset", "-q", "--hard", cwd=path)
    sh("git", "clean", "-qfd", "-e", "target", "-e", "node_modules", cwd=path)
    if new_branch:
        sh("git", "switch", "-q", "-C", branch, f"origin/{base}", cwd=path)
    else:
        sh("git", "switch", "-q", "-C", branch, f"origin/{branch}", cwd=path)
    env_file = store.dir / "slots" / f"{slot}.env"
    env_file.write_text(env_file_text(store.env(slot), store.cfg["slot_nice"]))
    if not (path / "node_modules").exists():
        run_commands(store.cfg, "install", path)
    run_commands(store.cfg, "prepare", path)
    return {"slot": slot, "path": str(path), "env": str(env_file), "branch": branch}


def dir_size(path):
    if not path.exists():
        return 0
    out = sh("du", "-sb", str(path), check=False)
    return int(out.split()[0]) if out else 0


def disk(store):
    free = shutil.disk_usage(store.root).free / GB
    level = "red" if free < store.cfg["disk_critical_free_gb"] else \
        "amber" if free < store.cfg["disk_pause_free_gb"] else "green"
    return {"free_gb": round(free, 1), "level": level}


def clean_slot(store, slot, aggressive=False):
    """Shrink an idle slot: drop configured local state, and node_modules over cap."""
    path = store.slot_path(slot)
    root = path.resolve()
    targets = []
    for name in store.cfg["clean_paths"]:
        target = (path / name).resolve()
        if Path(name).is_absolute() or target == root or root not in target.parents:
            raise SystemExit(f"unsafe cleanup path: {name}")
        targets.append(target)
    for target in targets:
        shutil.rmtree(target, ignore_errors=True)
    size = dir_size(path / "node_modules")
    if aggressive or size > store.cfg["slot_node_modules_cap_gb"] * GB:
        shutil.rmtree(path / "node_modules", ignore_errors=True)
        return {"slot": slot, "node_modules_gb": round(size / GB, 1), "action": "node_modules removed"}
    return {"slot": slot, "node_modules_gb": round(size / GB, 1), "action": "kept"}


def remove_orphan_slots(store):
    """Remove slot dirs outside the configured pool (left behind when the pool shrinks)."""
    pool = set(store.slot_ids("impl") + store.slot_ids("merge"))
    removed = []
    for path in sorted((store.dir / "slots").glob("*-*")):
        if path.is_dir() and re.fullmatch(r"(impl|merge)-\d+", path.name) and path.name not in pool:
            sh("git", "worktree", "remove", "--force", str(path), cwd=store.root, check=False)
            shutil.rmtree(path, ignore_errors=True)
            removed.append(path.name)
    return removed


def gc(store, state, aggressive=False):
    report = []
    orphans = remove_orphan_slots(store)
    for slot in store.slot_ids("impl") + store.slot_ids("merge"):
        if slot not in state["slots"] and store.slot_path(slot).exists():
            report.append(clean_slot(store, slot, aggressive))
    sh("git", "worktree", "prune")
    sh("git", "fetch", "-q", "--prune", "origin")
    merged = sh("git", "branch", "--list", "factory/*", "--merged", f"origin/{store.cfg['base']}")
    busy = {s.get("branch") for s in state["slots"].values()}
    for branch in (b.strip(" *+") for b in merged.splitlines()):
        if branch and branch not in busy:
            sh("git", "branch", "-q", "-D", branch, check=False)
    sh("docker", "image", "prune", "-f", check=False)
    return {"slots": report, "orphans": orphans, "disk": disk(store), "at": int(time.time())}
