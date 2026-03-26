import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/15 bg-white/10 text-slate-200",
        success: "border-emerald-300/40 bg-emerald-400/15 text-emerald-200",
        danger: "border-rose-300/40 bg-rose-400/15 text-rose-200",
        warning: "border-amber-300/40 bg-amber-300/20 text-amber-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
