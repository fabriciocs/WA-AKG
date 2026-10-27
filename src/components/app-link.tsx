"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useAppBasePath, withAppBasePath } from "@/components/app-base-path";

type Props = ComponentProps<typeof Link>;

export default function AppLink({ href, ...props }: Props) {
  const basePath = useAppBasePath();
  return <Link href={withAppBasePath(href, basePath)} {...props} />;
}
