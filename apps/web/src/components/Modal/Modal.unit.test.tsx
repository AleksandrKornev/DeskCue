import {
  act,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

import { Modal } from "./Modal";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ModalFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
      <Modal
        description="Dialog description"
        isOpen={isOpen}
        title="Test dialog"
        onClose={() => setIsOpen(false)}
      >
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("keeps one history entry through the StrictMode effect probe", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back");
    const onClose = vi.fn();
    const view = render(
      <StrictMode>
        <Modal
          closeOnHistoryBack
          isOpen
          title="History dialog"
          onClose={onClose}
        />
      </StrictMode>
    );

    await act(async () => Promise.resolve());

    expect(pushState).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();

    view.rerender(
      <StrictMode>
        <Modal
          closeOnHistoryBack
          isOpen={false}
          title="History dialog"
          onClose={onClose}
        />
      </StrictMode>
    );

    await act(async () => Promise.resolve());

    expect(back).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps keyboard focus and restores it after close", () => {
    render(<ModalFixture />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    trigger.focus();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });

    expect(dialog).toHaveAttribute("aria-describedby");

    const closeButton = screen.getByRole("button", { name: "Close dialog" });
    const lastAction = screen.getByRole("button", { name: "Last action" });

    dialog.focus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(lastAction).toHaveFocus();

    lastAction.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(lastAction).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("settles a short drag and dismisses after a long downward swipe", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query === "(max-width: 720px)",
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn()
    })));
    render(<ModalFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    act(() => vi.runOnlyPendingTimers());

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    const heading = screen.getByRole("heading", { name: "Test dialog" });
    const dragHandle = heading.parentElement?.parentElement;

    expect(dragHandle).toBeInstanceOf(HTMLElement);

    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ height: 600 } as DOMRect);

    fireEvent.pointerDown(dragHandle!, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 1
    });
    fireEvent.pointerMove(dragHandle!, {
      clientY: 120,
      isPrimary: true,
      pointerId: 1
    });

    expect(dialog).toHaveStyle({ transform: "translateY(20px)" });
    fireEvent.pointerUp(dragHandle!, {
      clientY: 120,
      isPrimary: true,
      pointerId: 1
    });

    act(() => vi.advanceTimersByTime(180));
    expect(dialog).toBeInTheDocument();
    expect(dialog.style.transform).toBe("");

    fireEvent.pointerDown(dragHandle!, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 2
    });
    fireEvent.pointerMove(dragHandle!, {
      clientY: 260,
      isPrimary: true,
      pointerId: 2
    });
    fireEvent.pointerUp(dragHandle!, {
      clientY: 260,
      isPrimary: true,
      pointerId: 2
    });

    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
