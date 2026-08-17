import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardHomeTabs } from "./DashboardHomeTabs";

describe("DashboardHomeTabs", () => {
  it("hides the local Tools tab when the current runtime has no tools content", () => {
    render(
      <DashboardHomeTabs
        chatsContent={<div>Remote chats</div>}
        toolsContent={null}
      />
    );

    expect(screen.getByRole("tabpanel", { name: "Chats" }))
      .toHaveTextContent("Remote chats");
    expect(screen.queryByRole("tab", { name: "Tools" }))
      .not.toBeInTheDocument();
  });

  it("keeps the local Tools tab when tools content is available", () => {
    render(
      <DashboardHomeTabs
        chatsContent={<div>Local chats</div>}
        toolsContent={<div>Local tools</div>}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));

    expect(screen.getByRole("tabpanel", { name: "Tools" }))
      .toHaveTextContent("Local tools");
  });
});
