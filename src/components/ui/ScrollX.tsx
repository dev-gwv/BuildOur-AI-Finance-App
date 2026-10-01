"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A sideways-scrolling box for tables that can be wider than the screen. A
 * plain overflow-x-auto box gives no sign there's more to the right (and the
 * scrollbar is hidden on touchpads and phones), so the last columns just look
 * cut off. This fades the edge that has more behind it and puts a button
 * there, level with the header row so it's in view, that scrolls it across.
 */
export function ScrollX({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setMore({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>
      {more.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-start bg-gradient-to-r from-white to-transparent print:hidden dark:from-neutral-900">
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Scroll the table left"
            className="pointer-events-auto ml-1 mt-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}
      {more.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-start justify-end bg-gradient-to-l from-white to-transparent print:hidden dark:from-neutral-900">
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Scroll the table right"
            className="pointer-events-auto mr-1 mt-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
