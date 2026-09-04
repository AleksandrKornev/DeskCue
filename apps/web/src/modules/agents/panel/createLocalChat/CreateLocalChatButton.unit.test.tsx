import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { CreateLocalChatButton } from "./CreateLocalChatButton";
import styles from "./styles.module.scss";

it("uses a decorative SVG plus icon without changing the accessible name", () => {
  const { container } = render(<CreateLocalChatButton onClick={vi.fn()} />);
  const button = screen.getByRole("button", { name: "New local chat" });
  const icon = container.querySelector(`svg.${styles.triggerIcon}`);

  expect(button).toBeInTheDocument();
  expect(icon).toHaveAttribute("aria-hidden", "true");
  expect(icon?.querySelectorAll("path")).toHaveLength(2);
});
