"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Subtle section reveal using IntersectionObserver.
 * Fades + rises 8px. One-shot per mount. Cheap and accessible —
 * reduced-motion users see content immediately.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Component = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: React.ElementType;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    // threshold: 0 fires the moment a single pixel is visible. Earlier
    // versions used threshold: 0.05 (5% of element visible), which is
    // unreachable for very tall elements — e.g. the /suspicious registry
    // list at ~610 entries is dozens of viewports tall, so no scroll
    // position can ever expose 5% of it and the section stays stuck at
    // opacity-0 forever. The rootMargin shrink is also dropped so reveal
    // fires as soon as the element touches the viewport bottom.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <Component
      ref={ref}
      style={{
        transitionDelay: `${delay}ms`,
      }}
      className={cn(
        "transition-all duration-500 ease-out will-change-transform",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0",
        className,
      )}
    >
      {children}
    </Component>
  );
}
