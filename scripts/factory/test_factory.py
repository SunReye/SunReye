import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import slots  # noqa: E402

loader = SourceFileLoader("factory_cli", str(HERE / "factory"))
factory = module_from_spec(spec_from_loader("factory_cli", loader))
loader.exec_module(factory)


def pr(number, lane):
    return {"number": number, "title": f"PR {number}", "labels": [{"name": f"factory:{lane}"}],
            "head": {"ref": f"factory/{number + 100}"}}


class FakeForge:
    def __init__(self, pulls):
        self.pulls = pulls

    def open_issues(self):
        return []

    def closed_numbers(self):
        return set()

    def open_pulls(self):
        return self.pulls


class FakeStore:
    def __init__(self, root):
        self.root = Path(root)
        self.dir = self.root / ".factory"
        self.cfg = factory.CFG

    @contextlib.contextmanager
    def locked(self):
        yield {"slots": {}, "attempts": {}, "runs": {}, "routes": {}}

    def slot_ids(self, kind):
        return [f"{kind}-{i}" for i in range(1, self.cfg["slots"][kind] + 1)]


def run(command, *args):
    buf = io.StringIO()
    code = 0
    with contextlib.redirect_stdout(buf):
        try:
            command(*args)
        except SystemExit as exit_:
            code = exit_.code
    return code, json.loads(buf.getvalue()) if buf.getvalue().strip() else None


class ClaimLimit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = FakeStore(self.tmp.name)

    def status(self, pulls):
        return run(factory.cmd_status, self.store, FakeForge(pulls))[1]

    def test_four_approved_prs_block_claims(self):
        status = self.status([pr(n, "approved") for n in range(1, 5)])
        self.assertTrue(status["claim_blocked"])

    def test_approved_and_merging_both_count(self):
        status = self.status([pr(1, "approved"), pr(2, "approved"), pr(3, "merging"), pr(4, "merging")])
        self.assertTrue(status["claim_blocked"])

    def test_three_waiting_prs_leave_claims_open(self):
        status = self.status([pr(n, "approved") for n in range(1, 4)])
        self.assertFalse(status["claim_blocked"])

    def test_review_and_changes_lanes_do_not_count(self):
        status = self.status([pr(n, "review") for n in range(1, 4)] + [pr(n, "changes") for n in range(4, 8)])
        self.assertFalse(status["claim_blocked"])

    def test_claim_refuses_with_a_json_reason(self):
        forge = FakeForge([pr(n, "approved") for n in range(1, 5)])
        code, body = run(factory.cmd_claim, self.store, forge, "999")
        self.assertNotEqual(code, 0)
        self.assertEqual(body["claim_blocked"], True)
        self.assertIn("waiting", body["reason"])


class RepositoryConfig(unittest.TestCase):
    def test_cli_does_not_create_bytecode_in_the_source_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("factory", "forge.py", "slots.py", "config.json"):
                shutil.copyfile(HERE / name, root / name)
            result = subprocess.run([sys.executable, str(root / "factory"), "config"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / "__pycache__").exists())

    def test_factory_targets_sunreye(self):
        self.assertEqual(factory.CFG["repo"], "SunReye/SunReye")
        self.assertEqual(factory.CFG["base"], "v4")
        self.assertFalse(factory.CFG["require_ci"])
        self.assertEqual(factory.CFG["commands"]["gate"], [["scripts/ci"]])

    def test_slots_drop_rust_output_and_pause_before_the_disk_is_tight(self):
        self.assertIn("target", factory.CFG["clean_paths"])
        self.assertEqual((factory.CFG["disk_pause_free_gb"], factory.CFG["disk_critical_free_gb"]), (30, 15))


class SlotEnv(unittest.TestCase):
    def test_sourcing_the_env_file_nices_the_shell_and_its_children(self):
        text = slots.env_file_text({"FACTORY_SLOT": "impl-1"}, 10)
        with tempfile.NamedTemporaryFile("w", suffix=".env") as env:
            env.write(text)
            env.flush()
            script = f'. {env.name}; echo "$FACTORY_SLOT"; sh -c "ps -o ni= -p \\$\\$"'
            out = subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=True).stdout
        slot, nice = out.split()
        self.assertEqual(slot, "impl-1")
        self.assertGreaterEqual(int(nice), 10)

    def test_the_merge_slot_env_is_not_reniced(self):
        self.assertNotIn("renice", slots.env_file_text({"FACTORY_SLOT": "merge-1"}, 10))

    def test_slot_env_keeps_rust_builds_small_and_inside_the_slot(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(slots, "main_root", return_value=Path(tmp)):
            store = slots.Store(factory.CFG)
            env = store.env("impl-2")
        self.assertEqual(env["CARGO_INCREMENTAL"], "0")
        self.assertEqual(env["CARGO_PROFILE_DEV_DEBUG"], "line-tables-only")
        self.assertEqual(env["CARGO_PROFILE_TEST_DEBUG"], "line-tables-only")
        self.assertEqual(env["CARGO_BUILD_JOBS"], str(factory.CFG["cargo_build_jobs"]))
        self.assertEqual(env["CARGO_TARGET_DIR"], str(store.slot_path("impl-2") / "target"))

    def test_a_failing_renice_does_not_fail_sourcing(self):
        text = slots.env_file_text({"FACTORY_SLOT": "impl-1"}, 20)
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "renice"
            stub.write_text("#!/bin/sh\nexit 1\n")
            stub.chmod(0o755)
            env = Path(tmp) / "slot.env"
            env.write_text(text)
            script = f'PATH={tmp}:$PATH; . {env} && echo sourced'
            out = subprocess.run(["bash", "-c", script], capture_output=True, text=True).stdout
        self.assertEqual(out.split(), ["sourced"])


class RecordingForge:
    def __init__(self, branch):
        self.branch = branch
        self.calls = []
        self.states = {}
        self.labels = []

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET":
            return {"head": {"ref": self.branch}}

    def ensure_labels(self):
        pass

    def set_state(self, number, state):
        self.states[number] = state

    def add_label(self, number, name):
        self.labels.append((number, name))

    def comment(self, number, body):
        self.calls.append(("comment", number, body))


class OpenedSize(unittest.TestCase):
    def setUp(self):
        profile = mock.patch.dict(factory.CFG, {"base": "staging", "require_ci": False})
        profile.start()
        self.addCleanup(profile.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.origin = self.root / "origin.git"
        self.work = self.root / "work"
        self.git(self.root, "init", "-q", "--bare", "-b", "staging", str(self.origin))
        self.git(self.root, "clone", "-q", str(self.origin), str(self.work))
        self.git(self.work, "config", "user.email", "t@example.com")
        self.git(self.work, "config", "user.name", "t")
        self.write("README.md", "base\n")
        self.commit("base")
        self.git(self.work, "push", "-q", "origin", "staging")
        self.git(self.work, "checkout", "-q", "-b", "factory/7")
        cwd = os.getcwd()
        os.chdir(self.work)
        self.addCleanup(os.chdir, cwd)
        self.store = FakeStore(self.root)
        self.forge = RecordingForge("factory/7")

    def git(self, cwd, *args):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    def write(self, name, text):
        path = self.work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, message):
        self.git(self.work, "add", "-A")
        self.git(self.work, "commit", "-q", "-m", message)

    def push_branch(self, **files):
        for name, text in files.items():
            self.write(name.replace("__", "/"), text)
        self.commit("work")
        self.git(self.work, "push", "-q", "origin", "factory/7")

    def opened(self):
        return run(factory.cmd_opened, self.store, self.forge, "7", "70")

    def test_fifty_files_go_to_review(self):
        self.push_branch(**{f"f{i}.txt": "x\n" for i in range(50)})
        code, body = self.opened()
        self.assertEqual(code, 0)
        self.assertEqual(body["lane"], "review")
        self.assertEqual(self.forge.states, {70: "factory:review"})

    def test_fifty_one_files_are_refused_and_routed_to_split(self):
        self.push_branch(**{f"f{i}.txt": "x\n" for i in range(51)})
        code, body = self.opened()
        self.assertNotEqual(code, 0)
        self.assertEqual(body["files"], 51)
        self.assertIn("51 files", body["reason"])
        self.assertIn((7, "factory:split"), self.forge.labels)
        self.assertEqual(self.forge.states[7], None)
        self.assertNotIn(70, self.forge.states)
        self.assertIn(("PATCH", "/pulls/70", {"state": "closed"}), self.forge.calls)

    def test_lines_over_the_limit_are_refused(self):
        self.push_branch(**{"big.txt": "x\n" * 3001})
        code, body = self.opened()
        self.assertNotEqual(code, 0)
        self.assertEqual(body["lines"], 3001)

    def test_lines_at_the_limit_pass(self):
        self.push_branch(**{"big.txt": "x\n" * 3000})
        code, body = self.opened()
        self.assertEqual(code, 0)

    def test_generated_files_are_not_counted(self):
        generated = {
            **{f"src__a{i}.gen.ts": "x\n" * 200 for i in range(5)},
            "apps__worker__migrations__meta__0001_snapshot.json": "x\n" * 3000,
            "bun.lock": "x\n" * 500,
            "apps__agent__Cargo.lock": "x\n" * 500,
        }
        self.push_branch(**{f"f{i}.txt": "x\n" for i in range(50)}, **generated)
        code, body = self.opened()
        self.assertEqual(code, 0)
        self.assertEqual((body["files"], body["lines"]), (50, 50))

    def test_a_reviewed_pr_re_entering_from_a_fix_round_skips_the_size_gate(self):
        (self.store.dir / "reviews").mkdir(parents=True)
        (self.store.dir / "reviews" / "70-spec.md").write_text("fine\n")
        self.push_branch(**{f"f{i}.txt": "x\n" for i in range(51)})
        code, body = self.opened()
        self.assertEqual(code, 0)
        self.assertEqual(body["lane"], "review")
        self.assertEqual(self.forge.states, {70: "factory:review"})
        self.assertEqual(self.forge.labels, [])
        self.assertNotIn(("PATCH", "/pulls/70", {"state": "closed"}), self.forge.calls)

    def test_limits_come_from_config(self):
        self.assertEqual((factory.CFG["max_pr_files"], factory.CFG["max_pr_lines"]), (50, 3000))
        self.assertIn("*.gen.ts", factory.CFG["generated_paths"])


class Retry(unittest.TestCase):
    def test_retry_keeps_the_issue_wip_while_its_pr_is_open(self):
        forge = RecordingForge("factory/7")
        code, body = run(factory.cmd_retry, FakeStore(tempfile.gettempdir()), forge, "70")
        self.assertEqual(code, 0)
        self.assertEqual(forge.states, {7: "factory:wip", 70: "factory:changes"})


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Origin:
    """Bare origin with a staging branch, a clone acting as the train slot, and PR branches."""

    def __init__(self, tmp, base="staging"):
        self.base = base
        self.bare, self.work = Path(tmp) / "origin.git", Path(tmp) / "work"
        git(tmp, "init", "-q", "--bare", "-b", self.base, str(self.bare))
        git(tmp, "clone", "-q", str(self.bare), str(self.work))
        for key, value in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")):
            git(self.work, "config", key, value)
        self.commit(self.base, {"README": "base\n", "bun.lock": "lock\n"}, new=True)

    def commit(self, branch, files, new=False):
        start = [] if new else [f"origin/{self.base}"]
        git(self.work, "switch", "-q", "-C", branch, *start) if not new else git(self.work, "switch", "-q", "-c", branch)
        for name, text in files.items():
            (self.work / name).parent.mkdir(parents=True, exist_ok=True)
            (self.work / name).write_text(text)
        git(self.work, "add", "-A")
        git(self.work, "commit", "-q", "-m", f"feat: {branch}")
        git(self.work, "push", "-q", "origin", f"{branch}:{branch}")
        git(self.work, "fetch", "-q", "origin")

    def pr(self, number, files):
        branch = f"factory/{number + 100}"
        self.commit(branch, files)
        return {"pr": number, "issue": number + 100, "branch": branch, "title": f"feat: pr {number}"}

    def tree(self, ref):
        git(self.work, "fetch", "-q", "origin")
        return git(self.work, "rev-parse", f"{ref}^{{tree}}")


class GitForge:
    """GitHub stand-in: merges PR branches into origin staging with a merge commit, as the API does."""

    def __init__(self, origin, prs):
        self.origin, self.branches = origin, {p["pr"]: p["branch"] for p in prs}
        self.merged, self.labels, self.slow = [], {}, set()
        self.status = "none"
        self.scratch = Path(origin.work).parent / "github"
        git(origin.work.parent, "clone", "-q", str(origin.bare), str(self.scratch))
        git(self.scratch, "config", "user.name", "gh")
        git(self.scratch, "config", "user.email", "gh@gh")

    def label(self, number):
        return self.labels.get(number, "factory:approved")

    def tip(self, branch):
        return git(self.origin.work, "ls-remote", "origin", f"refs/heads/{branch}").split()[0]

    def call(self, method, path, body=None):
        if method == "GET" and path.startswith("/pulls/"):
            number = int(path.rsplit("/", 1)[1])
            branch = self.branches[number]
            return {"number": number, "title": f"feat: pr {number}", "labels": [{"name": self.label(number)}],
                    "mergeable": None if number in self.slow else True,
                    "head": {"ref": branch, "sha": self.tip(branch)}}
        return None

    def open_pulls(self):
        return [{"number": n, "title": f"feat: pr {n}", "labels": [{"name": self.label(n)}], "head": {"ref": b}}
                for n, b in self.branches.items() if n not in self.merged]

    def open_issues(self):
        return []

    def closed_numbers(self):
        return set()

    def labels_of(self, number):
        return [self.label(number)] if self.label(number) else []

    def combined_status(self, sha):
        return self.status

    def merge(self, pr, title, sha):
        if self.tip(self.branches[pr]) != sha:
            raise SystemExit(f"github PUT /pulls/{pr}/merge: 409 Head branch was modified")
        git(self.scratch, "fetch", "-q", "origin")
        git(self.scratch, "switch", "-q", "-C", "s", f"origin/{self.origin.base}")
        git(self.scratch, "merge", "-q", "--no-ff", "--no-edit", f"origin/{self.branches[pr]}")
        git(self.scratch, "push", "-q", "origin", f"s:{self.origin.base}", f":{self.branches[pr]}")
        self.merged.append(pr)

    def set_state(self, number, state):
        self.labels[number] = state

    def comment(self, number, body):
        pass


class Train(unittest.TestCase):
    def setUp(self):
        profile = mock.patch.dict(factory.CFG, {"base": "staging", "require_ci": False})
        profile.start()
        self.addCleanup(profile.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.origin = Origin(tmp.name)
        cwd = os.getcwd()
        os.chdir(self.origin.work)
        self.addCleanup(os.chdir, cwd)

    def test_three_approved_prs_make_one_train(self):
        prs = [self.origin.pr(n, {f"{n}.txt": f"{n}\n"}) for n in (1, 2, 3)]
        train = factory.build_train(self.origin.work, prs)
        self.assertEqual([p["pr"] for p in train["prs"]], [1, 2, 3])
        self.assertEqual(train["dropped"], [])
        for n in (1, 2, 3):
            self.assertTrue((self.origin.work / f"{n}.txt").exists())


    def test_a_conflicting_pr_is_dropped_and_the_rest_stay(self):
        prs = [self.origin.pr(1, {"README": "one\n"}), self.origin.pr(2, {"README": "two\n"}),
               self.origin.pr(3, {"3.txt": "3\n"})]
        train = factory.build_train(self.origin.work, prs)
        self.assertEqual([p["pr"] for p in train["prs"]], [1, 3])
        self.assertEqual([(d["pr"], d["files"]) for d in train["dropped"]], [(2, ["README"])])

    def test_a_conflict_only_in_generated_files_keeps_the_pr(self):
        prs = [self.origin.pr(1, {"bun.lock": "one\n"}), self.origin.pr(2, {"bun.lock": "two\n", "2.txt": "2\n"})]
        train = factory.build_train(self.origin.work, prs)
        self.assertEqual([p["pr"] for p in train["prs"]], [1, 2])
        self.assertEqual((self.origin.work / "bun.lock").read_text(), "one\n")


    def test_landing_merges_each_pr_and_staging_ends_on_the_train_tree(self):
        prs = [self.origin.pr(n, {f"{n}.txt": f"{n}\n"}) for n in (1, 2, 3)]
        train = factory.build_train(self.origin.work, prs)
        (self.origin.work / "bun.lock").write_text("regenerated\n")
        git(self.origin.work, "commit", "-qam", "chore: regenerate after merge")
        forge = GitForge(self.origin, prs)
        landed = factory.land_train(self.origin.work, forge, train["prs"], train["base"])
        self.assertEqual(forge.merged, [1, 2, 3])
        self.assertEqual(landed["merged"], [1, 2, 3])
        self.assertTrue(landed["tree_match"])
        self.assertEqual(self.origin.tree("origin/staging"), self.origin.tree(factory.TRAIN))


    def test_two_prs_appending_a_line_to_a_note_file_land_in_one_train(self):
        notes = "apps/web/TESTING.md"
        self.origin.commit("staging", {".gitattributes": (HERE.parents[1] / ".gitattributes").read_text(),
                                       notes: "# Testing\n\n- base\n"})
        prs = [self.origin.pr(1, {notes: "# Testing\n\n- base\n- one\n"}),
               self.origin.pr(2, {notes: "# Testing\n\n- base\n- two\n"})]
        train = factory.build_train(self.origin.work, prs)
        self.assertEqual(([p["pr"] for p in train["prs"]], train["dropped"]), ([1, 2], []))
        text = (self.origin.work / notes).read_text()
        self.assertEqual(sorted(text.split("- ")[1:]), ["base\n", "one\n", "two\n"])
        forge = GitForge(self.origin, prs)
        landed = factory.land_train(self.origin.work, forge, train["prs"], train["base"])
        self.assertEqual((landed["merged"], landed["tree_match"]), ([1, 2], True))

    def two_prs_editing_the_same_line(self, path):
        self.origin.commit("staging", {".gitattributes": (HERE.parents[1] / ".gitattributes").read_text(),
                                       path: "# Guide\n\n- base\n"})
        prs = [self.origin.pr(1, {path: "# Guide\n\n- one\n"}),
               self.origin.pr(2, {path: "# Guide\n\n- two\n"})]
        train = factory.build_train(self.origin.work, prs)
        return [p["pr"] for p in train["prs"]], [d["pr"] for d in train["dropped"]]

    def test_two_prs_editing_one_line_of_an_app_guide_both_land(self):
        self.assertEqual(self.two_prs_editing_the_same_line("apps/worker/AGENTS.md"), ([1, 2], []))

    def test_two_prs_editing_one_line_of_the_root_routing_file_conflict(self):
        self.assertEqual(self.two_prs_editing_the_same_line("AGENTS.md"), ([1], [2]))

    def test_two_prs_editing_one_line_of_a_package_guide_conflict(self):
        self.assertEqual(self.two_prs_editing_the_same_line("packages/env/AGENTS.md"), ([1], [2]))

    def test_a_train_rebuilt_without_a_failing_pr_lands_the_rest(self):
        prs = [self.origin.pr(n, {f"{n}.txt": f"{n}\n"}) for n in (1, 2, 3)]
        factory.build_train(self.origin.work, prs)
        train = factory.build_train(self.origin.work, [prs[0], prs[2]])
        forge = GitForge(self.origin, prs)
        landed = factory.land_train(self.origin.work, forge, train["prs"], train["base"])
        self.assertEqual(forge.merged, [1, 3])
        self.assertTrue(landed["tree_match"])
        self.assertFalse((self.origin.work / "2.txt").exists())


class ConfiguredTrain(unittest.TestCase):
    def test_train_waits_for_ci_and_lands_with_correct_merge_titles(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(factory.CFG, {"require_ci": True}):
            origin = Origin(tmp, base=factory.CFG["base"])
            prs = [origin.pr(n, {f"{n}.txt": f"{n}\n"}) for n in (1, 2)]
            forge = GitForge(origin, prs)
            train = factory.build_train(origin.work, prs)
            for status in ("none", "pending"):
                forge.status = status
                self.assertEqual(factory.merge_pr(forge, 1)["result"], "wait")
                self.assertEqual(forge.merged, [])
            forge.status = "success"
            with mock.patch.object(slots, "main_root", return_value=origin.work):
                result = factory.land_train(origin.work, forge, train["prs"], train["base"])
            self.assertEqual(result["merged"], [1, 2])
            self.assertTrue(result["tree_match"])
            base = factory.CFG["base"]
            self.assertIn(f"chore: merge {base} into factory/102", git(origin.work, "log", f"origin/{base}", "--format=%s"))

    def test_only_configured_generated_conflicts_are_kept_for_regeneration(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin = Origin(tmp, base=factory.CFG["base"])
            prs = [origin.pr(1, {"generated/schema.sql": "one\n"}),
                   origin.pr(2, {"generated/schema.sql": "two\n"})]
            with mock.patch.dict(factory.CFG, {"generated_conflict_paths": ["generated/*.sql"]}):
                train = factory.build_train(origin.work, prs)
            self.assertEqual([p["pr"] for p in train["prs"]], [1, 2])
            self.assertEqual(train["dropped"], [])

    def test_disabled_gap_epic_refuses_before_any_tracker_request(self):
        forge = RecordingForge("factory/1")
        with self.assertRaisesRegex(SystemExit, "ui_epic"):
            factory.cmd_gap(None, forge, "unused.md")
        self.assertEqual(forge.calls, [])


class LocalCommands(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        cwd = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)
        self.cfg = {**factory.CFG, "commands": {
            "gate": [self.record("gate")],
            "train_gate": [self.record("train")],
            "regenerate": [self.record("regenerate")],
        }}
        patcher = mock.patch.object(factory, "CFG", self.cfg)
        patcher.start()
        self.addCleanup(patcher.stop)

    def record(self, text):
        return [sys.executable, "-c", f"from pathlib import Path; p=Path('steps'); p.write_text((p.read_text() if p.exists() else '') + '{text}\\n')"]

    def test_local_gate_runs_without_authentication_or_factory_state(self):
        with mock.patch.object(factory, "Forge", side_effect=AssertionError("local command authenticated")):
            code, result = run(factory.main, ["gate"])
        self.assertEqual(code, 0)
        self.assertEqual((self.root / "steps").read_text(), "gate\n")
        self.assertFalse((self.root / ".factory").exists())

    def test_train_gate_runs_regular_gate_then_train_commands(self):
        run(factory.main, ["gate", "--train"])
        self.assertEqual((self.root / "steps").read_text(), "gate\ntrain\n")

    def test_gate_failure_stops_before_other_commands(self):
        self.cfg["commands"]["gate"] = [[sys.executable, "-c", "raise SystemExit(7)"], self.record("later")]
        with self.assertRaises(subprocess.CalledProcessError) as failure:
            factory.main(["gate", "--train"])
        self.assertEqual(failure.exception.returncode, 7)
        self.assertFalse((self.root / "steps").exists())

    def test_empty_gate_refuses_to_report_success(self):
        for commands in ({}, {"gate": []}):
            with self.subTest(commands=commands):
                self.cfg["commands"] = commands
                with self.assertRaisesRegex(SystemExit, "gate"):
                    factory.main(["gate"])

    def test_regeneration_runs_only_configured_commands(self):
        run(factory.main, ["regenerate"])
        self.assertEqual((self.root / "steps").read_text(), "regenerate\n")

    def test_config_is_readable_without_authentication(self):
        with mock.patch.object(factory, "Forge", side_effect=AssertionError("config authenticated")):
            code, result = run(factory.main, ["config"])
        self.assertEqual(result["repo"], "SunReye/SunReye")
        self.assertFalse((self.root / ".factory").exists())


class DetachedGate(unittest.TestCase):
    """`gate --detach` runs the gate in the background; `gate-wait` reports it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        cwd = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)
        self.release = self.root / "release"
        self.addCleanup(self.release.write_text, "")
        self.cfg = {**factory.CFG, "commands": {"gate": [self.step("print('ran gate')")],
                                                "train_gate": [self.step("print('ran train')")]}}
        for patcher in (mock.patch.object(factory, "CFG", self.cfg),
                        # The CLI exits after spawning; here the test process outlives the gate it spawned.
                        mock.patch.object(subprocess.Popen, "__del__", lambda proc: None),
                        mock.patch.dict(os.environ, {"FACTORY_SLOT": "impl-1"}),
                        mock.patch.object(slots, "GATE_WAIT_SECONDS", 0.5),
                        mock.patch.object(slots, "GATE_POLL_SECONDS", 0.02)):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.logs = self.root / ".factory" / "logs"

    def step(self, code):
        return [sys.executable, "-c", code]

    def blocked_gate(self):
        """A gate that holds until the release file exists."""
        self.cfg["commands"]["gate"] = [self.step(
            "import time, pathlib\nr = pathlib.Path('release')\n"
            "for _ in range(1500):\n    if r.exists(): break\n    time.sleep(0.02)")]

    def detach(self, *args):
        return run(factory.main, ["gate", "--detach", *args])

    def wait(self, *args):
        return run(factory.main, ["gate-wait", *args])

    def test_detach_prints_both_paths_and_returns_before_the_gate_ends(self):
        self.blocked_gate()
        code, result = self.detach()
        self.assertEqual(code, 0)
        self.assertEqual(result["log"], str(self.logs / "gate-impl-1.log"))
        self.assertEqual(result["exit"], str(self.logs / "gate-impl-1.exit"))
        self.assertFalse((self.logs / "gate-impl-1.exit").exists())

    def test_a_running_gate_reports_running(self):
        self.blocked_gate()
        self.detach()
        code, result = self.wait()
        self.assertEqual((code, result), (0, {"status": "running"}))

    def test_a_passing_gate_reports_exit_zero_and_writes_the_exit_file(self):
        self.detach()
        slots.GATE_WAIT_SECONDS = 20
        code, result = self.wait()
        self.assertEqual((code, result), (0, {"status": "passed", "exit": 0}))
        self.assertEqual((self.logs / "gate-impl-1.exit").read_text().strip(), "0")
        self.assertIn("ran gate", (self.logs / "gate-impl-1.log").read_text())

    def test_a_running_gate_that_ends_while_waiting_is_reported_without_the_full_wait(self):
        self.blocked_gate()
        self.detach()
        self.release.write_text("")
        slots.GATE_WAIT_SECONDS = 20
        self.assertEqual(self.wait()[1], {"status": "passed", "exit": 0})

    def test_a_failing_gate_reports_its_exit_code_and_log_tail(self):
        noise = "\n".join(f"line {i}" for i in range(100))
        self.cfg["commands"]["gate"] = [self.step(f"print({noise!r}); print('boom'); raise SystemExit(3)")]
        self.detach()
        slots.GATE_WAIT_SECONDS = 20
        code, result = self.wait()
        self.assertEqual((code, result["status"]), (0, "failed"))
        self.assertEqual(result["exit"], 3)
        self.assertIn("boom", result["tail"])
        self.assertIn("line 99", result["tail"])
        self.assertNotIn("line 0\n", result["tail"])

    def test_the_train_flag_adds_the_train_gate(self):
        self.detach("--train")
        slots.GATE_WAIT_SECONDS = 20
        self.wait()
        log = (self.logs / "gate-impl-1.log").read_text()
        self.assertLess(log.index("ran gate"), log.index("ran train"))

    def test_a_train_step_is_skipped_after_a_failing_gate_step(self):
        self.cfg["commands"]["gate"] = [self.step("raise SystemExit(5)")]
        self.detach("--train")
        slots.GATE_WAIT_SECONDS = 20
        self.assertEqual(self.wait()[1]["status"], "failed")
        self.assertNotIn("ran train", (self.logs / "gate-impl-1.log").read_text())

    def test_wait_without_a_started_gate_refuses(self):
        code, _ = self.wait()
        self.assertNotEqual(code, 0)
        self.assertIn("no gate", str(code))

    def test_a_second_detach_while_one_runs_is_refused(self):
        self.blocked_gate()
        self.detach()
        code, _ = self.detach()
        self.assertIn("already running", str(code))

    def test_a_new_detach_after_the_last_one_ended_starts_fresh(self):
        self.cfg["commands"]["gate"] = [self.step("raise SystemExit(5)")]
        self.detach()
        slots.GATE_WAIT_SECONDS = 20
        self.assertEqual(self.wait()[1]["status"], "failed")
        self.cfg["commands"]["gate"] = [self.step("print('second')")]
        self.detach()
        self.assertEqual(self.wait()[1], {"status": "passed", "exit": 0})
        self.assertNotIn("raise", (self.logs / "gate-impl-1.log").read_text())

    def test_a_gate_killed_without_an_exit_file_is_reported_failed(self):
        self.cfg["commands"]["gate"] = [self.step("import os; os.kill(os.getppid(), 9)")]
        self.detach()
        slots.GATE_WAIT_SECONDS = 20
        code, result = self.wait()
        self.assertEqual((code, result["status"]), (0, "failed"))
        self.assertIn("died", result["tail"])

    def test_slots_keep_separate_logs_and_wait_takes_a_slot(self):
        self.blocked_gate()
        self.detach()
        with mock.patch.dict(os.environ, {"FACTORY_SLOT": "merge-1"}):
            self.cfg["commands"]["gate"] = [self.step("print('merge gate')")]
            self.detach()
            slots.GATE_WAIT_SECONDS = 20
            self.assertEqual(self.wait()[1], {"status": "passed", "exit": 0})
        slots.GATE_WAIT_SECONDS = 0.2
        self.assertEqual(self.wait("--slot", "impl-1")[1], {"status": "running"})
        self.assertIn("merge gate", (self.logs / "gate-merge-1.log").read_text())

    def test_detach_needs_a_slot(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("FACTORY_SLOT")
            code, _ = self.detach()
        self.assertIn("slot", str(code))

    def test_detach_with_an_empty_gate_refuses(self):
        self.cfg["commands"]["gate"] = []
        code, _ = self.detach()
        self.assertIn("gate", str(code))
        self.assertFalse((self.logs / "gate-impl-1.log").exists())


class SlotCleanup(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.cfg = {**factory.CFG, "clean_paths": ["cache"]}
        self.store = FakeStore(self.root)
        self.store.cfg = self.cfg
        self.store.slot_path = lambda slot: self.root / slot
        self.path = self.store.slot_path("impl-1")
        (self.path / "cache").mkdir(parents=True)
        (self.path / "apps/worker/.cloudflare").mkdir(parents=True)

    def test_release_removes_only_configured_state_and_keeps_small_install(self):
        (self.path / "node_modules").mkdir()
        slots.clean_slot(self.store, "impl-1")
        self.assertFalse((self.path / "cache").exists())
        self.assertTrue((self.path / "apps/worker/.cloudflare").is_dir())
        self.assertTrue((self.path / "node_modules").is_dir())

    def test_cleanup_refuses_root_parent_absolute_paths_and_symlink_escapes(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.path / "escape").symlink_to(outside, target_is_directory=True)
        for value in (".", "..", str(outside), "escape"):
            with self.subTest(path=value):
                self.cfg["clean_paths"] = [value]
                with self.assertRaisesRegex(SystemExit, "cleanup"):
                    slots.clean_slot(self.store, "impl-1")
                self.assertTrue(outside.exists())
                self.assertTrue(self.path.exists())


class SlotPreparation(unittest.TestCase):
    def test_slot_runs_configured_commands_without_a_worker_app_and_reuses_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin = Origin(tmp)
            cfg = {**factory.CFG, "base": "staging", "commands": {
                "install": [[sys.executable, "-c",
                    "from pathlib import Path; Path('node_modules').mkdir(); Path('installed').write_text('once')"]],
                "prepare": [[sys.executable, "-c",
                    "from pathlib import Path; Path('prepared').write_text('ready')"]],
            }}
            with mock.patch.object(slots, "main_root", return_value=origin.work):
                store = slots.Store(cfg)
            first = slots.prepare(store, "impl-1", "factory/1", new_branch=True)
            path = Path(first["path"])
            self.assertEqual((path / "installed").read_text(), "once")
            self.assertEqual((path / "prepared").read_text(), "ready")
            self.assertEqual(git(path, "branch", "--show-current"), "factory/1")
            second = slots.prepare(store, "impl-1", "factory/2", new_branch=True)
            self.assertEqual(second["path"], first["path"])
            self.assertTrue((path / "node_modules").is_dir())
            self.assertFalse((path / "installed").exists())  # clean removes untracked output
            self.assertEqual((path / "prepared").read_text(), "ready")

    def test_checkout_keeps_the_slot_target_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin = Origin(tmp)
            cfg = {**factory.CFG, "base": "staging", "commands": {"install": [], "prepare": []}}
            with mock.patch.object(slots, "main_root", return_value=origin.work):
                store = slots.Store(cfg)
            path = Path(slots.prepare(store, "impl-1", "factory/1", new_branch=True)["path"])
            (path / "target" / "debug").mkdir(parents=True)
            slots.prepare(store, "impl-1", "factory/2", new_branch=True)
            self.assertTrue((path / "target" / "debug").is_dir())


class Gc(unittest.TestCase):
    def test_orphan_slots_left_by_a_smaller_pool_are_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin = Origin(tmp)
            cfg = {**factory.CFG, "base": "staging", "slots": {"impl": 2, "merge": 1},
                   "commands": {"install": [], "prepare": []}}
            with mock.patch.object(slots, "main_root", return_value=origin.work):
                store = slots.Store(cfg)
            slots.prepare(store, "impl-1", "factory/1", new_branch=True)
            slots.prepare(store, "impl-2", "factory/2", new_branch=True)
            store.cfg = {**cfg, "slots": {"impl": 1, "merge": 1}}
            (store.dir / "slots" / "impl-5" / "target").mkdir(parents=True)
            removed = slots.remove_orphan_slots(store)
            self.assertEqual(sorted(removed), ["impl-2", "impl-5"])
            self.assertTrue(store.slot_path("impl-1").is_dir())
            self.assertFalse(store.slot_path("impl-2").exists())
            self.assertFalse(store.slot_path("impl-5").exists())
            self.assertTrue((store.dir / "slots" / "impl-1.env").exists())
            self.assertNotIn("impl-2", git(origin.work, "worktree", "list"))

    def test_gc_prunes_dangling_docker_images_without_failing_on_docker(self):
        calls = []

        def fake_sh(*args, cwd=None, check=True):
            calls.append((args, check))
            return ""

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(slots, "sh", side_effect=fake_sh):
            store = FakeStore(tmp)
            store.slot_path = lambda slot: store.dir / "slots" / slot
            slots.gc(store, {"slots": {}})
        self.assertIn((("docker", "image", "prune", "-f"), False), calls)


class StateStore:
    """Store with persistent state whose merge slot is the Origin clone."""

    def __init__(self, origin):
        self.cfg, self.root, self.work = factory.CFG, origin.work.parent, origin.work
        self.dir = self.root / ".factory"
        (self.dir / "reviews").mkdir(parents=True)
        self.state = {"slots": {}, "attempts": {}, "runs": {}, "routes": {}}

    @contextlib.contextmanager
    def locked(self):
        yield self.state

    def slot_ids(self, kind):
        return [f"{kind}-{i}" for i in range(1, self.cfg["slots"][kind] + 1)]

    def slot_path(self, slot):
        return self.work


def fake_prepare(store, slot, branch, new_branch=False):
    return {"slot": slot, "path": str(store.slot_path(slot)), "env": "/dev/null", "branch": branch}


class TrainCommands(unittest.TestCase):
    def setUp(self):
        profile = mock.patch.dict(factory.CFG, {"base": "staging", "require_ci": False})
        profile.start()
        self.addCleanup(profile.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.origin = Origin(tmp.name)
        cwd = os.getcwd()
        os.chdir(self.origin.work)
        self.addCleanup(os.chdir, cwd)
        self.store = StateStore(self.origin)
        patcher = mock.patch.object(factory.slots, "prepare", fake_prepare)
        patcher.start()
        self.addCleanup(patcher.stop)

    def prs(self, *numbers, files=None):
        prs = [self.origin.pr(n, (files or {}).get(n, {f"{n}.txt": f"{n}\n"})) for n in numbers]
        self.forge = GitForge(self.origin, prs)
        return prs

    def train(self, *args):
        code, body = run(factory.cmd_train, self.store, self.forge, *args)
        self.assertEqual(code, 0)
        return body

    def land(self):
        code, body = run(factory.cmd_land, self.store, self.forge)
        self.assertEqual(code, 0)
        return body

    def test_a_train_takes_at_most_five_approved_prs(self):
        self.prs(1, 2, 3, 4, 5, 6)
        self.assertEqual(self.train()["prs"], [1, 2, 3, 4, 5])

    def test_the_largest_approved_pr_lands_first(self):
        self.prs(1, 2, 3, files={1: {"a.txt": "1\n"}, 2: {"b.txt": "1\n2\n3\n"}, 3: {"c.txt": "1\n2\n"}})
        self.assertEqual(self.train()["prs"], [2, 3, 1])

    def test_the_smallest_prs_wait_when_more_than_the_train_takes(self):
        files = {n: {f"{n}.txt": "x\n" * n} for n in range(1, 8)}
        self.prs(*range(1, 8), files=files)
        self.assertEqual(self.train()["prs"], [7, 6, 5, 4, 3])

    def test_equal_sizes_go_by_lower_pr_number_and_generated_files_do_not_count(self):
        self.prs(5, 3, 4, files={5: {"a.txt": "x\n"}, 3: {"b.txt": "x\n"}, 4: {"c.txt": "x\n", "d.gen.ts": "y\n" * 50}})
        self.assertEqual(self.train()["prs"], [3, 4, 5])

    def test_drop_rebuilds_the_train_and_records_the_gate_drop(self):
        self.prs(1, 2, 3)
        self.train()
        body = self.train("--drop", "2")
        self.assertEqual(body["prs"], [1, 3])
        self.assertEqual(body["dropped"], [{"pr": 2, "reason": "gate"}])
        self.assertFalse((self.origin.work / "2.txt").exists())

    def test_land_lists_conflict_and_gate_drops_as_changes(self):
        self.prs(1, 2, 3, 4, files={1: {"README": "one\n"}, 2: {"README": "two\n"}})
        self.assertEqual(self.train()["dropped"], [{"pr": 2, "reason": "conflict"}])
        self.train("--drop", "4")
        body = self.land()
        self.assertEqual(body["merged"], [1, 3])
        self.assertEqual(body["changes"], [2, 4])
        self.assertTrue(body["tree_match"])

    def test_releasing_a_stopped_train_sends_its_dropped_prs_back_to_changes(self):
        self.prs(1, 2, 3, files={1: {"README": "one\n"}, 2: {"README": "two\n"}})
        self.train()
        self.train("--drop", "3")
        run(factory.cmd_release, self.store, self.forge, "merge-1")
        self.assertEqual({n: self.forge.label(n) for n in (1, 2, 3)},
                         {1: "factory:approved", 2: "factory:changes", 3: "factory:changes"})

    def test_a_dropped_pr_approved_again_after_the_train_stays_approved_on_release(self):
        self.prs(1, 2, 3, files={1: {"README": "one\n"}, 2: {"README": "two\n"}})
        self.train()
        self.push_to("factory/102")
        run(factory.cmd_release, self.store, self.forge, "merge-1")
        self.assertEqual({n: self.forge.label(n) for n in (1, 2, 3)},
                         {1: "factory:approved", 2: "factory:approved", 3: "factory:approved"})

    def test_staging_moving_after_the_gate_stops_landing_before_any_push(self):
        self.prs(1, 2)
        self.train()
        before = self.forge.tip("factory/101")
        self.push_to_staging()
        body = self.land()
        self.assertEqual(body["merged"], [])
        self.assertEqual(body["stopped"], {"pr": 1, "result": "stale-base"})
        self.assertEqual(self.forge.tip("factory/101"), before)

    def test_staging_moving_between_two_train_merges_stops_the_next_one(self):
        self.prs(1, 2)
        self.train()
        merge = self.forge.merge

        def merge_then_hotfix(pr, title, sha):
            merge(pr, title, sha)
            self.push_to_staging()
        self.forge.merge = merge_then_hotfix
        before = self.forge.tip("factory/102")
        body = self.land()
        self.assertEqual(body["merged"], [1])
        self.assertEqual(body["stopped"], {"pr": 2, "result": "stale-base"})
        self.assertEqual(self.forge.tip("factory/102"), before)

    def test_a_pr_no_longer_approved_is_not_landed(self):
        self.prs(1, 2)
        self.train()
        self.forge.labels[2] = "factory:human"
        body = self.land()
        self.assertEqual(body["merged"], [1])
        self.assertEqual(body["stopped"], {"pr": 2, "result": "moved"})

    def test_a_pr_with_a_new_commit_is_not_landed(self):
        self.prs(1, 2)
        self.train()
        self.push_to("factory/102")
        body = self.land()
        self.assertEqual(body["merged"], [1])
        self.assertEqual(body["stopped"], {"pr": 2, "result": "moved"})

    def test_a_rejected_push_stops_landing_with_json(self):
        self.prs(1, 2)
        self.train()
        call = self.forge.call

        def call_then_push(method, path, body=None):
            res = call(method, path, body)
            if path == "/pulls/2" and not hasattr(self, "pushed"):
                self.pushed = self.push_to("factory/102")
            return res
        self.forge.call = call_then_push
        body = self.land()
        self.assertEqual(body["merged"], [1])
        self.assertEqual(body["stopped"]["result"], "push-rejected")

    def test_github_refuses_a_head_that_moved_after_the_push(self):
        self.prs(1, 2)
        self.train()
        self.forge.combined_status = lambda sha: self.push_to("factory/101") and "none"
        body = self.land()
        self.assertEqual((body["merged"], self.forge.merged), ([], []))
        self.assertEqual(body["stopped"]["result"], "error")
        self.assertIn("409", body["stopped"]["error"])

    def test_a_slow_github_merge_stays_merging_until_the_dispatcher_merges_it(self):
        self.prs(1, 2, 3)
        self.train()
        self.forge.slow.add(2)
        with mock.patch.object(factory.time, "sleep"):
            body = self.land()
        self.assertEqual(body["merged"], [1])
        self.assertEqual(body["stopped"], {"pr": 2, "result": "wait"})
        status = run(factory.cmd_status, self.store, self.forge)[1]
        self.assertEqual([p["pr"] for p in status["prs"]["merging"]], [2])
        self.forge.slow.clear()
        self.assertEqual(run(factory.cmd_merge, self.store, self.forge, "2")[1]["result"], "merged")
        self.assertEqual(self.forge.merged, [1, 2])

    def push_to(self, branch):
        git(self.origin.work, "fetch", "-q", "origin")
        git(self.origin.work, "worktree", "add", "-q", "--detach", "../late", f"origin/{branch}")
        late = self.origin.work.parent / "late"
        (late / "late.txt").write_text(branch + "\n")
        git(late, "add", "-A")
        git(late, "commit", "-qm", "late")
        git(late, "push", "-q", "origin", f"HEAD:{branch}")
        git(self.origin.work, "worktree", "remove", "--force", str(late))
        return True

    def push_to_staging(self):
        self.push_to("staging")


if __name__ == "__main__":
    unittest.main()
