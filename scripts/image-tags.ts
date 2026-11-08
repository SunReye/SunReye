/** Docker tags for a release version (ADR 0003): `latest` stays on 3.x until the owner moves it. */

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function imageTags(version: string): string[] {
  const match = RELEASE.exec(version);
  if (!match)
    throw new Error(`${JSON.stringify(version)} is not a release version (MAJOR.MINOR.PATCH)`);
  const [, major, minor] = match;
  switch (major) {
    case "3":
      return [version, `${major}.${minor}`, "latest"];
    case "4":
      return [version, "4"];
    default:
      throw new Error(`${version} is not a 3.x or 4.x release`);
  }
}
