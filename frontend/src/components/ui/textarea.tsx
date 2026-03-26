import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-2xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus-visible:border-amber-300/70 focus-visible:ring-2 focus-visible:ring-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
