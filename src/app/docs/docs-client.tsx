"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "@/components/app-link";
import { Menu, Search, ChevronRight, Copy, Check } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { BrandConfig } from "@/lib/branding";

interface TocItem {
    text: string;
    id: string;
}

interface TocSection {
    title: string;
    id: string;
    items: TocItem[];
}

interface DocsClientProps {
    content: string;
    toc: TocSection[];
    brandConfig: BrandConfig;
}

interface MarkdownCodeProps extends React.ComponentProps<"code"> {
    node?: unknown;
    inline?: boolean;
}

const MarkdownCode: React.FC<MarkdownCodeProps> = ({ node, inline, className, children, ...props }) => {
    void node;
    const match = /language-(\w+)/.exec(className || "");
    const codeStr = String(children).replace(/\n$/, "");
    return !inline && match ? (
        <div className="rounded-xl overflow-hidden my-6 border border-border shadow-sm bg-foreground">
            <div className="bg-muted/90 px-4 py-2.5 flex items-center justify-between border-b border-border">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{match[1]}</span>
                <CopyButton code={codeStr} />
            </div>
            <pre className="text-background text-sm leading-loose overflow-x-auto p-5 m-0 selection:bg-primary/40">
                <code className="font-mono">{codeStr}</code>
            </pre>
        </div>
    ) : (
        <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-sm font-mono border border-border break-all" {...props}>
            {children}
        </code>
    );
};

function withoutMarkdownNode<T extends { node?: unknown }>({ node, ...props }: T): Omit<T, "node"> {
    void node;
    return props;
}

function CopyButton({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => toast.error("Copy failed"));
    }, [code]);
    return (
        <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-h-8"
            aria-label={copied ? "Copied code" : "Copy code"}
        >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="font-medium">{copied ? "Copied!" : "Copy"}</span>
        </button>
    );
}

export function DocsClient({ content, toc, brandConfig }: DocsClientProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [openMobileMenu, setOpenMobileMenu] = useState(false);
    const [sectionState, setSectionState] = useState<{ query: string; values: Record<string, boolean> }>({ query: "", values: {} });

    // Debounce search query to prevent excessive re-renders
    const [debouncedQuery, setDebouncedQuery] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const filteredToc = useMemo(() => {
        if (!debouncedQuery) {
            return toc;
        }

        const lowerQuery = debouncedQuery.toLowerCase();
        const filtered = toc.map(section => {
            const titleMatches = section.title.toLowerCase().includes(lowerQuery);
            const matchingItems = section.items.filter(item =>
                item.text.toLowerCase().includes(lowerQuery)
            );

            if (titleMatches || matchingItems.length > 0) {
                return {
                    ...section,
                    items: titleMatches ? section.items : matchingItems
                };
            }
            return null;
        }).filter(Boolean) as TocSection[];

        return filtered;
    }, [debouncedQuery, toc]);

    const openSections = sectionState.query === debouncedQuery ? sectionState.values : {};

    const toggleSection = (id: string) => {
        setSectionState((prev) => {
            const values = prev.query === debouncedQuery ? prev.values : {};
            return {
                query: debouncedQuery,
                values: { ...values, [id]: !(values[id] ?? true) },
            };
        });
    };

    const scrollToSection = (id: string, closeMobile = true) => {
        const element = document.getElementById(id);
        if (element) {
            const headerOffset = 100;
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: "smooth"
            });
            if (closeMobile) setOpenMobileMenu(false);
        }
    };

    // Memoized Sidebar Item to prevent full list re-renders
    const SidebarItem = React.memo(({ section, isOpen, onToggle, onScroll, isMobile }: {
        section: TocSection,
        isOpen: boolean,
        onToggle: (id: string) => void,
        onScroll: (id: string, mobile: boolean) => void,
        isMobile: boolean
    }) => (
        <div className="space-y-1">
            <button
                onClick={() => section.items.length > 0 ? onToggle(section.id) : onScroll(section.id, isMobile)}
                className="flex items-center justify-between w-full text-left font-semibold text-foreground hover:text-primary transition-colors py-2.5 group"
                aria-expanded={section.items.length > 0 ? isOpen : undefined}
                aria-controls={section.items.length > 0 ? `${section.id}-items` : undefined}
            >
                <span className="truncate pr-2">{section.title}</span>
                {section.items.length > 0 && (
                    <ChevronRight
                        className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-primary ${isOpen ? "rotate-90" : ""}`}
                    />
                )}
            </button>

            {isOpen && (
                <div id={`${section.id}-items`} className="space-y-1 ml-2 border-l border-border pl-2">
                    {section.items.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onScroll(item.id, isMobile)}
                            className="block text-left w-full text-sm text-muted-foreground hover:text-primary hover:bg-muted py-2.5 px-2 rounded transition-colors truncate"
                            title={item.text}
                        >
                            {item.text}
                        </button>
                    ))}
                    {section.items.length === 0 && (
                        <p className="text-xs text-muted-foreground italic px-2 py-1">No subsections</p>
                    )}
                </div>
            )}
        </div>
    ));
    SidebarItem.displayName = "SidebarItem";

    const renderSidebarContent = (isMobile = false) => (
        <nav className="space-y-2 pb-8"> {/* Reduced space-y */}
            {filteredToc.length > 0 ? (
                filteredToc.map((section) => (
                    <SidebarItem
                        key={section.id}
                        section={section}
                        isOpen={!!openSections[section.id]}
                        onToggle={toggleSection}
                        onScroll={scrollToSection}
                        isMobile={isMobile}
                    />
                ))
            ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
        </nav>
    );

    return (
        <div className="flex-1 max-w-7xl mx-auto w-full flex items-start relative px-4 sm:px-6 lg:px-8">
            {/* Sidebar (Desktop) */}
            <aside className="hidden lg:block w-72 sticky top-20 h-[calc(100vh-6rem)] overflow-y-auto border-r border-border pr-6 mt-8 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                <div className="mb-8 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Filter documentation..."
                        aria-label="Filter documentation"
                        className="w-full pl-9 pr-4 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary transition-all placeholder:text-muted-foreground"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {renderSidebarContent(false)}
            </aside>

            {/* Mobile Sidebar (Drawer) */}
            <div className="lg:hidden fixed bottom-4 right-4 z-50">
                <Sheet open={openMobileMenu} onOpenChange={setOpenMobileMenu}>
                    <SheetTrigger asChild>
                        <Button size="icon" aria-label="Open documentation navigation" className="h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground transition-transform hover:scale-105 active:scale-95">
                            <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-[85vw] sm:w-[400px] p-0 flex flex-col"> {/* Adjusted width for mobile */}
                        <div className="p-6 border-b border-border bg-muted/50">
                            <h2 className="text-lg font-bold text-foreground">{brandConfig.name} documentation</h2>
                            <p className="text-xs text-muted-foreground mt-1">Navigate through API sections</p>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto overscroll-contain"> {/* Added overscroll-contain */}
                            <div className="mb-6 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search topic..."
                                    aria-label="Search documentation"
                                    className="w-full pl-9 pr-4 py-3 text-base bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {renderSidebarContent(true)}
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            {/* Main Content */}
            <main className="flex-1 min-w-0 py-6 lg:py-8 lg:pl-12 overflow-x-hidden">
                <div className="bg-primary/5 border border-primary/20 p-3 sm:p-4 mb-8 rounded-xl">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-foreground">
                                For the most up-to-date API reference and interactive testing, check the <Link href="/swagger" className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">Swagger UI</Link> or the <Link href="/dashboard/api-docs" className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">Dashboard API Docs</Link>.
                            </p>
                        </div>
                    </div>
                </div>

                <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 break-words">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            h2: (markdownProps) => {
                                const props = withoutMarkdownNode(markdownProps);
                                const id = props.children?.toString().toLowerCase().replace(/[^\w]+/g, '-') || '';
                                return <h2 id={id} {...props} className="text-2xl font-bold mt-12 mb-6 border-b border-border pb-2 scroll-mt-24" />
                            },
                            h3: (markdownProps) => {
                                const props = withoutMarkdownNode(markdownProps);
                                const id = props.children?.toString().toLowerCase().replace(/[^\w]+/g, '-') || '';
                                return <h3 id={id} {...props} className="text-xl font-semibold mt-8 mb-4 scroll-mt-24" />
                            },
                            code: MarkdownCode,
                            table: (markdownProps) => (
                                <div className="overflow-x-auto my-6 border border-border rounded-lg shadow-sm">
                                    <table {...withoutMarkdownNode(markdownProps)} className="min-w-full divide-y divide-border text-sm sm:text-base" />
                                </div>
                            ),
                            thead: (markdownProps) => <thead {...withoutMarkdownNode(markdownProps)} className="bg-muted" />,
                            th: (markdownProps) => <th {...withoutMarkdownNode(markdownProps)} className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider" />,
                            td: (markdownProps) => <td {...withoutMarkdownNode(markdownProps)} className="px-3 sm:px-4 py-3 text-sm text-muted-foreground break-words whitespace-normal" />,
                            pre: (markdownProps) => <pre {...withoutMarkdownNode(markdownProps)} /> // Passthrough to code block handler
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </article>

                <footer className="mt-20 pt-8 border-t border-border text-center text-sm text-muted-foreground">
                    <p>© {new Date().getFullYear()} {brandConfig.name}. All rights reserved.</p>
                </footer>
            </main>
        </div>
    );
}

