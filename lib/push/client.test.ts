import { describe, expect, it } from "vitest";
import { b64urlDecode } from "./base64url";
import { afterSync, healAction, keyMatches } from "./client";
import { isIosDevice } from "@/lib/pwa/platform";
import { DISMISS_MS, isDismissed } from "@/lib/pwa/install-store";

describe("self-heal on app open/focus", () => {
  it("re-registers an existing subscription every time (refreshes last_seen_at)", () => {
    expect(healAction({ permission: "granted", hasSub: true, optedIn: true })).toBe("post");
    // Even if local storage was wiped (Safari ITP, cleared data).
    expect(healAction({ permission: "granted", hasSub: true, optedIn: false })).toBe("post");
  });

  it("re-subscribes when the browser dropped the subscription but the member opted in", () => {
    expect(healAction({ permission: "granted", hasSub: false, optedIn: true })).toBe("subscribe");
  });

  it("never subscribes a device the member didn't opt in on (e.g. another account signed in)", () => {
    expect(healAction({ permission: "granted", hasSub: false, optedIn: false })).toBe("none");
  });

  it("cleans up when permission was revoked", () => {
    expect(healAction({ permission: "denied", hasSub: true, optedIn: true })).toBe("drop");
    expect(healAction({ permission: "default", hasSub: true, optedIn: true })).toBe("drop");
    expect(healAction({ permission: "denied", hasSub: false, optedIn: true })).toBe("none");
  });

  it("acts on the server's answer", () => {
    expect(afterSync("known", true)).toBe("ok");
    expect(afterSync("created", null)).toBe("ok");
    expect(afterSync("known", false)).toBe("rekey"); // VAPID key rotated on the server
    expect(afterSync("removed", true)).toBe("forget"); // removed from the devices list
    expect(afterSync("gone", true)).toBe("replace"); // push service said 404/410
  });

  it("compares the subscription's applicationServerKey with the server key", () => {
    const key = "BNwCSU3PfDMU83LiCBUdiSUDn-828PGg8Om1h4-U0AAQNpARTRQEFans4QYcFX55yNRpHD18ovhPZRncG9weCIk";
    const raw = b64urlDecode(key).buffer;
    expect(keyMatches(raw, key)).toBe(true);
    const other = new Uint8Array(raw.slice(0));
    other[10] ^= 1;
    expect(keyMatches(other.buffer, key)).toBe(false);
    expect(keyMatches(null, key)).toBeNull();
  });
});

describe("install UI", () => {
  it("detects iPhone/iPad, including iPadOS reporting as a Mac", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });

  it("remembers a dismissal for 60 days", () => {
    const now = 1_800_000_000_000;
    expect(isDismissed(null, now)).toBe(false);
    expect(isDismissed("garbage", now)).toBe(false);
    expect(isDismissed(String(now - 1000), now)).toBe(true);
    expect(isDismissed(String(now - DISMISS_MS - 1), now)).toBe(false);
  });
});
