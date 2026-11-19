"use client";

import { useEffect } from "react";
import { hintServerMember } from "@/hooks/use-member-data";

/** Rendered by member-gated server pages: tells the client data layer that
 *  the server has confirmed this user as a member (the session cookie cache
 *  can lag a fresh approval by up to a minute). */
export function MemberHint({ userId }: { userId: string }) {
  useEffect(() => {
    hintServerMember(userId);
  }, [userId]);
  return null;
}
