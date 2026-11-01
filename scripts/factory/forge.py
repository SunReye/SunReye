"""GitHub REST client for the factory. The token comes from `gh auth token` and is never printed."""

import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

STATE_LABELS = ("factory:wip", "factory:review", "factory:changes", "factory:approved",
                "factory:merging", "factory:human")
LABEL_COLOURS = {"factory:wip": "fbca04", "factory:review": "1d76db", "factory:changes": "d93f0b",
                 "factory:approved": "0e8a16", "factory:merging": "5319e7", "factory:human": "b60205",
                 "factory:deep": "c5def5", "factory:split": "c5def5", "factory:oracle": "c5def5",
                 "parity-finding": "e99695"}


class Forge:
    def __init__(self, cfg):
        host = cfg["host"]
        # GitHub Enterprise Server serves the REST API under /api/v3.
        base = "https://api.github.com" if host == "github.com" else f"https://{host}/api/v3"
        self.api = f"{base}/repos/{cfg['repo']}"
        self._token = subprocess.run(["gh", "auth", "token", "--hostname", host], check=True,
                                     capture_output=True, text=True).stdout.strip()
        self._labels = None

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.api + path, method=method, data=data, headers={
            "Authorization": f"Bearer {self._token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as err:
            raise SystemExit(f"github {method} {path}: {err.code} {err.read()[:300]!r}") from None
        return json.loads(raw) if raw else None

    def paged(self, path):
        sep = "&" if "?" in path else "?"
        out, page = [], 1
        while True:
            batch = self.call("GET", f"{path}{sep}per_page=100&page={page}")
            if not batch:
                return out
            out += batch
            page += 1

    def open_issues(self):
        # The issues endpoint lists pull requests too.
        return [i for i in self.paged("/issues?state=open") if "pull_request" not in i]

    def closed_numbers(self):
        return {i["number"] for i in self.paged("/issues?state=closed") if "pull_request" not in i}

    def open_pulls(self):
        return self.paged("/pulls?state=open")

    def label_names(self):
        if self._labels is None:
            self._labels = {lab["name"] for lab in self.paged("/labels")}
        return self._labels

    def ensure_labels(self):
        existing = self.label_names()
        for name, colour in LABEL_COLOURS.items():
            if name not in existing:
                self.call("POST", "/labels", {"name": name, "color": colour})
                existing.add(name)
        return sorted(LABEL_COLOURS)

    def labels_of(self, number):
        return [lab["name"] for lab in self.call("GET", f"/issues/{number}/labels")]

    def set_state(self, number, state):
        """Replace the factory state label of an issue or PR; state None clears it."""
        for name in self.labels_of(number):
            if name in STATE_LABELS and name != state:
                self.remove_label(number, name)
        if state:
            self.add_label(number, state)

    def add_label(self, number, name):
        if name not in self.label_names():
            self.ensure_labels()
        self.call("POST", f"/issues/{number}/labels", {"labels": [name]})

    def remove_label(self, number, name):
        self.call("DELETE", f"/issues/{number}/labels/{urllib.parse.quote(name, safe='')}")

    def comment(self, number, body):
        self.call("POST", f"/issues/{number}/comments", {"body": body})

    def combined_status(self, sha):
        """success, failure, pending or none, over commit statuses and Actions check runs."""
        ref = urllib.parse.quote(sha)
        states = [s["state"] for s in self.call("GET", f"/commits/{ref}/status")["statuses"]]
        for run in self.call("GET", f"/commits/{ref}/check-runs?per_page=100")["check_runs"]:
            if run["status"] != "completed":
                states.append("pending")
            elif run["conclusion"] in ("success", "neutral", "skipped"):
                states.append("success")
            else:
                states.append("failure")
        if not states:
            return "none"
        if any(s in ("failure", "error") for s in states):
            return "failure"
        return "pending" if "pending" in states else "success"

    def merge(self, pr, title, sha):
        """sha: GitHub refuses the merge when the head moved past it."""
        pr_obj = self.call("GET", f"/pulls/{pr}")
        self.call("PUT", f"/pulls/{pr}/merge", {"merge_method": "merge", "commit_title": title, "sha": sha})
        branch = urllib.parse.quote(pr_obj["head"]["ref"], safe="")
        self.call("DELETE", f"/git/refs/heads/{branch}")


def blockers(issue):
    body = issue.get("body") or ""
    if "## Blocked by" not in body:
        return []
    section = body.split("## Blocked by", 1)[1].split("\n## ", 1)[0]
    return [int(n) for n in re.findall(r"#(\d+)", section)]


def issue_of_branch(branch):
    match = re.match(r"factory/(\d+)", branch or "")
    return int(match.group(1)) if match else None
