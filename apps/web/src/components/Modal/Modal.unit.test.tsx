import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
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
import styles from "./styles.module.scss";

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  window.history.replaceState({}, "");
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

function ModalWithoutFocusRestoreFixture() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open transient view</button>
      <Modal
        isOpen={isOpen}
        restoreFocusOnClose={false}
        title="Transient view"
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function RemovingOpenerFixture() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <main>
      {isOpen ? (
        <Modal isOpen title="Transient dialog" onClose={() => setIsOpen(false)} />
      ) : null}
      {!hasOpened ? (
        <button
          type="button"
          onClick={() => {
            setHasOpened(true);
            setIsOpen(true);
          }}
        >
          Open transient dialog
        </button>
      ) : null}
    </main>
  );
}

function NestedModalFixture() {
  const [isOuterOpen, setIsOuterOpen] = useState(false);
  const [isInnerOpen, setIsInnerOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOuterOpen(true)}>Open outer dialog</button>
      <button type="button" onClick={() => setIsOuterOpen(false)}>Force close outer dialog</button>
      <Modal
        closeLabel="Close outer dialog"
        isOpen={isOuterOpen}
        title="Outer dialog"
        onClose={() => setIsOuterOpen(false)}
      >
        <button type="button" onClick={() => setIsInnerOpen(true)}>Open inner dialog</button>
      </Modal>
      <Modal
        closeLabel="Close inner dialog"
        isOpen={isInnerOpen}
        title="Inner dialog"
        onClose={() => setIsInnerOpen(false)}
      >
        <button type="button">Inner action</button>
      </Modal>
    </main>
  );
}

function NestedHistoryModalFixture() {
  const [isOuterOpen, setIsOuterOpen] = useState(false);
  const [isInnerOpen, setIsInnerOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOuterOpen(true)}>Open history outer</button>
      <button type="button" onClick={() => setIsOuterOpen(false)}>Force close history outer</button>
      <Modal
        closeOnHistoryBack
        isOpen={isOuterOpen}
        title="History outer"
        onClose={() => setIsOuterOpen(false)}
      >
        <button type="button" onClick={() => setIsInnerOpen(true)}>Open history inner</button>
      </Modal>
      <Modal
        closeOnHistoryBack
        isOpen={isInnerOpen}
        title="History inner"
        onClose={() => setIsInnerOpen(false)}
      />
    </main>
  );
}

function UnfocusableNestedOpenerFixture() {
  const [isOuterOpen, setIsOuterOpen] = useState(false);
  const [isInnerOpen, setIsInnerOpen] = useState(false);
  const [hasOpenedInner, setHasOpenedInner] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOuterOpen(true)}>Open focusability outer</button>
      <Modal
        isOpen={isOuterOpen}
        title="Focusability outer"
        onClose={() => setIsOuterOpen(false)}
      >
        <div
          role="button"
          tabIndex={hasOpenedInner ? undefined : 0}
          onClick={() => {
            setHasOpenedInner(true);
            setIsInnerOpen(true);
          }}
        >
          Open focusability inner
        </div>
      </Modal>
      <Modal
        isOpen={isInnerOpen}
        title="Focusability inner"
        onClose={() => setIsInnerOpen(false)}
      />
    </main>
  );
}

function RemovedNestedOpenerFixture() {
  const [isOuterOpen, setIsOuterOpen] = useState(false);
  const [isInnerOpen, setIsInnerOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOuterOpen(true)}>Open persistent outer</button>
      <Modal
        isOpen={isOuterOpen}
        title="Persistent outer"
        onClose={() => setIsOuterOpen(false)}
      >
        {!isInnerOpen ? (
          <button type="button" onClick={() => setIsInnerOpen(true)}>Open transient inner</button>
        ) : null}
      </Modal>
      <Modal
        isOpen={isInnerOpen}
        title="Transient inner"
        onClose={() => setIsInnerOpen(false)}
      />
    </main>
  );
}

describe("Modal", () => {
  it("marks a footerless sheet so its scroll body can reserve the bottom safe area", () => {
    const { rerender } = render(
      <Modal isOpen title="Safe area dialog" onClose={vi.fn()}>
        <button type="button">Body action</button>
      </Modal>
    );

    expect(screen.getByRole("dialog", { name: "Safe area dialog" }))
      .toHaveClass(styles.dialogWithoutFooter);

    rerender(
      <Modal
        footer={<button type="button">Footer action</button>}
        isOpen
        title="Safe area dialog"
        onClose={vi.fn()}
      >
        <button type="button">Body action</button>
      </Modal>
    );

    expect(screen.getByRole("dialog", { name: "Safe area dialog" }))
      .not.toHaveClass(styles.dialogWithoutFooter);
  });

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

    window.history.replaceState({}, "");
    fireEvent.popState(window);
  });

  it("keeps dialog focus through the StrictMode effect probe", async () => {
    render(
      <StrictMode>
        <ModalFixture />
      </StrictMode>
    );

    const trigger = screen.getByRole("button", { name: "Open dialog" });

    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Test dialog" })).toHaveFocus());
  });

  it("traps keyboard focus and restores it after close", () => {
    render(<ModalFixture />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    trigger.focus();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    const applicationRoot = trigger.parentElement;

    expect(dialog).toHaveAttribute("aria-describedby");
    expect(dialog).toHaveFocus();
    expect(applicationRoot?.inert).toBe(true);

    const closeButton = screen.getByRole("button", { name: "Close dialog" });
    const lastAction = screen.getByRole("button", { name: "Last action" });

    trigger.focus();
    expect(closeButton).toHaveFocus();

    dialog.focus();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

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
    expect(applicationRoot?.inert).toBeFalsy();
  });

  it("can hand focus ownership to the surface replacing the modal", () => {
    render(<ModalWithoutFocusRestoreFixture />);
    const trigger = screen.getByRole("button", { name: "Open transient view" });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Transient view" })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it("gives keyboard ownership to the top modal and preserves shared locks", () => {
    document.body.style.overflow = "scroll";
    document.documentElement.style.overflow = "auto";
    render(<NestedModalFixture />);

    const outerTrigger = screen.getByRole("button", { name: "Open outer dialog" });

    outerTrigger.focus();
    fireEvent.click(outerTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Open inner dialog" }));

    const innerDialog = screen.getByRole("dialog", { name: "Inner dialog" });
    const innerClose = screen.getByRole("button", { name: "Close inner dialog" });

    expect(innerDialog).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(innerClose).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Inner dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Outer dialog" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(outerTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.documentElement.style.overflow).toBe("auto");
  });

  it("keeps the top modal isolated when a lower modal closes first", () => {
    render(<NestedModalFixture />);
    const applicationRoot = screen.getByRole("main").parentElement;

    expect(applicationRoot).toBeInstanceOf(HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Open outer dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Open inner dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Force close outer dialog" }));

    expect(screen.queryByRole("dialog", { name: "Outer dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Inner dialog" })).toHaveFocus();
    expect(applicationRoot!.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(applicationRoot!.inert).toBeFalsy();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("restores focus to a live lower dialog when the inner opener disappears", () => {
    render(<RemovedNestedOpenerFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Open persistent outer" }));
    fireEvent.click(screen.getByRole("button", { name: "Open transient inner" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Transient inner" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Persistent outer" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("tries the live lower dialog when the connected inner opener loses focusability", () => {
    render(<UnfocusableNestedOpenerFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Open focusability outer" }));

    const innerOpener = screen.getByRole("button", { name: "Open focusability inner" });

    innerOpener.focus();
    fireEvent.click(innerOpener);

    expect(innerOpener).not.toHaveAttribute("tabindex");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Focusability inner" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Focusability outer" })).toHaveFocus();
  });

  it("lets one history Back close only the top history modal", () => {
    render(<NestedHistoryModalFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Open history outer" }));
    const outerHistoryState: unknown = window.history.state;

    fireEvent.click(screen.getByRole("button", { name: "Open history inner" }));
    expect(window.history.state).not.toEqual(outerHistoryState);

    window.history.replaceState(outerHistoryState, "");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog", { name: "History inner" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "History outer" })).toHaveFocus();

    window.history.replaceState({}, "");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("skips inactive history markers after lower-first programmatic cleanup", async () => {
    const back = vi.spyOn(window.history, "back");

    render(<NestedHistoryModalFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open history outer" }));

    const outerHistoryState: unknown = window.history.state;

    fireEvent.click(screen.getByRole("button", { name: "Open history inner" }));
    fireEvent.click(screen.getByRole("button", { name: "Force close history outer" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    await act(async () => Promise.resolve());

    expect(back).toHaveBeenCalledOnce();

    window.history.replaceState(outerHistoryState, "");
    fireEvent.popState(window);

    expect(back).toHaveBeenCalledTimes(2);

    window.history.replaceState({}, "");
    fireEvent.popState(window);

    expect(back).toHaveBeenCalledTimes(2);
  });

  it("skips an inactive lower marker after the user closes the top modal with Back", () => {
    const back = vi.spyOn(window.history, "back");

    render(<NestedHistoryModalFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open history outer" }));

    const outerHistoryState: unknown = window.history.state;

    fireEvent.click(screen.getByRole("button", { name: "Open history inner" }));
    fireEvent.click(screen.getByRole("button", { name: "Force close history outer" }));

    window.history.replaceState(outerHistoryState, "");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(back).toHaveBeenCalledOnce();

    window.history.replaceState({}, "");
    fireEvent.popState(window);

    expect(back).toHaveBeenCalledOnce();
  });

  it("moves focus to main when the opener no longer exists", async () => {
    render(<RemovingOpenerFixture />);
    const trigger = screen.getByRole("button", { name: "Open transient dialog" });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
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
