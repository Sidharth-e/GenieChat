"use client";

import { useRef, useState, useEffect } from "react";

function findNextWordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

function adjustPastBackticks(text: string, pos: number): number {
  while (pos < text.length && text[pos] === "`") {
    pos++;
  }
  return pos;
}

/**
 * Smooths SSE stream delivery by revealing text at word boundaries.
 * Aggressively catches up to the target so content appears at near-real-time
 * pace — eliminates chunk jitter without creating an artificial typing feel.
 */
export function useTypewriter(targetText: string, isActive: boolean): string {
  const [displayedText, setDisplayedText] = useState(
    isActive ? "" : targetText,
  );
  const [prevActive, setPrevActive] = useState(isActive);
  const [prevTargetText, setPrevTargetText] = useState(targetText);
  const revealedRef = useRef(0);
  const targetTextRef = useRef(targetText);

  if (isActive !== prevActive) {
    setPrevActive(isActive);
    if (isActive) {
      setDisplayedText("");
    }
  }

  if (targetText !== prevTargetText) {
    setPrevTargetText(targetText);
    if (isActive && targetText.length < prevTargetText.length) {
      setDisplayedText(targetText);
    }
  }

  useEffect(() => {
    targetTextRef.current = targetText;
  }, [targetText]);

  useEffect(() => {
    if (!isActive) {
      revealedRef.current = targetText.length;
    } else if (revealedRef.current > targetText.length) {
      revealedRef.current = 0;
    }
  }, [isActive, targetText.length]);

  useEffect(() => {
    if (!isActive) return;

    revealedRef.current = 0;
    let raf: number;

    const tick = () => {
      const target = targetTextRef.current;
      const current = revealedRef.current;

      if (current < target.length) {
        const backlog = target.length - current;

        let nextPos: number;
        if (backlog > 300) {
          nextPos = target.length;
        } else if (backlog > 120) {
          nextPos = Math.min(current + Math.ceil(backlog * 0.6), target.length);
        } else {
          nextPos = findNextWordEnd(target, current);
          if (backlog > 40) {
            nextPos = findNextWordEnd(target, nextPos);
          }
        }
        nextPos = adjustPastBackticks(target, nextPos);

        revealedRef.current = Math.min(nextPos, target.length);
        setDisplayedText(target.slice(0, revealedRef.current));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isActive]);

  if (!isActive) return targetText;
  return displayedText;
}
