"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

export function LiveClock() {
  const [t, setT] = useState<string>("--:--:--");

  useEffect(() => {
    const tick = () => {
      const parts = formatter.formatToParts(new Date());
      const time = parts
        .filter((p) => ["hour", "minute", "second", "literal"].includes(p.type))
        .map((p) => p.value)
        .join("");
      const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
      setT(`${time.trim()} ${tz}`.trim());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <span suppressHydrationWarning>{t}</span>;
}
