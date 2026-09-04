import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { NotificationProviderCard } from "./NotificationProviderCard";

it("keeps disabled provider configuration out of the interaction order", () => {
  const onEnabledChange = vi.fn();

  render(
    <NotificationProviderCard
      enabled={false}
      provider="gotify"
      testing={false}
      title="Gotify"
      onEnabledChange={onEnabledChange}
      onSendTest={vi.fn()}
    >
      <label>Server URL<input /></label>
    </NotificationProviderCard>
  );

  expect(screen.getByRole("region", { name: "Gotify" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Server URL" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();

  fireEvent.click(screen.getByRole("checkbox", { name: "Gotify" }));

  expect(onEnabledChange).toHaveBeenCalledWith("gotify", true);
});

it("shows enabled provider configuration and keeps its test action available", () => {
  const onSendTest = vi.fn();

  render(
    <NotificationProviderCard
      enabled
      provider="ntfy"
      testing={false}
      title="ntfy"
      onEnabledChange={vi.fn()}
      onSendTest={onSendTest}
    >
      <label>Topic URL<input /></label>
    </NotificationProviderCard>
  );

  expect(screen.getByRole("textbox", { name: "Topic URL" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Send test" }));

  expect(onSendTest).toHaveBeenCalledWith("ntfy");
});
