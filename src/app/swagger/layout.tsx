import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getBrandConfig } from "@/lib/branding-server";

export async function generateMetadata(): Promise<Metadata> {
    const brand = await getBrandConfig();
    const title = `${brand.name} API Documentation`;
    const description = `${brand.description} Interactive OpenAPI reference and testing playground.`;

    return {
        title,
        description,
        openGraph: { title, description, type: "website" },
        twitter: { card: "summary_large_image", title, description },
    };
}

export default function SwaggerLayout({ children }: Readonly<{ children: ReactNode }>) {
    return children;
}
