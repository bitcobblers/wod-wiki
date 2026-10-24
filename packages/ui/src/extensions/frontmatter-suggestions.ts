/**
 * Suggestion popover for frontmatter property fields.
 *
 * The list floats over the properties panel in a document-level layer, so
 * opening it never changes the panel's height (the panel is a table, and a
 * growing table reflows the whole note below it).
 *
 * Placement rules:
 *  - the popup is anchored to the field it belongs to and its width follows
 *    the field, clamped to 12rem…20rem, so it never spans the property row;
 *  - it opens below the field and flips above it when the space below is
 *    too small, or when opening below would cover the metadata actions —
 *    those are live controls, and a popup must not hide them;
 *  - it is clamped inside the viewport on both axes and scrolls internally.
 *
 * ARIA: the field is the combobox, the panel is its listbox popup
 * (`aria-controls` + `aria-activedescendant`); the panel carries its own
 * accessible name so the popup is announced, not just the field.
 */

/** Narrowest panel: still readable for a two-word suggestion. */
export const POPOVER_MIN_WIDTH = 192;
/** Widest panel: a property row is far wider, and the panel must not span it. */
export const POPOVER_MAX_WIDTH = 320;
/** Tallest panel before it scrolls internally. */
export const POPOVER_MAX_HEIGHT = 256;
/** Gap between the field and the panel. */
export const POPOVER_GAP = 8;

export interface FloatingRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingPlacement {
  left: number;
  top: number;
  width: number;
  placement: "below" | "above";
}

/**
 * Pure placement math — no DOM, so the collision rules stay testable.
 *
 * @param field     the field's viewport rect
 * @param viewport  the visible viewport
 * @param panelHeight  the panel's natural height
 * @param avoid     region the popup must not cover (the metadata actions)
 */
export function computeFloatingPlacement(
  field: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
  panelHeight: number,
  avoid?: FloatingRect,
  gap: number = POPOVER_GAP,
): FloatingPlacement {
  const width = Math.min(Math.max(field.width, POPOVER_MIN_WIDTH), POPOVER_MAX_WIDTH);
  const height = Math.min(Math.max(panelHeight, 0), POPOVER_MAX_HEIGHT);
  const below = { top: field.bottom + gap, bottom: field.bottom + gap + height };
  const above = { top: field.top - gap - height, bottom: field.top - gap };
  const fitsBelow = below.bottom <= viewport.height;
  const fitsAbove = above.top >= 0;
  const coversActions = avoid
    ? below.bottom > avoid.top && below.top < avoid.bottom
    : false;
  const placement: "below" | "above" =
    (coversActions || !fitsBelow) && fitsAbove ? "above" : "below";
  const chosen = placement === "below" ? below : above;
  return {
    left: Math.min(Math.max(gap, field.left), Math.max(gap, viewport.width - width - gap)),
    top: Math.min(Math.max(gap, chosen.top), Math.max(gap, viewport.height - height - gap)),
    width,
    placement,
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
  /** Region the popup must not cover (the metadata actions row). */
  avoid?: () => HTMLElement | null;
}

let panelId = 0;

export class SuggestionPanel {
  readonly element: HTMLElement;
  private readonly inputElement: HTMLInputElement;
  private readonly onPick: (choice: SuggestionChoice) => void;
  private readonly avoid: (() => HTMLElement | null) | undefined;
  private readonly listId: string;
  private currentChoices: SuggestionChoice[] = [];
  private currentIndex = -1;
  private isOpen = false;

  constructor(input: HTMLInputElement, options: SuggestionPanelOptions) {
    this.inputElement = input;
    this.onPick = options.onPick;
    this.avoid = options.avoid;
    this.listId = `frontmatter-suggestions-${++panelId}`;

    const list = document.createElement("div");
    list.id = this.listId;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.label);
    list.tabIndex = -1;
    list.className =
      "fixed z-[60] max-h-64 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md text-xs";
    list.hidden = true;
    this.element = list;
    // The popup lives outside the editor: it must not change the height of
    // the properties panel it belongs to.
    document.body.appendChild(list);

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
    this.position();
    this.inputElement.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", this.handleViewportChange, true);
    window.addEventListener("resize", this.handleViewportChange);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.element.hidden = true;
    this.currentIndex = -1;
    this.inputElement.setAttribute("aria-expanded", "false");
    this.inputElement.removeAttribute("aria-activedescendant");
    window.removeEventListener("scroll", this.handleViewportChange, true);
    window.removeEventListener("resize", this.handleViewportChange);
  }

  destroy(): void {
    this.close();
    this.element.remove();
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

  private readonly handleViewportChange = (): void => {
    if (this.isOpen) this.position();
  };

  /** Anchor the panel to the field, flipped away from the metadata actions. */
  private position(): void {
    const field = this.inputElement.getBoundingClientRect();
    const avoidElement = this.avoid?.() ?? null;
    const avoidRect = avoidElement?.getBoundingClientRect();
    // The list scrolls internally: a full catalogue must not become a
    // screen-height panel.
    const height = Math.min(this.element.scrollHeight, POPOVER_MAX_HEIGHT);
    const placement = computeFloatingPlacement(
      { top: field.top, bottom: field.bottom, left: field.left, width: field.width },
      { width: window.innerWidth, height: window.innerHeight },
      height,
      avoidRect
        ? {
            top: avoidRect.top,
            bottom: avoidRect.bottom,
            left: avoidRect.left,
            right: avoidRect.right,
          }
        : undefined,
    );
    this.element.style.width = `${placement.width}px`;
    this.element.style.maxHeight = `${height}px`;
    this.element.style.left = `${placement.left}px`;
    this.element.style.top = `${placement.top}px`;
    this.element.dataset.placement = placement.placement;
  }
}
