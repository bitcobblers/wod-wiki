/**
 * Dropdown menu component — controlled wrapper with portal-based positioning
 * and keyboard navigation.
 *
 * Keeps the existing controlled API (open / onOpenChange) for backward
 * compatibility with ~10 callers.  Internals use a React portal so content
 * is never clipped by overflow:hidden ancestors.
 */
import * as React from "react"
import * as ReactDOM from "react-dom"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Context for sharing menu state and item registry
// ---------------------------------------------------------------------------

interface DropdownMenuContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLDivElement | null>
  registerItem: (id: string, ref: React.RefObject<HTMLElement | null>) => void
  unregisterItem: (id: string) => void
  getItemIndex: (id: string) => number
  activeIndex: number
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>
  itemCount: number
  /** This menu's instance id. */
  menuId: string
  /** Ancestor-ordered id chain (root…this menu) — portals tag it so
   *  outside-click handlers can tell "portal of my descendant" (interior)
   *  from "portal of my ancestor/sibling" (exterior). */
  portalChain: string
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenu() {
  const ctx = React.useContext(DropdownMenuContext)
  if (!ctx) {
    throw new Error("DropdownMenu components must be used inside a DropdownMenu")
  }
  return ctx
}

/**
 * Close the enclosing dropdown, if there is one.
 *
 * A menu item that opens a MODAL (the page's query settings) must dismiss
 * the menu first: the menu's content is portaled at a higher z-index than
 * the modal's overlay, so a still-open menu would paint over the dialog.
 * Returns a no-op outside a menu — the same trigger renders inside a menu
 * on some breakpoints and outside it on others.
 */
export function useCloseDropdownMenu(): () => void {
  const ctx = React.useContext(DropdownMenuContext)
  return React.useCallback(() => {
    ctx?.setIsOpen(false)
  }, [ctx])
}

// ---------------------------------------------------------------------------
// DropdownMenu — controlled state wrapper
// ---------------------------------------------------------------------------

interface DropdownMenuProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, open, onOpenChange }) => {
  const parentCtx = React.useContext(DropdownMenuContext)
  const menuId = React.useId()
  const portalChain = parentCtx ? `${parentCtx.portalChain}/${menuId}` : menuId
  const [isOpen, setIsOpen] = React.useState(open ?? false)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const itemsRef = React.useRef<Map<string, React.RefObject<HTMLElement | null>>>(new Map())
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0)

  // Sync controlled open prop
  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    setIsOpen(newOpen)
    setActiveIndex(-1)
    onOpenChange?.(newOpen)
  }, [onOpenChange])

  const registerItem = React.useCallback((id: string, ref: React.RefObject<HTMLElement | null>) => {
    itemsRef.current.set(id, ref)
    forceUpdate()
  }, [])

  const unregisterItem = React.useCallback((id: string) => {
    itemsRef.current.delete(id)
    forceUpdate()
  }, [])

  const getItemIndex = React.useCallback((id: string) => {
    const keys = Array.from(itemsRef.current.keys())
    return keys.indexOf(id)
  }, [])

  const itemCount = itemsRef.current.size

  const value = React.useMemo(
    () => ({
      isOpen,
      setIsOpen: handleOpenChange,
      triggerRef,
      registerItem,
      unregisterItem,
      getItemIndex,
      activeIndex,
      setActiveIndex,
      itemCount,
      menuId,
      portalChain,
    }),
    [isOpen, handleOpenChange, registerItem, unregisterItem, getItemIndex, activeIndex, itemCount, menuId, portalChain]
  )

  return (
    <DropdownMenuContext.Provider value={value}>
      <div ref={triggerRef} className="relative inline-block">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// DropdownMenuTrigger
// ---------------------------------------------------------------------------

interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const { isOpen, setIsOpen } = useDropdownMenu()

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsOpen(!isOpen)
    }

    if (asChild && React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)) {
      return React.cloneElement(children, {
        ...props,
        onClick: handleClick,
      } as React.HTMLAttributes<HTMLElement>)
    }

    return (
      <button
        ref={ref}
        className={className}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

// ---------------------------------------------------------------------------
// DropdownMenuContent
// ---------------------------------------------------------------------------

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end"
  side?: "top" | "bottom"
}

export const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, children, align = "center", side = "bottom", ...props }, ref) => {
    const { isOpen, setIsOpen, triggerRef, setActiveIndex, itemCount, menuId, portalChain } = useDropdownMenu()
    const internalRef = React.useRef<HTMLDivElement>(null)
    const contentRef = (ref as React.RefObject<HTMLDivElement | null>) || internalRef
    const [position, setPosition] = React.useState<{ top: number; bottom: number; left: number; width: number }>({
      top: 0,
      bottom: 0,
      left: 0,
      width: 0,
    })

    // Calculate position from trigger element
    React.useEffect(() => {
      if (!isOpen || !triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 8,
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        width: rect.width,
      })
    }, [isOpen, triggerRef])

    // Focus first item when opened
    React.useEffect(() => {
      if (!isOpen || itemCount === 0) return
      const id = setTimeout(() => {
        setActiveIndex(0)
      }, 0)
      return () => clearTimeout(id)
    }, [isOpen, itemCount, setActiveIndex])

    // Click outside to close
    React.useEffect(() => {
      if (!isOpen) return

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node
        if (contentRef.current && contentRef.current.contains(target)) return
        if (triggerRef.current && triggerRef.current.contains(target)) return
        // A nested dropdown (e.g. WqlWindowPicker inside a menu region)
        // portals its content to <body>. It is interior only when it belongs
        // to THIS menu or one of its descendants (the clicked portal's chain
        // contains our id); a sibling/ancestor menu's portal is exterior —
        // e.g. the nested picker must close when the user clicks back into
        // the surrounding parent menu.
        const chain = (target as HTMLElement)
          .closest?.("[data-dropdown-chain]")
          ?.getAttribute("data-dropdown-chain")
        if (chain && chain.split("/").includes(menuId)) return
        setIsOpen(false)
      }

      const id = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside)
      }, 0)
      return () => {
        clearTimeout(id)
        document.removeEventListener("mousedown", handleClickOutside)
      }
    }, [isOpen, setIsOpen, contentRef, triggerRef, menuId])

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (itemCount === 0) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setActiveIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0))
          break
        case "ArrowUp":
          e.preventDefault()
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1))
          break
        case "Home":
          e.preventDefault()
          setActiveIndex(0)
          break
        case "End":
          e.preventDefault()
          setActiveIndex(itemCount - 1)
          break
        case "Escape":
          e.preventDefault()
          setIsOpen(false)
          triggerRef.current?.querySelector("button")?.focus()
          break
        case "Tab":
          setIsOpen(false)
          break
      }
    }

    if (!isOpen) return null

    const posStyle: React.CSSProperties = {
      position: "fixed",
      zIndex: 9999,
    }

    if (side === "top") {
      posStyle.bottom = position.bottom
    } else {
      posStyle.top = position.top
    }

    if (align === "end") {
      posStyle.right = window.innerWidth - position.left - position.width
    } else if (align === "start") {
      posStyle.left = position.left
    } else {
      posStyle.left = position.left + position.width / 2
      posStyle.transform = "translateX(-50%)"
    }

    return ReactDOM.createPortal(
      <div
        ref={contentRef}
        role="menu"
        data-dropdown-chain={portalChain}
        className={cn(
          "min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
          className
        )}
        style={posStyle}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </div>,
      document.body
    )
  }
)
DropdownMenuContent.displayName = "DropdownMenuContent"

// ---------------------------------------------------------------------------
// DropdownMenuItem
// ---------------------------------------------------------------------------

interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  disabled?: boolean
  inset?: boolean
}

export const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, disabled, inset, onClick, onKeyDown, ...props }, forwardedRef) => {
    const { setIsOpen, registerItem, unregisterItem, getItemIndex, activeIndex } = useDropdownMenu()
    const id = React.useId()
    const internalRef = React.useRef<HTMLDivElement>(null)

    // Merge internal ref with forwarded ref
    const setRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        internalRef.current = node
        if (typeof forwardedRef === "function") {
          forwardedRef(node)
        } else if (forwardedRef) {
          ;(forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node
        }
      },
      [forwardedRef]
    )

    React.useEffect(() => {
      registerItem(id, internalRef as React.RefObject<HTMLElement | null>)
      return () => unregisterItem(id)
    }, [id, registerItem, unregisterItem])

    const index = getItemIndex(id)
    const isActive = index === activeIndex

    // Focus when this item becomes active
    React.useEffect(() => {
      if (isActive) {
        internalRef.current?.focus()
      }
    }, [isActive])

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return
      onClick?.(e)
      setIsOpen(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      onKeyDown?.(e)
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>)
        setIsOpen(false)
      }
    }

    return (
      <div
        ref={setRef}
        role="menuitem"
        tabIndex={disabled ? -1 : isActive ? 0 : -1}
        aria-disabled={disabled}
        data-active={isActive ? "true" : undefined}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
          "focus:bg-accent focus:text-accent-foreground",
          "data-[active]:bg-accent data-[active]:text-accent-foreground",
          inset && "pl-8",
          disabled && "pointer-events-none opacity-50",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...props}
      />
    )
  }
)
DropdownMenuItem.displayName = "DropdownMenuItem"

// ---------------------------------------------------------------------------
// DropdownMenuLabel
// ---------------------------------------------------------------------------

export const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = "DropdownMenuLabel"

// ---------------------------------------------------------------------------
// DropdownMenuSeparator
// ---------------------------------------------------------------------------

export const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
))
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"

// ---------------------------------------------------------------------------
// DropdownMenuHeading — section heading inside a dropdown menu
// ---------------------------------------------------------------------------

export function DropdownMenuHeading({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DropdownMenuShortcut — keyboard shortcut display
// ---------------------------------------------------------------------------

export function DropdownMenuShortcut({
  keys,
  className,
  ...props
}: { keys: string | string[]; className?: string } & React.ComponentPropsWithoutRef<"kbd">) {
  const keyList = typeof keys === "string" ? [keys] : keys
  return (
    <kbd
      {...props}
      className={cn(
        "ml-auto inline-flex items-center gap-0.5 text-xs tracking-widest text-muted-foreground",
        className
      )}
    >
      {keyList.map((key, i) => (
        <React.Fragment key={i}>
          <span>{key}</span>
          {i < keyList.length - 1 && <span>+</span>}
        </React.Fragment>
      ))}
    </kbd>
  )
}
