"use client";

import { useSyncExternalStore, createContext, useContext } from "react";

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";
const SIDEBAR_CHANGE_EVENT = "sidebar-collapsed-change";

function subscribeToSidebarState(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
    };
}

function getSidebarSnapshot() {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
}

function getServerSidebarSnapshot() {
    return false;
}

interface SidebarContextType {
    isCollapsed: boolean;
    toggleCollapse: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
    isCollapsed: false,
    toggleCollapse: () => { },
});

export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
    const isCollapsed = useSyncExternalStore(
        subscribeToSidebarState,
        getSidebarSnapshot,
        getServerSidebarSnapshot,
    );

    const toggleCollapse = () => {
        const next = !getSidebarSnapshot();
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
        window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
    };

    return (
        <SidebarContext.Provider value={{ isCollapsed, toggleCollapse }}>
            {children}
        </SidebarContext.Provider>
    );
}
