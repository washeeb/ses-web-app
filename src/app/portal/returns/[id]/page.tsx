import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { AppError } from "@/server/lib/errors";
import { getReturn } from "@/server/modules/returns";
import { ActionForm } from "@/components/action-form";
import { ReturnView } from "@/components/return-view";
import { Card } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { cancelReturnAction } from "../actions";

const NEXT_STEP: Record<string, string> = {
  requested: "We are reviewing your request and will reply shortly.",
  approved: "Approved — please send or bring the item(s) back to us. We will confirm when we receive them.",
  rejected: "This request was not approved. See the note above.",
  received: "We have the item(s) and are arranging the replacement or repair.",
  refund_pending: "We have the item(s); your refund is being approved.",
  completed: "This request is complete.",
  cancelled: "You withdrew this request.",
};

export default async function PortalReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("customer");
  const d = await getReturn(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/portal/returns" className="text-sm text-teal-700 hover:underline">← Returns & warranty</Link>
        <LiveRefresh topics={["returns"]} />
      </div>
      <Card>
        <ReturnView d={d} />
      </Card>
      <p className="rounded-lg bg-slate-100 px-4 py-2 text-sm" role="status">{NEXT_STEP[d.r.status]}</p>
      {d.r.status === "requested" && (
        <ActionForm action={cancelReturnAction} submitLabel="Withdraw request" submitClassName="btn btn-ghost" confirm="Withdraw this request?">
          <input type="hidden" name="id" value={d.r.id} />
        </ActionForm>
      )}
    </div>
  );
}
