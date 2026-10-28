"use client";
import { apiUrl } from "@/lib/api-url";

import { useEffect, useState, useSyncExternalStore } from "react";
import moment from "moment-timezone";
import { Clock } from "lucide-react";

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

export function RealtimeClock() {
    const [time, setTime] = useState("");
    const [timezone, setTimezone] = useState("Asia/Jakarta");
    const mounted = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot);

    useEffect(() => {
        // Fetch global timezone
        fetch(apiUrl('/api/settings/system'))
            .then(r => r.json())
            .then(data => {
                if (data && data.data && data.data.timezone) {
                    setTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!mounted) return;

        const updateTime = () => {
            setTime(moment().tz(timezone).format("HH:mm:ss"));
        };

        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [timezone, mounted]);

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border text-sm font-medium text-foreground" aria-label={`${time}, ${timezone}`}>
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{time}</span>
            <span className="text-xs text-muted-foreground border-l border-border pl-2 ml-1">{timezone}</span>
        </div>
    );
}
