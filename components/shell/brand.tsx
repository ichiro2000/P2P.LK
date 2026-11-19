import { cn } from "@/lib/utils";
import { ICON, ICON_TEXT, LK_TEXT, LOGO } from "@/lib/brand";

/** Square icon: block "P2P" knocked out of a rounded tile. The tile is the
 *  foreground colour and the letters the page background, so it inverts in
 *  dark mode. Used in the collapsed sidebar and other square spots. */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox={ICON.viewBox} className={cn("size-8 shrink-0 text-foreground", className)} aria-hidden>
      <rect width="100" height="100" rx={ICON.rx} fill="currentColor" />
      <path transform={ICON.text} d={ICON_TEXT} fill="var(--background)" />
    </svg>
  );
}

/** The logo: "P2P" and ".lk" knocked out of a rounded rectangle in the
 *  foreground colour — inverts cleanly in dark mode. */
export function BrandLogo({ className }: { className?: string }) {
  const b = LOGO.box;
  return (
    <svg viewBox={LOGO.viewBox} className={cn("h-7 w-auto shrink-0 text-foreground", className)} aria-hidden>
      <rect width={b.width} height={b.height} rx={b.rx} fill="currentColor" />
      <path transform={LOGO.p2p} d={ICON_TEXT} fill="var(--background)" />
      <path transform={LOGO.lk} d={LK_TEXT} fill="var(--background)" />
    </svg>
  );
}

/**
 * Site brand. The logo normally; in the collapsed (icon) sidebar the square
 * "P2P" icon. `compact` forces the icon.
 */
export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center select-none", className)}>
      {compact ? (
        <BrandIcon className="size-7!" />
      ) : (
        <>
          {/* "!" sizes: sidebar menu buttons force descendant svgs to 16 px; the
              collapsed rail button is 32 px with no padding, so the icon fills it. */}
          <BrandLogo className="h-10! w-auto! group-data-[collapsible=icon]:hidden" />
          <BrandIcon className="hidden size-8! group-data-[collapsible=icon]:block" />
        </>
      )}
      <span className="sr-only">P2P.LK</span>
    </div>
  );
}
