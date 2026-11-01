"""Exercise the Claude hook through its stdin/exit-code interface."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

GUARD = Path(__file__).resolve().parents[2] / '.claude/hooks/factory-guard.py'


class Guard(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.guard = self.root / '.claude/hooks/factory-guard.py'
        self.guard.parent.mkdir(parents=True)
        shutil.copyfile(GUARD, self.guard)
        self.config = self.root / 'scripts/factory/config.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text(json.dumps({'base': 'integration', 'protected_branches': ['release']}))

    def invoke(self, command):
        event = {'tool_name': 'Bash', 'tool_input': {'command': command}}
        return subprocess.run([sys.executable, '-B', str(self.guard)], input=json.dumps(event),
                              capture_output=True, text=True, cwd=self.root)

    def test_configured_base_and_release_branches_refuse_direct_pushes(self):
        for command in ('git push origin integration', 'git push origin HEAD:refs/heads/release'):
            with self.subTest(command=command):
                self.assertEqual(self.invoke(command).returncode, 2)

    def test_normal_explicit_factory_branch_push_is_allowed(self):
        self.assertEqual(self.invoke('git push -u origin factory/123').returncode, 0)

    def test_implicit_push_refuses_unknown_destination(self):
        for command in ('git push', 'git push origin', 'git push origin HEAD'):
            with self.subTest(command=command):
                self.assertEqual(self.invoke(command).returncode, 2)

    def test_force_push_and_hook_bypass_stay_blocked(self):
        for command in ('git push --force origin factory/123', 'git push --force-with-lease origin factory/123', 'git commit --no-verify', 'HUSKY=0 git commit'):
            with self.subTest(command=command):
                self.assertEqual(self.invoke(command).returncode, 2)

    def test_merges_must_use_factory_control_plane(self):
        for command in ('gh pr merge 12', 'gh --repo owner/repo pr merge 12', 'fj pr merge 12'):
            with self.subTest(command=command):
                self.assertEqual(self.invoke(command).returncode, 2)
        self.assertEqual(self.invoke('scripts/factory/factory merge 12').returncode, 0)

    def test_unreadable_config_blocks_instead_of_silently_disabling_hook(self):
        for contents in ('{', '{}'):
            with self.subTest(contents=contents):
                self.config.write_text(contents)
                self.assertEqual(self.invoke('git push origin factory/123').returncode, 2)
