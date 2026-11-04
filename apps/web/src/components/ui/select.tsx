"use client";

// The app's select (replaces the browser's native dropdown): a button that opens a styled list, with a search box for
// long lists. Callers keep the native API — <option> children, `value` + `onChange(e)` or react-hook-form `register` —
// because a hidden native <select> stays the real form control: it holds the value, the name, `required` validation
// and the ref; choosing an option sets it and fires a real change event.
//
// The list opens in the top layer (Popover API), so drawers and dialogs never clip it. Keyboard: ↓/↑/Enter/Space open,
// ↓/↑/Home/End move, Enter picks, Esc/Tab close; typing filters when the list has a search box.
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";
import { filterOptions, optionsFromChildren, SEARCH_FROM } from "@/lib/select-options";

const base =
  "rounded-input border border-border bg-surface text-foreground focus:border-primary focus:outline-none aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60";
const control = `${base} px-3 text-sm`;
const compactControl = `${base} h-8 px-2 text-xs`;

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Toolbar size, as wide as its content. */
  compact?: boolean;
  /** Force the search box on or off (default: lists of SEARCH_FROM options or more). */
  searchable?: boolean;
  "data-testid"?: string;
};

const LIST_MAX_HEIGHT = 288;
const GAP = 4;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className,
    compact,
    searchable,
    children,
    id,
    disabled,
    "aria-label": ariaLabel,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
    "data-testid": testId,
    ...native
  },
  ref,
) {
  const t = useTranslations("common");
  const listId = useId();
  const nativeRef = useRef<HTMLSelectElement>(null);
  useImperativeHandle(ref, () => nativeRef.current!, []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const [current, setCurrent] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  // The native select is the source of truth (controlled by `value`, or by react-hook-form through the ref). Read it
  // after every render: `form.reset()` sets it without any event. The equality check stops the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally every render (see above)
  useLayoutEffect(() => {
    const v = nativeRef.current?.value ?? "";
    if (v !== current) setCurrent(v);
  });

  const selected = options.find((o) => o.value === current);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 192), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const up = below < Math.min(LIST_MAX_HEIGHT, 200) && above > below;
    pop.style.left = `${left}px`;
    pop.style.width = `${width}px`;
    pop.style.maxHeight = `${Math.min(LIST_MAX_HEIGHT + (withSearch ? 48 : 0), up ? above : below)}px`;
    if (up) {
      pop.style.top = "";
      pop.style.bottom = `${vh - r.top + GAP}px`;
    } else {
      pop.style.bottom = "";
      pop.style.top = `${r.bottom + GAP}px`;
    }
  }, [withSearch]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === (nativeRef.current?.value ?? ""));
    setActive(Math.max(0, idx));
    setOpen(true);
  }, [disabled, options]);

  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    if (open) {
      if (!pop.matches(":popover-open")) pop.showPopover?.();
      place();
      (withSearch ? searchRef.current : pop)?.focus({ preventScroll: true });
      const onDown = (e: PointerEvent) => {
        const target = e.target as Node;
        if (!pop.contains(target) && !triggerRef.current?.contains(target)) close(false);
      };
      const onMove = () => place();
      document.addEventListener("pointerdown", onDown, true);
      window.addEventListener("resize", onMove);
      window.addEventListener("scroll", onMove, true);
      return () => {
        document.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("resize", onMove);
        window.removeEventListener("scroll", onMove, true);
      };
    }
    if (pop.matches(":popover-open")) pop.hidePopover?.();
  }, [open, place, close, withSearch]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (value: string) => {
    const sel = nativeRef.current;
    close();
    if (!sel || sel.value === value) return;
    // React tracks the native value: set it with the prototype setter, then fire the event React listens to.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    setCurrent(sel.value);
  };

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < shown.length; i += step) if (!shown[i]!.disabled) return i;
    return from;
  };

  const onListKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => move(a, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => move(a, -1));
        break;
      case "Home":
        if (withSearch) return;
        e.preventDefault();
        setActive(move(-1, 1));
        break;
      case "End":
        if (withSearch) return;
        e.preventDefault();
        setActive(move(shown.length, -1));
        break;
      case "Enter": {
        e.preventDefault();
        const o = shown[active];
        if (o && !o.disabled) choose(o.value);
        break;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // a dialog around us must stay open
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openList();
    } else if (withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Start typing on the closed select: open it with the search filled in.
      e.preventDefault();
      setQuery(e.key);
      setActive(0);
      openList();
    }
  };

  return (
    // Callers size the select with width classes (sm:w-48): they apply to the wrapper; the button fills it.
    <span
      className={cn(
        "relative",
        compact ? "inline-block" : ["block", !/(^|\s)w-/.test(className ?? "") && "w-full"],
        className,
      )}
    >
      <select
        ref={nativeRef}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        className="pointer-events-none absolute bottom-0 left-0 size-px overflow-hidden opacity-0 [clip-path:inset(50%)]"
        {...native}
      >
        {children}
      </select>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        data-testid={testId}
        data-value={current}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        className={cn(
          "flex items-center justify-between gap-2 text-left",
          compact ? compactControl : [control, "h-10 w-full"],
          open && "border-primary",
        )}
      >
        <span className={cn("min-w-0 truncate", !selected && "text-muted")}>{selected?.label ?? "—"}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div
        ref={popRef}
        popover="manual"
        tabIndex={-1}
        onKeyDown={onListKey}
        className="fixed inset-auto m-0 flex flex-col overflow-hidden rounded-card border border-border bg-surface p-0 text-sm text-foreground shadow-pop"
      >
        {open && (
          <>
            {withSearch && (
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="size-4 shrink-0 text-muted" aria-hidden />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder={t("selectSearch")}
                  aria-label={t("selectSearch")}
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-disabled focus-visible:outline-none"
                />
              </div>
            )}
            <ul id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto py-1">
              {shown.length === 0 ? (
                <li className="px-3 py-2 text-muted">{t("selectNoMatches")}</li>
              ) : (
                shown.map((o, i) => (
                  <li
                    key={`${o.value}-${i}`}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={o.value === current}
                    aria-disabled={o.disabled || undefined}
                    onPointerEnter={() => !o.disabled && setActive(i)}
                    onClick={() => !o.disabled && choose(o.value)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 px-3 py-2",
                      i === active && "bg-surface-muted",
                      o.value === current && "font-medium text-primary-strong",
                      o.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="min-w-0 break-words">{o.label}</span>
                    {o.value === current && <Check className="size-4 shrink-0" aria-hidden />}
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>
    </span>
  );
});
