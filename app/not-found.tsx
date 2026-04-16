import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { Sidebar } from "@/components/shell/sidebar";

export default function NotFound() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Not found" subtitle="404" />
        <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            404 · No such market
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            The page you&apos;re after is off-book
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Either the URL is wrong or this market isn&apos;t tracked yet.
            Head back to live markets to pick a fiat.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Go to live markets
          </Link>
        </div>
      </div>
    </div>
  );
}
