"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { askAssistantAction } from "@/app/(site)/assistant-actions";

type Turn = { role: "user" | "assistant"; content: string; links?: { label: string; href: string }[]; handover?: boolean; service?: string | null };

/**
 * Website assistant: a small chat panel (bottom left). Answers come from the site's own content via the server;
 * the visitor can hand over to a person at any time through the enquiry form, pre-filled with their question.
 */
export function VisitorAssistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q.slice(0, 600) }];
    setTurns(next);
    setText("");
    setBusy(true);
    setError("");
    const r = await askAssistantAction(next.map(({ role, content }) => ({ role, content })));
    setBusy(false);
    if (r.ok) setTurns([...next, { role: "assistant", content: r.reply.answer, links: r.reply.links, handover: r.reply.handover, service: r.reply.service }]);
    else setError(r.message);
  }

  const lastQuestion = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const service = [...turns].reverse().find((t) => t.service)?.service ?? "";
  const handoverHref = `/contact?${new URLSearchParams({ ...(service ? { service } : {}), ...(lastQuestion ? { message: lastQuestion.slice(0, 500) } : {}) }).toString()}`;

  return (
    <div className="print:hidden">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-20 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-brand-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-700 md:bottom-5">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
          Ask a question
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Website assistant" className="fixed bottom-4 left-4 right-4 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:right-auto sm:w-96">
          <header className="flex items-start justify-between gap-3 bg-brand-900 px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-semibold">Ask Synclytics</h2>
              <p className="text-xs text-blue-100">AI assistant · answers come from this website and can be wrong. A person confirms anything important.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/10" aria-label="Close the assistant">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <ol ref={log} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {turns.length === 0 && <li className="text-slate-600">Ask about our services, how we work or a product. For a price or a call, the team will take over.</li>}
            {turns.map((t, i) => (
              <li key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-slate-100 px-3 py-2 text-slate-900" : "mr-4 rounded-lg border border-slate-200 px-3 py-2 text-slate-800"}>
                <span className="sr-only">{t.role === "user" ? "You: " : "Assistant: "}</span>
                <p className="whitespace-pre-line">{t.content}</p>
                {t.links && t.links.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {t.links.map((l) => (
                      <li key={l.href}><Link href={l.href} className="text-teal-700 underline" onClick={() => setOpen(false)}>{l.label}</Link></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {busy && <li className="text-slate-600">Thinking…</li>}
          </ol>
          {error && <p role="alert" className="mx-4 mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
          <div className="border-t border-slate-200 px-4 py-3">
            <form onSubmit={send} className="flex gap-2">
              <label htmlFor="assistant-q" className="sr-only">Your question</label>
              <input ref={input} id="assistant-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} className="field" placeholder="Type your question" autoComplete="off" />
              <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
            </form>
            <p className="mt-2 text-xs text-slate-600">
              Don&apos;t share passwords or payment details here. <Link href={handoverHref} className="font-medium text-teal-700 underline" onClick={() => setOpen(false)}>Talk to a person</Link>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
