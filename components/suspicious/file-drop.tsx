"use client";

import { useState } from "react";
import { ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Big tap/drag target for a QR image. The file input covers the whole box. */
export function FileDrop({
  disabled,
  onFile,
  compact = false,
  id,
}: {
  disabled: boolean;
  onFile: (f: File) => void;
  compact?: boolean;
  id?: string;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        compact ? "min-h-28 p-4" : "min-h-36 p-6",
        dragging ? "border-foreground/50 bg-muted" : "border-border bg-muted/30 hover:bg-muted/60",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-background ring-1 ring-border">
        <ImageUp className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="text-sm">
        <span className="font-medium text-foreground">Choose a QR image</span>
        <span className="hidden text-muted-foreground sm:inline"> or drag it here</span>
      </span>
      <span className="text-xs text-muted-foreground">PNG or JPEG · decoded in your browser</span>
      <input
        id={id}
        type="file"
        accept="image/*"
        aria-label="QR image"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}
