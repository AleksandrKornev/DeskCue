import {
  act,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfirmDialogHost } from "./ConfirmDialogHost";
import { requestConfirmation } from "./confirmService";

describe("ConfirmDialogHost", () => {
  it("closes and rejects a confirmation when its lifecycle is aborted", async () => {
    const controller = new AbortController();
    const view = render(<ConfirmDialogHost />);
    let confirmation!: Promise<boolean>;

    act(() => {
      confirmation = requestConfirmation({
        confirmLabel: "Open observation view",
        title: "Open observation view?"
      }, { signal: controller.signal });
    });

    expect(screen.getByRole("dialog", { name: "Open observation view?" })).toBeInTheDocument();

    act(() => controller.abort());

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Open observation view?" })).not.toBeInTheDocument();
    });

    await expect(confirmation).resolves.toBe(false);

    view.unmount();
  });
});
