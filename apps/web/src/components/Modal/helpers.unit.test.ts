import { afterEach, describe, expect, it } from "vitest";

import { getFocusableElements } from "./helpers";

afterEach(() => {
  document.body.replaceChildren();
});

describe("getFocusableElements", () => {
  it("follows effective keyboard focusability inside a dialog", () => {
    document.body.innerHTML = `
      <div id="dialog">
        <button id="visible">Visible</button>
        <fieldset disabled><input id="fieldset-disabled" type="radio" /></fieldset>
        <div hidden><button id="hidden-ancestor">Hidden ancestor</button></div>
        <div inert><button id="inert-ancestor">Inert ancestor</button></div>
        <button id="display-none" style="display: none">Display none</button>
        <button id="negative-tab" tabindex="-1">Negative tab</button>
        <div id="scroll-region" tabindex="0">Scrollable region</div>
        <iframe id="document-frame" title="Document preview"></iframe>
      </div>
    `;
    const dialog = document.querySelector<HTMLElement>("#dialog");

    expect(dialog).not.toBeNull();
    expect(getFocusableElements(dialog!).map((element) => element.id)).toEqual([
      "visible",
      "scroll-region",
      "document-frame"
    ]);
  });
});
