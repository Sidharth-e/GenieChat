"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    autoResize?: boolean;
    maxHeight?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, autoResize = false, maxHeight = 200, ...props }, ref) => {
        const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

        const handleRef = React.useCallback(
            (node: HTMLTextAreaElement | null) => {
                textareaRef.current = node;
                if (typeof ref === "function") {
                    ref(node);
                } else if (ref) {
                    ref.current = node;
                }
            },
            [ref]
        );

        const adjustHeight = React.useCallback(() => {
            const textarea = textareaRef.current;
            if (textarea && autoResize) {
                textarea.style.height = "auto";
                const newHeight = Math.min(textarea.scrollHeight, maxHeight);
                textarea.style.height = `${newHeight}px`;
            }
        }, [autoResize, maxHeight]);

        React.useEffect(() => {
            adjustHeight();
        }, [props.value, adjustHeight]);

        return (
            <textarea
                className={cn(
                    "flex min-h-[44px] w-full resize-none text-sm transition-all duration-200 p-3",
                    "placeholder:text-text-secondary focus:outline-none bg-transparent",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "border-none focus-visible:ring-0 focus:ring-0 ring-0 focus-visible:ring-offset-0 ring-offset-0 shadow-none outline-none",
                    className
                )}
                ref={handleRef}
                onInput={adjustHeight}
                {...props}
            />
        );
    }
);
Textarea.displayName = "Textarea";

export { Textarea };
