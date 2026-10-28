"use client";

import { useBranding } from "@/components/branding-provider";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
};

export function BrandMark({ className, imageClassName, fallbackClassName }: BrandMarkProps) {
  const brand = useBranding();

  if (brand.logoUrl) {
    return (
      <img
        src={brand.logoUrl}
        alt={`${brand.name} logo`}
        className={cn("h-16 w-16 rounded-2xl object-cover", className, imageClassName)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-primary text-xl font-bold text-white shadow-lg shadow-primary/30",
        className,
        fallbackClassName,
      )}
    >
      {brand.logoFallback}
    </span>
  );
}
