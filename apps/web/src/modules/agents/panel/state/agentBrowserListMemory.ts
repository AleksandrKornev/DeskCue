const MAX_REMEMBERED_SCROLL_TOP = 10_000_000;

let rememberedScrollTop: number | null = null;
let rememberedQuery = "";

export function rememberAgentBrowserListScrollTop(value: number) {
  rememberedScrollTop = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), MAX_REMEMBERED_SCROLL_TOP)
    : null;
}

export function consumeAgentBrowserListScrollTop() {
  const value = rememberedScrollTop;

  rememberedScrollTop = null;

  return value;
}

export function clearAgentBrowserListScrollTop() {
  rememberedScrollTop = null;
}

export function rememberAgentBrowserQuery(value: string) {
  rememberedQuery = value;
}

export function readAgentBrowserQuery() {
  return rememberedQuery;
}

export function clearAgentBrowserQuery() {
  rememberedQuery = "";
}
