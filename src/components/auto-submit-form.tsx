"use client";

import { useRef } from "react";

/**
 * A GET form whose drop-downs apply as soon as they change (the search box applies on Enter). The submit button
 * stays for keyboard users and browsers without JavaScript.
 */
export function AutoSubmitForm({ children, className, action }: { children: React.ReactNode; className?: string; action: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      role="search"
      action={action}
      className={className}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") form.current?.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
