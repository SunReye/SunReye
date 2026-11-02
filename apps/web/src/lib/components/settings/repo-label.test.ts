import { describe, expect, it } from "bun:test";
import { repoLabel } from "./repo-label";

const source = (url: string, label?: string) => ({ url, label, enabled: true });

describe("repoLabel", () => {
  it("prefers the label the user set on the matching source", () => {
    const url = "https://github.com/acme/profiles.git";
    expect(repoLabel(url, [source(url, "Acme")])).toBe("Acme");
  });

  it("derives org/repo from the git url, dropping host and .git", () => {
    expect(repoLabel("https://github.com/acme/profiles.git", [])).toBe("acme/profiles");
  });

  it("drops trailing slashes", () => {
    expect(repoLabel("https://gitlab.com/acme/profiles/", [])).toBe("acme/profiles");
  });

  it("ignores a source with no label or a different url", () => {
    const url = "https://github.com/acme/profiles";
    expect(repoLabel(url, [source(url), source("https://github.com/x/y", "Other")])).toBe(
      "acme/profiles",
    );
  });

  it("falls back to the cleaned url when there is no host path to strip", () => {
    expect(repoLabel("ssh-mirror", [])).toBe("ssh-mirror");
    expect(repoLabel("https://example.com", [])).toBe("https://example.com");
  });
});
