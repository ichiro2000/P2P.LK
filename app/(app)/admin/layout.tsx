import { AdminNav } from "@/components/admin/admin-nav";
import { getViewer, isAdmin } from "@/lib/auth/session";
import { NOINDEX_NOFOLLOW } from "@/lib/seo";

/** Every admin page stays out of search, including ones added later. */
export const metadata = { robots: NOINDEX_NOFOLLOW };

/**
 * The admin sub-nav, shown to admins only. Access control lives in each
 * page (`requireAdminPage(path)`): a layout can be skipped by client
 * navigation requests, and the page knows its own path for `?next=`.
 *
 * Each page renders its own sticky <Topbar> (a <header>) first. The sub-nav
 * has to sit under it, so this wrapper is a flex column that orders the
 * header first, the nav second and the page body after — no page changes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdmin(await getViewer())) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-1 flex-col [&>*]:order-3 [&>header]:order-1 [&>[data-slot=admin-nav]]:order-2">
      <AdminNav />
      {children}
    </div>
  );
}
