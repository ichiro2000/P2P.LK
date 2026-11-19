import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/** Minimal frame for sign-up, sign-in, verify, password reset and account
 *  status: brand, a centred card, theme toggle and a way back. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
        <Link href="/" aria-label="P2P.LK home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Brand />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-4 pb-10 sm:justify-center sm:px-6 sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" />
          Back to live markets
        </Link>
      </footer>
    </div>
  );
}
