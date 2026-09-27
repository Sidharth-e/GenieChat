"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkEmoji from "remark-emoji";

import rehypeSlug from "rehype-slug";

import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/chat/code-block";
import { ImageBlock } from "@/components/chat/image-block";
import {
  TableBlock,
  TableHeadSection,
  TableBodySection,
  TableHeader,
  TableCell,
  TableRow,
} from "@/components/chat/table-block";

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks, remarkEmoji];
const REHYPE_PLUGINS = [rehypeKatex, rehypeSlug];

interface MarkdownRendererProps {
  content: string;
  className?: string;
  citations?: string[];
  isStreaming?: boolean;
}

function normalizeMathSegment(segment: string): string {
  if (!segment) return segment;

  return segment
    // Escape dollar signs followed by digits to prevent them from being misinterpreted as math delimiters (currency)
    .replace(/\$(?=\d)/g, "\\$")
    // Convert alternate LaTeX delimiters \[ \] to $$ $$
    .replace(/\\\[([\s\S]+?)\\\]/g, (match, expression: string) => {
      const trimmed = expression.trim();
      if (!trimmed) {
        return match;
      }
      return `\n$$\n${trimmed}\n$$\n`;
    })
    // Convert alternate LaTeX delimiters \( \) to $ $
    // This fix replaces the buggy [^\\n] which was excluding the letter 'n'
    .replace(/\\\(([\s\S]+?)\\\)/g, (match, expression: string) => {
      const trimmed = expression.trim();
      if (!trimmed) {
        return match;
      }
      return `$${trimmed}$`;
    });
}

function ensureClosedCodeFences(content: string): string {
  let fenceCount = 0;
  const lines = content.split("\n");
  for (const line of lines) {
    if (/^`{3,}/.test(line.trimStart())) {
      fenceCount++;
    }
  }
  if (fenceCount % 2 !== 0) {
    return content + "\n```";
  }
  return content;
}

/**
 * Normalize alternate LaTeX delimiters while keeping code snippets untouched.
 */
function normalizeMathContent(markdown: string): string {
  const codePattern = /(```[\s\S]*?```|```[\s\S]*$|`[^`\n]+`)/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(markdown)) !== null) {
    result += normalizeMathSegment(markdown.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  result += normalizeMathSegment(markdown.slice(lastIndex));
  return result;
}

function hasKatexClassName(className?: string): boolean {
  if (!className) {
    return false;
  }

  return className
    .split(/\s+/)
    .some((token) => token === "katex" || token === "katex-display");
}

function isStandaloneMathParagraph(children: React.ReactNode): boolean {
  const nonEmptyChildren = React.Children.toArray(children).filter((child) => {
    if (typeof child === "string") {
      return child.trim().length > 0;
    }
    return child !== null && child !== undefined;
  });

  if (nonEmptyChildren.length !== 1) {
    return false;
  }

  const onlyChild = nonEmptyChildren[0];
  if (!React.isValidElement<{ className?: string }>(onlyChild)) {
    return false;
  }

  return hasKatexClassName(onlyChild.props.className);
}

/**
 * Process text content to convert citation markers [1], [2], etc. to styled links
 */
function processCitations(text: string, citations?: string[]): React.ReactNode {
  if (!citations || citations.length === 0) {
    return text;
  }

  // Match patterns like [1], [2], [3][4], [1][2][5]
  const citationPattern = /\[(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = citationPattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const citationNumber = parseInt(match[1], 10);
    const citationUrl = citations[citationNumber - 1]; // Citations are 1-indexed

    if (citationUrl) {
      parts.push(
        <a
          key={`citation-${match.index}`}
          href={citationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center px-1 py-0.5 mx-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded transition-colors cursor-pointer no-underline"
          title={citationUrl}
        >
          {citationNumber}
        </a>,
      );
    } else {
      // Citation number doesn't have a corresponding URL, keep original text
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function MarkdownRendererBase({
  content,
  className,
  citations,
  isStreaming,
}: MarkdownRendererProps) {
  const normalizedContent = React.useMemo(() => {
    const processed = isStreaming ? ensureClosedCodeFences(content) : content;
    return normalizeMathContent(processed);
  }, [content, isStreaming]);

  const components = React.useMemo(
    () => ({
      code({
        className,
        children,
        ...props
      }: {
        inline?: boolean;
        className?: string;
        children?: React.ReactNode;
      } & React.HTMLAttributes<HTMLElement>) {
        return (
          <CodeBlock className={className} isStreaming={isStreaming} {...props}>
            {children}
          </CodeBlock>
        );
      },
      pre({ children }: React.ComponentPropsWithoutRef<"pre">) {
        return <>{children}</>;
      },
      p({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
        const mathOnlyParagraph = isStandaloneMathParagraph(children);
        const childArray = React.Children.toArray(children);
        const hasBlockChild = childArray.some(
          (child) =>
            React.isValidElement(child) &&
            (child.type === "div" || child.type === "pre" || child.type === "p" || child.type === ImageBlock),
        );
        const isImageOnly = childArray.length === 1 &&
          React.isValidElement(childArray[0]) &&
          childArray[0].type === ImageBlock;
        const Tag = hasBlockChild ? "div" : "p";
        return (
          <Tag
            {...props}
            className={cn(props.className, mathOnlyParagraph && "math-equation-block", isImageOnly && "!my-0")}
          >
            {React.Children.map(children, (child) => {
              if (typeof child === "string") {
                return processCitations(child, citations);
              }
              return child;
            })}
          </Tag>
        );
      },
      li({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
        return (
          <li {...props}>
            {React.Children.map(children, (child) => {
              if (typeof child === "string") {
                return processCitations(child, citations);
              }
              return child;
            })}
          </li>
        );
      },
      a({
        href,
        children,
        ...props
      }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 underline underline-offset-2"
            {...props}
          >
            {children}
          </a>
        );
      },
      table({ children, ...props }: React.ComponentPropsWithoutRef<"table">) {
        return <TableBlock {...props}>{children}</TableBlock>;
      },
      thead({ children, ...props }: React.ComponentPropsWithoutRef<"thead">) {
        return <TableHeadSection {...props}>{children}</TableHeadSection>;
      },
      tbody({ children, ...props }: React.ComponentPropsWithoutRef<"tbody">) {
        return <TableBodySection {...props}>{children}</TableBodySection>;
      },
      tr({ children, ...props }: React.ComponentPropsWithoutRef<"tr">) {
        return <TableRow {...props}>{children}</TableRow>;
      },
      th({ children, ...props }: React.ComponentPropsWithoutRef<"th">) {
        return (
          <TableHeader {...props}>
            {React.Children.map(children, (child) => {
              if (typeof child === "string") {
                return processCitations(child, citations);
              }
              return child;
            })}
          </TableHeader>
        );
      },
      td({ children, ...props }: React.ComponentPropsWithoutRef<"td">) {
        return (
          <TableCell {...props}>
            {React.Children.map(children, (child) => {
              if (typeof child === "string") {
                return processCitations(child, citations);
              }
              return child;
            })}
          </TableCell>
        );
      },
      blockquote({
        children,
        ...props
      }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) {
        return (
          <blockquote {...props}>
            {React.Children.map(children, (child) => {
              if (typeof child === "string") {
                return processCitations(child, citations);
              }
              return child;
            })}
          </blockquote>
        );
      },
      img({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
        if (!src || typeof src !== "string") return null;
        return <ImageBlock src={src} alt={alt || "Generated image"} />;
      },
    }),
    [citations, isStreaming],
  );

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = React.memo(MarkdownRendererBase);

// Common prose styling classes for message content
export const messageContentStyles = cn(
  "prose prose-zinc dark:prose-invert max-w-none",
  "prose-p:leading-7 prose-p:my-3 prose-img:my-0",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-4 prose-pre:border-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:bg-tertiary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-normal",
  "prose-headings:font-semibold prose-headings:text-tertiary",
  "prose-ul:my-4 prose-ol:my-4 prose-li:my-1",
  "prose-table:my-4 prose-th:p-2 prose-td:p-2",
  "prose-strong:font-semibold prose-strong:text-tertiary",
  "prose-blockquote:border-l-4 prose-blockquote:border-primary/50 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-tertiary",
  "text-tertiary",
);
