import { requireActor } from "@/server/web/session";
import { NotificationList } from "@/components/notifications";

export default async function Page() {
  const actor = await requireActor("operator");
  return <NotificationList actor={actor} path="/ops/notifications" />;
}
