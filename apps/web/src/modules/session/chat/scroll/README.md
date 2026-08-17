# Managed Session Chat Scroll Contract

This folder owns chat scroll behavior for the managed session screen. Treat it
as reliability code, not visual polish.

## Invariants

- The user must never be pulled away from the scroll position they intentionally
  chose while reading older history.
- A prompt sent from the bottom should keep the chat pinned to the live tail.
- Loading older history must preserve the visible anchor message after new
  entries are inserted above it.
- Mobile compact mode uses page scrolling; desktop mode uses the chat thread
  container. Do not mix their metrics in one code path.
- Auto-load must remain bounded. Expanding transcript entries inline is allowed,
  but opened entries must be capped so repeated taps cannot grow memory without
  limit.
- The scroll-to-latest button is only a navigation affordance. It must not
  become a permanent overlay when the user is already near the live tail.

## Required Checks After Changes

- Chrome DevTools MCP on the active local DeskCue development origin.
- Mobile width around `500px`: open a live chat, scroll upward, auto-load older
  messages, then verify there is no visible jump or clipped loader.
- While a run is active, send a prompt from the bottom and verify the waiting
  block does not cause micro-scroll upward.
- Open Details, Tools, and Changes inline from chat; verify expanded blocks are
  hydrated, ordered as Details -> Tools -> Changes -> Waiting, and bounded.
- Check console errors/warnings and obvious long tasks while scrolling.
