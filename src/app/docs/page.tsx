import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import Link from '@/components/app-link';
import { getBrandConfig } from '@/lib/branding-server';
import { DocsClient } from './docs-client';

export async function generateMetadata(): Promise<Metadata> {
    const brand = await getBrandConfig();
    const title = `API Documentation | ${brand.name}`;
    const description = `${brand.description} Complete API reference for messaging, groups, contacts, media, and webhooks.`;

    return {
        title,
        description,
        openGraph: { title, description, type: 'website' },
        twitter: { card: 'summary_large_image', title, description },
    };
}

export interface TocItem {
    text: string;
    id: string;
}

export interface TocSection {
    title: string;
    id: string;
    items: TocItem[];
}

export default async function PublicDocsPage() {
    const brand = await getBrandConfig();
    const filePath = path.join(process.cwd(), 'docs', 'API_DOCUMENTATION.md');
    const packagePath = path.join(process.cwd(), 'package.json');
    let content = '';
    let version = 'v1.0.0';

    try {
        content = fs.readFileSync(filePath, 'utf8');
        // Strip extraneous backslash escapes used for markdown brackets.
        content = content.replace(/\\(\[)/g, '$1').replace(/\\(])/g, '$1');
        // Keep the checked-in reference readable while reflecting runtime branding.
        content = content.replaceAll('ConectaFlow', brand.name);
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        version = `v${packageJson.version}`;
    } catch (err) {
        content = '# Documentation unavailable\n\nCould not load the API documentation file.';
        console.error('Error loading docs:', err);
    }

    const toc: TocSection[] = [];
    let currentSection: TocSection | null = null;

    content.split('\n').forEach((line) => {
        if (line.startsWith('## ')) {
            const text = line.replace(/^## /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');
            if (currentSection) toc.push(currentSection);
            currentSection = { title: text, id, items: [] };
        } else if (line.startsWith('### ') && currentSection) {
            const text = line.replace(/^### /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');
            currentSection.items.push({ text, id });
        }
    });

    if (currentSection) toc.push(currentSection);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="bg-card/95 border-b border-border sticky top-0 z-30 shadow-sm/50 backdrop-blur">
                <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0" aria-label={brand.name}>
                            {brand.logoUrl ? (
                                <img src={brand.logoUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
                            ) : (
                                <span className="h-7 w-7 rounded-lg bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
                                    {brand.initials}
                                </span>
                            )}
                            <span className="text-lg sm:text-xl font-bold tracking-tight truncate">{brand.name}</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide border border-primary/20 shrink-0">
                            {version}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                        <Link href="/swagger" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                            Swagger UI
                        </Link>
                        <Link href="/dashboard" className="text-sm font-medium px-3 sm:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all shadow-sm">
                            Dashboard
                        </Link>
                    </div>
                </div>
            </header>

            <DocsClient content={content} toc={toc} brandConfig={brand} />
        </div>
    );
}
