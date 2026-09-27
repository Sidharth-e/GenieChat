import { useCallback, useEffect, useRef, useState } from "react";

interface UseAutoScrollOptions {
    offset?: number;
    smooth?: boolean;
}

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
    dependencies: unknown[],
    options: UseAutoScrollOptions = {}
) {
    const { offset = 80, smooth = false } = options;
    const scrollRef = useRef<T>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const lastScrollTop = useRef(0);
    const userScrolledUp = useRef(false);

    // Detect manual user scroll via direction — stable listener, no state in deps
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = el;
            const isNearBottom = scrollHeight - clientHeight - scrollTop < offset;
            // 2px threshold ignores sub-pixel jitter from layout reflows
            const scrolledUp = scrollTop < lastScrollTop.current - 2;
            lastScrollTop.current = scrollTop;

            if (scrolledUp && !isNearBottom) {
                userScrolledUp.current = true;
                setShouldAutoScroll(false);
            } else if (userScrolledUp.current && isNearBottom) {
                userScrolledUp.current = false;
                setShouldAutoScroll(true);
            }
        };

        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [offset]);

    // Auto-scroll on content changes — instant to avoid overlapping smooth animations
    useEffect(() => {
        if (!shouldAutoScroll) return;

        bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });

        // Fallback for layout shifts (images loading, dynamic content)
        const timeoutId = setTimeout(() => {
            bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
        }, 100);

        return () => clearTimeout(timeoutId);
    }, [dependencies, shouldAutoScroll]);

    // Force scroll to bottom (e.g. on new message submit)
    const scrollToBottom = useCallback(() => {
        userScrolledUp.current = false;
        setShouldAutoScroll(true);
        bottomRef.current?.scrollIntoView({
            behavior: smooth ? "smooth" : "auto",
            block: "end"
        });
    }, [smooth]);

    return {
        scrollRef,
        bottomRef,
        shouldAutoScroll,
        scrollToBottom,
    };
}
