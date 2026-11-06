import { expect, type Mock, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Guarded, ImportReport, Outcome } from "$lib/archive-import/import-client";
import * as m from "$lib/paraglide/messages";
import ImportPanel from "./import-panel.svelte";

// What 2.x's replay of `current-2.x` reports (fixtures/oracle/archives/current-2.x/expected-import.json):
// rows per stream, and the one partial day no tier covers.
const REPORT: ImportReport = {
  read: { raw: 6, minute: 0, hourly: 4, daily: 4, configLog: 2 },
  gaps: [
    {
      device: "oracle-archive-inverter",
      start: "2026-04-30T00:00:00.000Z",
      end: "2026-04-30T12:00:00.000Z",
    },
  ],
  conflicts: 0,
  firstConflict: null,
};
const GUARDED: Guarded = {
  sha256: "cc05db473ae491d3495ed10ad78c23625b85931404c2d347742e428e06a4802d",
  held: [{ key: "1:peak-shaving", value: 60, capturedAt: "2026-05-01T10:00:00.000Z" }],
};

const GUARDED_B: Guarded = {
  sha256: "5d2c1f0e8a7b4c3d9e6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
  held: [{ key: "2:evcc-boost", value: "pv", capturedAt: "2026-05-01T10:05:00.000Z" }],
};

const imported = (report = REPORT): Outcome => ({ kind: "imported", report });
const guarded: Outcome = { kind: "guarded", guarded: GUARDED };

/** A promise the test settles when it chooses, so a state in between can be looked at. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

type Upload = (file: File, onProgress: (sent: number, total: number) => void) => Promise<Outcome>;
type Confirm = (sha256: string) => Promise<Outcome>;

function mount(
  upload: Mock<Upload> = vi.fn<Upload>(async () => imported()),
  confirm: Mock<Confirm> = vi.fn<Confirm>(async () => imported()),
) {
  const onDone = vi.fn();
  render(ImportPanel, { upload, confirm, onDone });
  return { upload, confirm, onDone };
}

const archive = () => new File([new Uint8Array([0x1f, 0x8b, 8])], "archive.tar.gz");
const choose = (file = archive()) =>
  userEvent.upload(page.getByLabelText(m.import_file_label()), file);
const result = () => page.getByRole("region", { name: m.import_result_title() });
const confirmation = () => page.getByRole("checkbox", { name: m.import_guard_confirm() });
const proceed = () => page.getByRole("button", { name: m.action_continue() });

test("sends the chosen file and shows the counts the core read, per stream", async () => {
  const { upload } = mount();
  const file = archive();
  await choose(file);
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0]![0]).toMatchObject({ name: file.name, size: file.size });
  await expect.element(result()).toBeVisible();
  const row = (label: string) =>
    result()
      .getByText(label, { exact: true })
      .element()
      .parentElement!.textContent!.replace(/\s+/g, " ")
      .trim();
  expect(row(m.import_result_raw())).toBe(`${m.import_result_raw()} 6`);
  expect(row(m.import_result_minute())).toBe(`${m.import_result_minute()} 0`);
  expect(row(m.import_result_hourly())).toBe(`${m.import_result_hourly()} 4`);
  expect(row(m.import_result_daily())).toBe(`${m.import_result_daily()} 4`);
  expect(row(m.import_result_config_log())).toBe(`${m.import_result_config_log()} 2`);
});

test("lists each partial day that was not imported, and says nothing of conflicts when there were none", async () => {
  mount();
  await choose();
  await expect.element(page.getByText(m.import_result_gaps())).toBeVisible();
  await expect
    .element(
      page.getByText(
        m.import_result_gap({
          device: "oracle-archive-inverter",
          start: "2026-04-30T00:00:00.000Z",
          end: "2026-04-30T12:00:00.000Z",
        }),
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText(/lines dropped|Zeilen verworfen/)).not.toBeInTheDocument();
});

test("without a partial day the gaps heading is not shown", async () => {
  mount(vi.fn<Upload>(async () => imported({ ...REPORT, gaps: [] })));
  await choose();
  await expect.element(result()).toBeVisible();
  await expect.element(page.getByText(m.import_result_gaps())).not.toBeInTheDocument();
});

test("shows the conflict count and the first conflict with the value kept and dropped", async () => {
  const conflict = {
    device: "inv",
    metric: "pv.power",
    at: "2026-05-01T12:00:00.000Z",
    kept: 1000,
    dropped: 1200.5,
  };
  mount(vi.fn<Upload>(async () => imported({ ...REPORT, conflicts: 3, firstConflict: conflict })));
  await choose();
  await expect.element(page.getByText(m.import_result_conflicts({ count: 3 }))).toBeVisible();
  await expect
    .element(
      page.getByText(
        m.import_result_first_conflict({
          device: "inv",
          metric: "pv.power",
          at: "2026-05-01T12:00:00.000Z",
          kept: 1000,
          dropped: 1200.5,
        }),
      ),
    )
    .toBeVisible();
});

test("shows the bytes sent as a percentage while uploading, then that the core is importing", async () => {
  const answer = deferred<Outcome>();
  const upload = vi.fn<Upload>(async (_, onProgress) => {
    onProgress(25, 100);
    return answer.promise;
  });
  mount(upload);
  await choose();
  await expect.element(page.getByText(m.import_uploading({ percent: 25 }))).toBeVisible();
  await expect.element(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  await expect.element(page.getByLabelText(m.import_file_label())).toBeDisabled();
  answer.settle(imported());
  await expect.element(result()).toBeVisible();
  await expect.element(page.getByRole("progressbar")).not.toBeInTheDocument();
  await expect.element(page.getByLabelText(m.import_file_label())).toBeEnabled();
});

test("once every byte is sent it says the core is importing, not that it is still uploading", async () => {
  const answer = deferred<Outcome>();
  mount(
    vi.fn<Upload>(async (_, onProgress) => {
      onProgress(100, 100);
      return answer.promise;
    }),
  );
  await choose();
  await expect.element(page.getByText(m.import_importing())).toBeVisible();
  answer.settle(imported());
});

test("a refusal shows its sentence and leaves the picker ready for another file", async () => {
  const refusal = m.import_err_409({
    reason: "An archive import is running: try again when it ends",
  });
  const upload = vi.fn<Upload>(async () => ({ kind: "refused", message: refusal }));
  mount(upload);
  await choose();
  await expect.element(page.getByRole("alert")).toHaveTextContent(refusal);
  await expect.element(result()).not.toBeInTheDocument();
  await expect.element(page.getByLabelText(m.import_file_label())).toBeEnabled();
  upload.mockResolvedValueOnce(imported());
  await choose();
  await expect.element(result()).toBeVisible();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("a guarded archive imports nothing until the dialog is confirmed with its sha256", async () => {
  const { confirm } = mount(vi.fn<Upload>(async () => guarded));
  await choose();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByText("1:peak-shaving")).toBeVisible();
  await expect.element(result()).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  await confirmation().click();
  await proceed().click();
  expect(confirm).toHaveBeenCalledExactlyOnceWith(GUARDED.sha256);
  await expect.element(result()).toBeVisible();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("Cancel at the guard imports nothing, closes the dialog and clears the picker", async () => {
  const { upload, confirm } = mount(vi.fn<Upload>(async () => guarded));
  await choose();
  await page.getByRole("button", { name: m.action_cancel() }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(result()).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  expect(page.getByLabelText(m.import_file_label()).element()).toHaveProperty("value", "");
  // The same file again is a new upload: `change` fires because the input was cleared.
  await choose();
  expect(upload).toHaveBeenCalledTimes(2);
  await expect.element(page.getByRole("dialog")).toBeVisible();
});

test("a tick given before Cancel does not carry over: the next guard needs its own, and confirms its own archive", async () => {
  const upload = vi
    .fn<Upload>()
    .mockResolvedValueOnce(guarded)
    .mockResolvedValueOnce({ kind: "guarded", guarded: GUARDED_B });
  const { confirm } = mount(upload);
  await choose();
  await confirmation().click();
  await expect.element(proceed()).toBeEnabled();
  await page.getByRole("button", { name: m.action_cancel() }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await choose();
  await expect.element(page.getByText("2:evcc-boost")).toBeVisible();
  await expect.element(confirmation()).not.toBeChecked();
  await expect.element(proceed()).toBeDisabled();
  await confirmation().click();
  await proceed().dblClick();
  expect(confirm).toHaveBeenCalledExactlyOnceWith(GUARDED_B.sha256);
});

test("a confirmation the core refuses shows its sentence and closes the dialog", async () => {
  const refusal = m.import_err_409({
    reason: "No upload awaits confirmation for that archive: upload it again",
  });
  mount(
    vi.fn<Upload>(async () => guarded),
    vi.fn<Confirm>(async () => ({ kind: "refused", message: refusal })),
  );
  await choose();
  await confirmation().click();
  await proceed().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent(refusal);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("the finished import offers the way on, once", async () => {
  const { onDone } = mount();
  await choose();
  await page.getByRole("button", { name: m.import_result_continue() }).click();
  expect(onDone).toHaveBeenCalledOnce();
});
