"""Persistent build slots, shared state and disk control.

A slot is a reused git worktree with its own node_modules. Repository setup and cleanup
come from configuration. Reuse bounds disk to (slots × cap)."""

import contextlib
import fcntl
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

GB = 1024 ** 3
GATE_WAIT_SECONDS = 540
GATE_POLL_SECONDS = 2
GATE_TAIL_LINES = 60


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


def phase_commands(cfg, phase):
    commands = cfg["commands"].get(phase, [])
    if phase == "gate" and not commands:
        raise SystemExit("configure at least one gate command before running the factory")
    return commands


def run_commands(cfg, phase, path):
    """Run configured argv commands in order; stop on the first failure."""
    for command in phase_commands(cfg, phase):
        subprocess.run(command, cwd=path, check=True)


def gate_files(slot):
    logs = main_root() / ".factory" / "logs"
    return {name: logs / f"gate-{slot}.{name}" for name in ("log", "exit", "pid")}


def proc_stat(pid):
    """(state, start time) of a pid from /proc/<pid>/stat, or None once it is gone."""
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    except (OSError, IndexError):
        return None
    return fields[0], fields[19]


def recorded_gate(files):
    """(pid, start time) from the pid file, or None when absent or unreadable."""
    try:
        pid, start = files["pid"].read_text().split()
        return int(pid), start
    except (OSError, ValueError):
        return None


def gate_running(files):
    """A recycled pid differs in start time; a zombie has state Z."""
    gate = recorded_gate(files)
    if files["exit"].exists() or not gate:
        return False
    stat = proc_stat(gate[0])
    return bool(stat) and stat[0] != "Z" and stat[1] == gate[1]


def kill_leftovers(files):
    """Kill the previous gate's process group: children outlive a killed wrapper."""
    gate = recorded_gate(files)
    if not gate:
        return
    stat = proc_stat(gate[0])
    if stat and stat[1] != gate[1]:  # pid recycled: its group is not ours
        return
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(gate[0], signal.SIGKILL)


def gate_steps(cfg, train=False):
    return phase_commands(cfg, "gate") + (phase_commands(cfg, "train_gate") if train else [])


def gates_dir():
    return main_root() / ".factory" / "gates"


def tree_state(path):
    """(HEAD sha, dirty): dirty counts modified and untracked files, never ignored ones."""
    return sh("git", "rev-parse", "HEAD", cwd=path), bool(sh("git", "status", "--porcelain", cwd=path))


def run_gate(commands, path, train=False):
    """Run steps in order, stop at the first failure, record the result for HEAD; returns the exit code.

    A tree that was dirty or moved during the run proves nothing about a SHA: no record."""
    before = tree_state(path)
    steps, code = [], 0
    for command in commands:
        began = time.monotonic()
        code = subprocess.run(command, cwd=path).returncode
        steps.append({"command": shlex.join(command), "ok": code == 0,
                      "seconds": round(time.monotonic() - began, 1)})
        if code:
            break
    if before != tree_state(path) or before[1]:
        print("tree was dirty or changed during the gate: no gate record written", file=sys.stderr)
        return code
    record = {"sha": before[0], "ok": code == 0, "train": train, "steps": steps,
              "finished_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    write_atomic(gates_dir() / f"{before[0]}.json", json.dumps(record, indent=2))
    return code


def write_atomic(target, text):
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(target)


def gate_record(sha, path):
    """The recorded gate for sha; refuses when the tree is dirty or no record exists."""
    if tree_state(path)[1]:
        raise SystemExit("worktree has uncommitted or untracked files: commit them and rerun the gate")
    full = sh("git", "rev-parse", "--verify", "-q", f"{sha}^{{commit}}", cwd=path, check=False)
    file = gates_dir() / f"{full}.json"
    missing = SystemExit(f"no gate record for {sha}: factory gate --detach")
    if not full or not file.exists():
        raise missing
    try:
        return json.loads(file.read_text())
    except json.JSONDecodeError:
        raise missing from None


def start_gate(cfg, slot, path, train=False):
    """Run the gate in a background session; its log and exit code land in the main checkout's .factory/logs."""
    commands = gate_steps(cfg, train)
    files = gate_files(slot)
    if gate_running(files):
        raise SystemExit(f"gate already running in {slot}: factory gate-wait --slot {slot}")
    kill_leftovers(files)
    files["log"].parent.mkdir(parents=True, exist_ok=True)
    for name in ("log", "exit", "pid"):
        files[name].unlink(missing_ok=True)
    job = json.dumps({"commands": commands, "train": train})
    with open(files["log"], "w") as log:
        proc = subprocess.Popen([sys.executable, __file__, str(files["exit"]), job], cwd=path,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True)
    stat = proc_stat(proc.pid)
    files["pid"].write_text(f"{proc.pid} {stat[1] if stat else '-'}")
    return {"log": str(files["log"]), "exit": str(files["exit"])}


def wait_gate(slot):
    """Block up to GATE_WAIT_SECONDS: running, or the exit code with the log tail on failure."""
    files = gate_files(slot)
    if not files["log"].exists():
        raise SystemExit(f"no gate started in {slot}: factory gate --detach")
    deadline = time.monotonic() + GATE_WAIT_SECONDS
    while gate_running(files) and time.monotonic() < deadline:
        time.sleep(GATE_POLL_SECONDS)
    if gate_running(files):
        return {"status": "running"}
    tail = "".join(files["log"].read_text(errors="replace").splitlines(keepends=True)[-GATE_TAIL_LINES:])
    if files["exit"].exists():
        code = int(files["exit"].read_text())
        return {"status": "passed", "exit": 0} if code == 0 else {"status": "failed", "exit": code, "tail": tail}
    return {"status": "failed", "exit": 1, "tail": "gate process died before writing an exit code\n" + tail}


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


def clean_slot(store, slot, aggressive=False, keep_clean_paths=False):
    """Shrink an idle slot: drop configured local state (unless kept), and node_modules over cap."""
    path = store.slot_path(slot)
    root = path.resolve()
    targets = []
    for name in store.cfg["clean_paths"]:
        target = (path / name).resolve()
        if Path(name).is_absolute() or target == root or root not in target.parents:
            raise SystemExit(f"unsafe cleanup path: {name}")
        targets.append(target)
    if not keep_clean_paths:
        for target in targets:
            shutil.rmtree(target, ignore_errors=True)
    report = {"slot": slot, "clean_paths": "kept" if keep_clean_paths else "removed"}
    size = dir_size(path / "node_modules")
    if aggressive or size > store.cfg["slot_node_modules_cap_gb"] * GB:
        shutil.rmtree(path / "node_modules", ignore_errors=True)
        return {**report, "node_modules_gb": round(size / GB, 1), "action": "node_modules removed"}
    return {**report, "node_modules_gb": round(size / GB, 1), "action": "kept"}


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


def review_target_dir():
    return Path.home() / ".cache" / "sunreye-review-target"


def prune_review_target(store, state):
    """Reviewers share one cargo target dir; drop it when none runs and free disk is under the pause line."""
    target = review_target_dir()
    if not os.path.lexists(target):
        return "absent"
    if any(key.startswith("review:") for key in state.get("runs", {})) \
            or disk(store)["level"] == "green":
        return "kept"
    if target.is_symlink():
        with contextlib.suppress(OSError):
            target.unlink()
    else:
        shutil.rmtree(target, ignore_errors=True)
    return "kept" if os.path.lexists(target) else "pruned"


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
    return {"slots": report, "orphans": orphans, "review_target": prune_review_target(store, state),
            "disk": disk(store), "at": int(time.time())}


if __name__ == "__main__":
    # Detached gate: argv = exit file, JSON job. The exit file is written last, atomically.
    job = json.loads(sys.argv[2])
    write_atomic(Path(sys.argv[1]), f"{run_gate(job['commands'], Path.cwd(), job['train'])}\n")
