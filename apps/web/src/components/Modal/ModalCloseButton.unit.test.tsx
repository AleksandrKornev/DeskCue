import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

import { ModalCloseButton } from "./ModalCloseButton";

describe("ModalCloseButton", () => {
  it("exposes its purpose and invokes the close action", () => {
    const onClick = vi.fn();

    render(<ModalCloseButton label="Close preview" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Close preview" });

    expect(button).toHaveAttribute("title", "Close preview");

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });
});
