"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The slice of the signed-in user the shell needs (server-rendered, so the
 *  topbar and sidebar paint in the right state with no flash). */
export type ShellViewer = {
  name: string;
  email: string;
  role: string;
  status: string;
  /** Approved (or admin): dashboard, alerts, workspace, reports. */
  member: boolean;
  admin: boolean;
};

const ViewerContext = createContext<ShellViewer | null>(null);

export function ViewerProvider({ viewer, children }: { viewer: ShellViewer | null; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

/** null for guests. */
export function useViewer(): ShellViewer | null {
  return useContext(ViewerContext);
}

export function initialsOf(v: Pick<ShellViewer, "name" | "email">): string {
  const parts = v.name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? v.email).slice(0, 2);
  return s.toUpperCase();
}
