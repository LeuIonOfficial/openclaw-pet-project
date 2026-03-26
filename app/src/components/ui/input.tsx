import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus-visible:border-amber-300/70 focus-visible:ring-2 focus-visible:ring-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
