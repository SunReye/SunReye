import { describe, expect, test } from "bun:test";

import { emptyForm } from "../devices/add-device-logic";
import type { AddDeviceForm } from "../devices/device-types";
import { answerRows } from "./confirm-rows";

const form = (over: Partial<AddDeviceForm> = {}): AddDeviceForm => ({
  ...emptyForm([]),
  role: "meter",
  unitId: 3,
  name: "  Cellar meter  ",
  profileId: "acme.meter",
  ...over,
});

const registered = [
  {
    id: "acme.meter",
    name: "Acme Meter",
    manufacturer: "Acme",
    active: true,
    installed: true,
    builtin: false,
  },
];

describe("what the confirm step says about a device", () => {
  // Not the form object. The old step dumped `values` through `String()`, which
  // for a device would read `arrays: [object Object]`.
  test("a device is summarised as its name, role, profile and unit id", () => {
    expect(answerRows({ via: "profile", form: form() }, registered)).toEqual([
      { key: "name", label: "Name", value: "Cellar meter", mono: false },
      { key: "role", label: "Role", value: "Meter", mono: false },
      { key: "profileId", label: "Profile", value: "Acme Meter", mono: false },
      { key: "unitId", label: "Unit ID", value: "3", mono: true },
    ]);
  });

  // A profile the roster has not loaded (or a build that does not know it) is
  // named by its id rather than shown blank.
  test("an unknown profile shows its id", () => {
    const rows = answerRows({ via: "profile", form: form({ profileId: "who.knows" }) }, []);
    expect(rows.find((r) => r.key === "profileId")?.value).toBe("who.knows");
  });

  test("unit id 0 is a real address and is shown, not hidden as falsy", () => {
    const rows = answerRows({ via: "profile", form: form({ unitId: 0 }) }, registered);
    expect(rows.find((r) => r.key === "unitId")?.value).toBe("0");
  });
});

describe("what it says about a coded integration", () => {
  test("each answered field, by its translated label", () => {
    expect(answerRows({ via: "coded", values: { topicRoot: "garage" } }, [])).toEqual([
      { key: "topicRoot", label: "Topic root", value: "garage", mono: true },
    ]);
  });

  test("an entry that asked nothing lists nothing", () => {
    expect(answerRows({ via: "coded", values: {} }, [])).toEqual([]);
  });
});
