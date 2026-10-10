import Link from "next/link";
import { getDb } from "@/server/db/client";
import type { Actor } from "@/server/authz/policy";
import { listNotifications, unreadCount } from "@/server/modules/notifications";
import { markNotificationsRead } from "@/app/notification-actions";
import { ActionForm } from "./action-form";
import { Ago, Card, EmptyState, PageHeader } from "./ui";
import { LiveRefresh } from "./live-refresh";

/** Header bell with unread count. */
export async function NotificationBell({ actor, href }: { actor: Actor; href: string }) {
  const n = await unreadCount(getDb(), actor);
  return (
    <Link href={href} className="relative inline-flex items-center rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={n ? `Notifications, ${n} unread` : "Notifications"}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{n > 99 ? "99+" : n}</span>
      )}
    </Link>
  );
}

/** Full list, shared by staff, customer and partner areas. */
export async function NotificationList({ actor, path }: { actor: Actor; path: string }) {
  const items = await listNotifications(getDb(), actor, 100);
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Things that need your attention or changed recently."
        actions={
          <>
            <LiveRefresh topics={["notifications"]} />
            {unread > 0 && (
              <ActionForm action={markNotificationsRead} inline submitLabel="Mark all as read" submitClassName="btn btn-ghost">
                <input type="hidden" name="path" value={path} />
              </ActionForm>
            )}
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="You're all caught up" />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${n.readAt ? "" : "font-medium"}`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    {!n.readAt && (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-teal-600" aria-hidden />
                        <span className="sr-only">Unread:</span>
                      </>
                    )}
                    {n.link ? (
                      <Link href={n.link} className="text-slate-900 hover:text-teal-700 hover:underline">{n.title}</Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  {n.body && <p className="mt-0.5 text-sm font-normal text-slate-600">{n.body}</p>}
                </div>
                <span className="flex items-center gap-3 text-xs font-normal text-slate-500">
                  <Ago value={n.createdAt} />
                  {!n.readAt && (
                    <ActionForm action={markNotificationsRead} inline submitLabel="Mark read" submitClassName="text-xs text-teal-700 hover:underline">
                      <input type="hidden" name="id" value={n.id} />
                      <input type="hidden" name="path" value={path} />
                    </ActionForm>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
