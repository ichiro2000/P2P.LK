import type { Page } from "@playwright/test";
import { adminTest, expect, memberTest, test } from "./support/fixtures";
import { ADMIN_PAGES, AUTH_PAGES, MEMBER_PAGES, PUBLIC_PAGES, resolvePath } from "./support/pages";

/**
 * Responsive audit: every page at phone, large phone, tablet, laptop and
 * desktop widths. Fails on
 *  - horizontal page scroll, and
 *  - any visible element that spills past the viewport edge without being
 *    inside its own horizontal scroll area (clipped / cut-off content).
 * Runs once (desktop project) and sets the viewport per width itself.
 */

const WIDTHS = [360, 390, 768, 1024, 1440] as const;

type Issue = { width: number; problem: string };

async function audit(page: Page, width: number): Promise<Issue[]> {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250); // let layout settle after the resize
  return page.evaluate((w) => {
    const issues: { width: number; problem: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) {
      issues.push({ width: w, problem: `page scrolls sideways: ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport` });
    }
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") && p.scrollWidth > p.clientWidth - 1) return true;
      }
      return false;
    };
    const seen = new Set<string>();
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.position === "fixed") continue;
      if (el.closest("[data-slot=sidebar], [aria-hidden=true], [hidden], svg, .sr-only")) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        if (inScroller(el)) continue;
        const label = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).split(/\s+/).slice(0, 3).join(".")}`;
        if (seen.has(label)) continue;
        seen.add(label);
        issues.push({ width: w, problem: `spills off-screen (${Math.round(r.left)}→${Math.round(r.right)}px): ${label.slice(0, 120)}` });
        if (seen.size > 5) break;
      }
    }
    return issues;
  }, width);
}

async function checkAllWidths(page: Page, path: string) {
  const all: Issue[] = [];
  for (const w of WIDTHS) all.push(...(await audit(page, w)));
  expect(all.map((i) => `[${i.width}px] ${i.problem}`), `${path} responsive issues`).toEqual([]);
}

test.describe("responsive · signed out", () => {
  for (const raw of [...PUBLIC_PAGES, ...AUTH_PAGES]) {
    test(raw, async ({ page, request }, info) => {
      test.skip(info.project.name !== "desktop", "sets its own viewport");
      const path = await resolvePath(request, raw);
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await checkAllWidths(page, path);
    });
  }
});

memberTest.describe("responsive · member", () => {
  for (const path of MEMBER_PAGES) {
    memberTest(path, async ({ page }, info) => {
      memberTest.skip(info.project.name !== "desktop", "sets its own viewport");
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await checkAllWidths(page, path);
    });
  }
});

adminTest.describe("responsive · admin", () => {
  for (const path of ADMIN_PAGES) {
    adminTest(path, async ({ page }, info) => {
      adminTest.skip(info.project.name !== "desktop", "sets its own viewport");
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await checkAllWidths(page, path);
    });
  }
});
