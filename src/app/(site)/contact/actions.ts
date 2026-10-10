"use server";

import { getDb } from "@/server/db/client";
import { createEnquiry } from "@/server/modules/sales";
import { run, str, type ActionState } from "@/server/web/actions";
import { clientIp } from "@/server/web/session";

export async function submitEnquiry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await createEnquiry(
      getDb(),
      {
        contactName: str(fd, "contactName"),
        email: str(fd, "email"),
        phone: str(fd, "phone"),
        companyName: str(fd, "companyName"),
        serviceInterest: str(fd, "serviceInterest"),
        message: str(fd, "message"),
        website: str(fd, "website"),
      },
      await clientIp(),
    );
    return `Thank you. Your reference is ${r.number}. A specialist will contact you within one business day.`;
  });
}
