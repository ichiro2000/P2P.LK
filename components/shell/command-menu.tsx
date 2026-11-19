"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });

type Ctx = { open: boolean; setOpen: (open: boolean) => void };
const CommandMenuContext = createContext<Ctx | null>(null);

export function useCommandMenu(): Ctx {
  const ctx = useContext(CommandMenuContext);
  if (!ctx)
    throw new Error("useCommandMenu must be used inside <CommandMenuProvider>");
  return ctx;
}

/**
 * Global ⌘K / Ctrl+K palette: jump to any page, any merchant on the active
 * exchange, switch exchange or theme, and account actions (sign in / up for
 * guests; dashboard, account, sign out when signed in). Merchants load lazily the first time
 * the palette opens (and again after an exchange switch).
 */
export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Mount (and download) the palette only once it has been opened.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandMenuContext.Provider value={{ open, setOpen }}>
      {children}
      {used && <CommandPalette open={open} setOpen={setOpen} />}
    </CommandMenuContext.Provider>
  );
}

/** Search field look-alike that opens the palette. Collapses to an icon on
 *  small screens. */
export function CommandMenuTrigger({ className }: { className?: string }) {
  const { setOpen } = useCommandMenu();
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "hidden h-8 w-56 justify-start gap-2 bg-muted/40 px-2.5 text-sm font-normal text-muted-foreground shadow-none lg:flex xl:w-64",
          className,
        )}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
      </Button>
    </>
  );
}
