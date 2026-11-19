"use client";

/**
 * The ⌘K palette itself (cmdk + every item). Split from command-menu.tsx and
 * loaded on first open, so ~28 KB of cmdk stays off every page's first load.
 */
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowLeftRight,
  Clock,
  LayoutDashboard,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Sun,
  User,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useSignOut } from "@/components/auth/sign-out-button";
import { EXCHANGES, EXCHANGE_IDS } from "@/lib/exchanges";
import { useExchange } from "./exchange-context";
import { navSectionsFor } from "./nav-config";
import { useViewer } from "./viewer-context";

type MerchantHit = { id: string; name: string; isMerchant: boolean };

export default function CommandPalette({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { exchange, setExchange } = useExchange();
  const viewer = useViewer();
  const sections = navSectionsFor(viewer);
  const { signOut } = useSignOut();
  const [merchants, setMerchants] = useState<{
    exchange: string;
    list: MerchantHit[];
  } | null>(null);

  const needMerchants = open && merchants?.exchange !== exchange;
  useEffect(() => {
    if (!needMerchants) return;
    const ac = new AbortController();
    fetch(`/api/merchants?exchange=${exchange}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const list = (
          (json as { merchants?: MerchantHit[] } | null)?.merchants ?? []
        ).map((m) => ({
          id: m.id,
          name: m.name,
          isMerchant: m.isMerchant,
        }));
        setMerchants({ exchange, list });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [needMerchants, exchange]);

  const run = useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, [setOpen]);

  const list = merchants?.exchange === exchange ? merchants.list : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search P2P.LK"
      description="Pages, merchants and settings"
    >
      <Command>
        <CommandInput placeholder="Search pages, merchants, settings…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {sections.map((section) => (
            <CommandGroup key={section.title} heading={section.title}>
              {section.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.description ?? ""}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <item.icon />
                  <span>{item.label}</span>
                  {item.description && (
                    <span className="ml-2 hidden truncate text-xs text-muted-foreground sm:inline">
                      {item.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Account">
            {viewer ? (
              <>
                {viewer.member ? (
                  <CommandItem value="Account dashboard my p2p.lk" onSelect={() => run(() => router.push("/app"))}>
                    <LayoutDashboard /> Dashboard
                  </CommandItem>
                ) : (
                  <CommandItem value="Account status review pending" onSelect={() => run(() => router.push("/account/status"))}>
                    <Clock /> Account status
                  </CommandItem>
                )}
                <CommandItem value="Account profile settings" onSelect={() => run(() => router.push("/account"))}>
                  <UserRound /> Account
                </CommandItem>
                <CommandItem value="Sign out log out" onSelect={() => run(() => void signOut())}>
                  <LogOut /> Sign out
                </CommandItem>
              </>
            ) : (
              <>
                <CommandItem value="Sign in log in" onSelect={() => run(() => router.push("/sign-in"))}>
                  <LogIn /> Sign in
                </CommandItem>
                <CommandItem value="Sign up create free account register" onSelect={() => run(() => router.push("/sign-up"))}>
                  <UserPlus /> Create a free account
                </CommandItem>
              </>
            )}
          </CommandGroup>
          <CommandGroup heading="Exchange">
            {EXCHANGE_IDS.map((id) => (
              <CommandItem
                key={id}
                value={`Switch exchange ${EXCHANGES[id].label}`}
                onSelect={() => run(() => setExchange(id))}
              >
                <ArrowLeftRight />
                <span>Switch to {EXCHANGES[id].label}</span>
                {id === exchange && <CommandShortcut>Active</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Theme">
            <CommandItem
              value="Theme light"
              onSelect={() => run(() => setTheme("light"))}
            >
              <Sun /> Light
            </CommandItem>
            <CommandItem
              value="Theme dark"
              onSelect={() => run(() => setTheme("dark"))}
            >
              <Moon /> Dark
            </CommandItem>
            <CommandItem
              value="Theme system"
              onSelect={() => run(() => setTheme("system"))}
            >
              <Monitor /> System
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={`Merchants · ${EXCHANGES[exchange].label}`}>
            {list == null ? (
              <CommandItem disabled value="loading merchants">
                <span className="text-muted-foreground">
                  Loading merchants…
                </span>
              </CommandItem>
            ) : (
              list.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`merchant ${m.name} ${m.id}`}
                  onSelect={() =>
                    run(() =>
                      router.push(`/merchants/${encodeURIComponent(m.id)}`),
                    )
                  }
                >
                  <User />
                  <span className="truncate">{m.name}</span>
                  {m.isMerchant && (
                    <CommandShortcut>Verified</CommandShortcut>
                  )}
                </CommandItem>
              ))
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
