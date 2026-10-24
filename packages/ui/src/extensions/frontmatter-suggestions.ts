/**
 * Suggestion popover for frontmatter property fields.
 *
 * The list is rendered INSIDE the properties panel, directly under the field
 * it belongs to, instead of floating over the page:
 *  - a floating panel covers whatever sits below the field — in the note
 *    editor that is the metadata actions (Add property / Add metric / Add
 *    tag / Edit YAML) and the saved-history region, which the audit calls
 *    out as hidden by the suggestions;
 *  - expanding in flow pushes those rows down instead of hiding them, and
 *    the whole candidate list stays readable;
 *  - the panel is anchored to the field (same left edge, width derived from
 *    the field) and its height is capped so it never grows past the
 *    viewport — the list scrolls internally instead.
 *
 * ARIA: the field is the combobox, the panel is its listbox popup
 * (`aria-controls` + `aria-activedescendant`); the panel carries its own
 * accessible name so the popup is announced, not just the field.
 */

import type { EditorView } from "@codemirror/view";

/** Narrowest panel: still readable for a two-word suggestion. */
export const POPOVER_MIN_WIDTH = 192;
/** Widest panel: a property row is far wider, and the panel must not span it. */
export const POPOVER_MAX_WIDTH = 320;
/** Tallest panel before it scrolls internally. */
export const POPOVER_MAX_HEIGHT = 256;

export interface PopoverRect {
  left: number;
  top: number;
  width: number;
}

export interface InlinePanelBox {
  width: number;
  offsetLeft: number;
  maxHeight: number;
}

/**
 * Pure geometry — no DOM, so the anchoring rules stay testable.
 *
 * Collision handling: the panel never leaves the row it belongs to
 * horizontally, and never grows past the viewport below the field — it
 * scrolls internally instead.
 *
 * @param field  the field's viewport rect
 * @param host   the row the panel is inserted under
 * @param viewportHeight  available viewport height
 */
export function computeInlinePanelBox(
  field: PopoverRect,
  host: PopoverRect,
  viewportHeight: number,
): InlinePanelBox {
  const offsetLeft = Math.max(0, Math.min(field.left - host.left, Math.max(0, host.width - POPOVER_MIN_WIDTH)));
  const room = Math.max(host.width - offsetLeft, POPOVER_MIN_WIDTH);
  const width = Math.min(Math.max(field.width, POPOVER_MIN_WIDTH), POPOVER_MAX_WIDTH, room);
  const belowField = Math.max(0, viewportHeight - field.top - 64);
  return {
    width,
    offsetLeft,
    maxHeight: Math.max(96, Math.min(POPOVER_MAX_HEIGHT, belowField)),
  };
}

export interface SuggestionChoice {
  value: string;
  label: string;
}

export interface SuggestionPanelOptions {
  /** Accessible name of the listbox popup (e.g. "Suggested tags"). */
  label: string;
  /** Called after a choice is applied to the field. */
  onPick: (choice: SuggestionChoice) => void;
  /** The editor view — opening the panel changes the widget height. */
  view: EditorView;
  /** The row the panel is inserted under. */
  host: HTMLElement;
}

let panelId = 0;

export class SuggestionPanel {
  readonly element: HTMLElement;
  private readonly inputElement: HTMLInputElement;
  private readonly onPick: (choice: SuggestionChoice) => void;
  private readonly view: EditorView;
  private readonly host: HTMLElement;
  private readonly listId: string;
  private currentChoices: SuggestionChoice[] = [];
  private currentIndex = -1;
  private isOpen = false;

  constructor(input: HTMLInputElement, options: SuggestionPanelOptions) {
    this.inputElement = input;
    this.onPick = options.onPick;
    this.view = options.view;
    this.host = options.host;
    this.listId = `frontmatter-suggestions-${++panelId}`;

    const list = document.createElement("div");
    list.id = this.listId;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.label);
    list.tabIndex = -1;
    list.className =
      "mt-1 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md text-xs";
    list.hidden = true;
    this.element = list;

    // The popup stays mounted (hidden) so `aria-controls` always resolves to
    // an existing element, even while the list is collapsed. It joins the DOM
    // as soon as its host row is connected.
    this.attach();

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", this.listId);
    input.setAttribute("aria-expanded", "false");
  }

  get choices(): readonly SuggestionChoice[] {
    return this.currentChoices;
  }

  get activeIndex(): number {
    return this.currentIndex;
  }

  setChoices(choices: SuggestionChoice[]): void {
    this.currentChoices = choices;
    this.currentIndex = -1;
    this.inputElement.removeAttribute("aria-activedescendant");
    this.element.replaceChildren();
    choices.forEach((choice, index) => {
      const option = document.createElement("div");
      option.id = `${this.listId}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.className = "cursor-pointer px-2 py-1.5 hover:bg-muted";
      option.textContent = choice.label;
      // Keep the field focused so the blur handler does not close the panel
      // before the click lands.
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.pick(choice));
      this.element.appendChild(option);
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.element.hidden = false;
    this.attach();
    this.position();
    this.inputElement.setAttribute("aria-expanded", "true");
    this.view.requestMeasure();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.element.hidden = true;
    this.currentIndex = -1;
    this.inputElement.setAttribute("aria-expanded", "false");
    this.inputElement.removeAttribute("aria-activedescendant");
    this.view.requestMeasure();
  }

  destroy(): void {
    this.close();
  }

  activate(index: number): void {
    this.currentIndex = index;
    Array.from(this.element.children).forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === index));
      option.classList.toggle("bg-muted", i === index);
    });
    const option = this.element.children[index];
    if (!option) return;
    this.inputElement.setAttribute("aria-activedescendant", option.id);
    if (option instanceof HTMLElement) option.scrollIntoView?.({ block: "nearest" });
  }

  /** Move the highlighted option; the first/last option wraps around. */
  moveActive(delta: number): void {
    if (this.currentChoices.length === 0) return;
    const next =
      this.currentIndex < 0
        ? delta > 0
          ? 0
          : this.currentChoices.length - 1
        : (this.currentIndex + delta + this.currentChoices.length) % this.currentChoices.length;
    this.activate(next);
  }

  pickActive(): void {
    const choice = this.currentChoices[this.currentIndex];
    if (choice) this.pick(choice);
  }

  private pick(choice: SuggestionChoice): void {
    this.inputElement.value = choice.value;
    this.close();
    this.onPick(choice);
  }

  /** Join the DOM under its host row (idempotent). */
  private attach(): void {
    if (this.element.parentElement) return;
    this.host.after(this.element);
  }

  /** Anchor the panel to the field inside its row. */
  private position(): void {
    const box = computeInlinePanelBox(
      this.inputElement.getBoundingClientRect(),
      this.host.getBoundingClientRect(),
      window.innerHeight,
    );
    this.element.style.width = `${box.width}px`;
    this.element.style.marginLeft = `${box.offsetLeft}px`;
    this.element.style.maxHeight = `${box.maxHeight}px`;
  }
}
