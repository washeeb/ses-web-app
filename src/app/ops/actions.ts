"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { bool, int, percentToBp, run, str, type ActionState } from "@/server/web/actions";
import { appUrl, requireActor } from "@/server/web/session";
import { parseMoney } from "@/server/lib/money";
import { invalid } from "@/server/lib/errors";
import { convertLeadToCustomer, createQuote, cancelOrder, confirmOrder, fulfilOrder, sendQuote, submitQuote, updateLeadStatus } from "@/server/modules/sales";
import { decideApproval } from "@/server/modules/approvals";
import { addVariant, createProduct, requestPriceChange, updateProduct } from "@/server/modules/catalogue";
import { adjustStock } from "@/server/modules/inventory";
import {
  createApiKey,
  createConnection,
  replayEvent,
  replayOutbound,
  revokeApiKey,
  rotateSecrets,
  setConnectionStatus,
  updateMapping,
} from "@/server/modules/integrations/manage";
import { assignRole, createDepartment, createUser, revokeAssignment, setDepartmentActive, setUserStatus } from "@/server/modules/admin";
import { updateSettings, upsertTax } from "@/server/modules/settings";
import { runScenario, type Scenario } from "@/simulators/kingsview/runner";

type Prev = ActionState;
const ops = () => requireActor("operator");
const money = (fd: FormData, k: string) => {
  const v = parseMoney(str(fd, k));
  if (v === null) throw invalid("Enter an amount such as 1250.00");
  return v;
};

// ── Sales ──

export async function leadStatusAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await updateLeadStatus(getDb(), actor, str(fd, "id"), str(fd, "status"));
    revalidatePath("/ops/leads");
    return "Lead updated.";
  });
}

export async function convertLeadAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let target = "";
  const r = await run(async () => {
    const orgId = await convertLeadToCustomer(getDb(), actor, str(fd, "id"));
    target = `/ops/quotes/new?customer=${orgId}&lead=${str(fd, "id")}`;
  });
  if (!r.ok) return r;
  redirect(target);
}

export async function createQuoteAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const lines = JSON.parse(str(fd, "lines") || "[]") as unknown[];
    const q = await createQuote(getDb(), actor, {
      customerOrgId: str(fd, "customerOrgId"),
      leadId: str(fd, "leadId") || null,
      discountBp: percentToBp(str(fd, "discountPercent")),
      notes: str(fd, "notes"),
      lines: lines as never,
    });
    id = q.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/quotes/${id}`);
}

export async function submitQuoteAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const status = await submitQuote(getDb(), actor, str(fd, "id"));
    revalidatePath(`/ops/quotes/${str(fd, "id")}`);
    return status === "approved" ? "Approved automatically (within limits). You can now send it." : "Submitted for approval. Another authorised person must approve it.";
  });
}

export async function sendQuoteAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await sendQuote(getDb(), actor, str(fd, "id"));
    revalidatePath(`/ops/quotes/${str(fd, "id")}`);
    return "Quotation sent. The customer can now view and accept it in their portal.";
  });
}

export async function decideApprovalAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const approve = str(fd, "decision") === "approve";
    await decideApproval(getDb(), actor, str(fd, "id"), approve, str(fd, "note"));
    revalidatePath("/ops/approvals");
    return approve ? "Approved." : "Rejected.";
  });
}

export async function orderAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const id = str(fd, "id");
    const op = str(fd, "op");
    if (op === "confirm") await confirmOrder(getDb(), actor, id);
    else if (op === "fulfil") await fulfilOrder(getDb(), actor, id);
    else if (op === "cancel") await cancelOrder(getDb(), actor, id, str(fd, "reason"));
    else throw invalid("Unknown operation.");
    revalidatePath(`/ops/orders/${id}`);
    return `Order ${op === "confirm" ? "confirmed" : op === "fulfil" ? "marked fulfilled" : "cancelled"}.`;
  });
}

// ── Catalogue ──

export async function createProductAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const { product } = await createProduct(
      getDb(),
      actor,
      { name: str(fd, "name"), summary: str(fd, "summary"), description: str(fd, "description"), type: str(fd, "type") as never, categoryId: str(fd, "categoryId") || null, status: str(fd, "status") as never },
      { sku: str(fd, "sku"), name: str(fd, "variantName"), priceMinor: money(fd, "price"), currency: "GHS", taxable: bool(fd, "taxable"), tracksStock: bool(fd, "tracksStock"), billingPeriod: (str(fd, "billingPeriod") || null) as never },
    );
    id = product.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/catalogue/${id}`);
}

export async function updateProductAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await updateProduct(getDb(), actor, str(fd, "id"), {
      name: str(fd, "name"),
      summary: str(fd, "summary"),
      description: str(fd, "description"),
      type: str(fd, "type") as never,
      categoryId: str(fd, "categoryId") || null,
      status: str(fd, "status") as never,
    });
    revalidatePath(`/ops/catalogue/${str(fd, "id")}`);
    return "Product saved.";
  });
}

export async function addVariantAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await addVariant(getDb(), actor, str(fd, "productId"), {
      sku: str(fd, "sku"),
      name: str(fd, "variantName"),
      priceMinor: money(fd, "price"),
      currency: "GHS",
      taxable: bool(fd, "taxable"),
      tracksStock: bool(fd, "tracksStock"),
      billingPeriod: (str(fd, "billingPeriod") || null) as never,
    });
    revalidatePath(`/ops/catalogue/${str(fd, "productId")}`);
    return "Option added.";
  });
}

export async function priceChangeAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await requestPriceChange(getDb(), actor, str(fd, "variantId"), money(fd, "price"), str(fd, "reason"));
    revalidatePath(`/ops/catalogue/${str(fd, "productId")}`);
    return r.applied ? "Price updated." : "This is a sensitive change, so it has been sent for approval by someone else.";
  });
}

export async function adjustStockAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await adjustStock(getDb(), actor, { variantId: str(fd, "variantId"), locationId: str(fd, "locationId"), onHand: int(fd, "onHand"), reason: str(fd, "reason") });
    revalidatePath(`/ops/catalogue/${str(fd, "productId")}`);
    return "Stock updated.";
  });
}

// ── Integrations ──

export async function createConnectionAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await createConnection(getDb(), actor, {
      partnerOrgId: str(fd, "partnerOrgId"),
      name: str(fd, "name"),
      mode: str(fd, "mode") as never,
      outboundUrl: str(fd, "outboundUrl"),
      staleAfterSeconds: int(fd, "staleAfterMinutes") * 60,
      sensitivePriceChangeBp: percentToBp(str(fd, "sensitivePercent")),
      markupBp: percentToBp(str(fd, "markupPercent")),
    });
    revalidatePath("/ops/integrations");
    return { message: `Connection created. Give the partner the inbound signing secret below over a secure channel.`, secret: `Inbound (partner signs with this): ${r.inboundSecret}\nOutbound (SES signs with this): ${r.outboundSecret}` };
  });
}

export async function rotateSecretsAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await rotateSecrets(getDb(), actor, str(fd, "id"));
    return { message: "Secrets rotated. The old secrets stop working immediately.", secret: `Inbound: ${r.inboundSecret}\nOutbound: ${r.outboundSecret}` };
  });
}

export async function connectionStatusAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await setConnectionStatus(getDb(), actor, str(fd, "id"), str(fd, "status") as never);
    revalidatePath(`/ops/integrations/${str(fd, "id")}`);
    return "Status changed.";
  });
}

export async function replayEventAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    if (str(fd, "kind") === "outbound") await replayOutbound(getDb(), actor, str(fd, "id"));
    else await replayEvent(getDb(), actor, str(fd, "id"));
    revalidatePath(`/ops/integrations/${str(fd, "connectionId")}`);
    return "Queued for replay.";
  });
}

export async function createApiKeyAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await createApiKey(getDb(), actor, { connectionId: str(fd, "connectionId"), name: str(fd, "name"), scopes: fd.getAll("scopes").map(String) });
    revalidatePath(`/ops/integrations/${str(fd, "connectionId")}`);
    return { message: `API key ${r.prefix} created.`, secret: r.key };
  });
}

export async function revokeApiKeyAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await revokeApiKey(getDb(), actor, str(fd, "id"));
    revalidatePath(`/ops/integrations/${str(fd, "connectionId")}`);
    return "Key revoked.";
  });
}

export async function updateMappingAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const own = (k: string) => (str(fd, k) === "ses" ? "ses" : "partner") as "ses" | "partner";
    await updateMapping(getDb(), actor, str(fd, "id"), {
      fieldOwnership: { name: own("name"), description: own("description"), cost: own("cost"), stock: own("stock"), status: own("status") },
      markupBp: percentToBp(str(fd, "markupPercent")),
    });
    revalidatePath(`/ops/integrations/${str(fd, "connectionId")}`);
    return "Mapping saved.";
  });
}

export async function simulatorAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const results = await runScenario(getDb(), actor, str(fd, "connectionId"), str(fd, "scenario") as Scenario);
    revalidatePath(`/ops/integrations/${str(fd, "connectionId")}`);
    if (results.length === 0) return "Nothing to send for this scenario.";
    return results.map((r) => `${r.status} · ${r.label}`).join("\n");
  });
}

// ── Administration ──

export async function assignRoleAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await assignRole(getDb(), actor, { userId: str(fd, "userId"), permissionSetId: str(fd, "permissionSetId"), departmentId: str(fd, "departmentId") || null });
    revalidatePath("/ops/admin/users");
    return r.applied ? "Access granted." : "This grants privileged access, so it has been sent to another administrator for approval.";
  });
}

export async function revokeAssignmentAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await revokeAssignment(getDb(), actor, str(fd, "id"));
    revalidatePath("/ops/admin/users");
    return "Access removed and the user's sessions were signed out.";
  });
}

export async function createUserAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await createUser(getDb(), actor, { organizationId: str(fd, "organizationId"), email: str(fd, "email"), name: str(fd, "name") }, appUrl());
    revalidatePath("/ops/admin/users");
    return "Account created. A set-password link has been e-mailed. Assign access below.";
  });
}

export async function userStatusAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await setUserStatus(getDb(), actor, str(fd, "id"), str(fd, "status") === "active" ? "active" : "disabled");
    revalidatePath("/ops/admin/users");
    return "Account updated.";
  });
}

export async function createDepartmentAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await createDepartment(getDb(), actor, { key: str(fd, "key"), name: str(fd, "name"), description: str(fd, "description") });
    revalidatePath("/ops/departments");
    return "Department added.";
  });
}

export async function toggleDepartmentAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await setDepartmentActive(getDb(), actor, str(fd, "id"), str(fd, "active") === "true");
    revalidatePath("/ops/departments");
    return "Department updated.";
  });
}

export async function updateSettingsAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await updateSettings(getDb(), actor, {
      companyName: str(fd, "companyName"),
      defaultCurrency: str(fd, "defaultCurrency"),
      locale: str(fd, "locale"),
      timezone: str(fd, "timezone"),
      quoteApprovalThresholdMinor: money(fd, "quoteApprovalThreshold"),
      maxDiscountBpWithoutApproval: percentToBp(str(fd, "maxDiscountPercent")),
      sensitivePriceChangeBp: percentToBp(str(fd, "sensitivePricePercent")),
      quoteValidityDays: int(fd, "quoteValidityDays"),
      reservationHoldHours: int(fd, "reservationHoldHours"),
      supportEmail: str(fd, "supportEmail"),
      supportPhone: str(fd, "supportPhone"),
      dpcRegistrationNumber: str(fd, "dpcRegistrationNumber"),
      dpcRegistrationExpires: str(fd, "dpcRegistrationExpires"),
    });
    revalidatePath("/ops/admin/settings");
    return "Settings saved.";
  });
}

export async function upsertTaxAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await upsertTax(getDb(), actor, str(fd, "id") || null, {
      code: str(fd, "code"),
      name: str(fd, "name"),
      rateBp: percentToBp(str(fd, "ratePercent")),
      compound: bool(fd, "compound"),
      active: bool(fd, "active"),
      sortOrder: int(fd, "sortOrder") || 0,
    });
    revalidatePath("/ops/admin/settings");
    return "Tax saved.";
  });
}
