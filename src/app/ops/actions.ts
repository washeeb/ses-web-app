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
import { adjustStock, parseSerials } from "@/server/modules/inventory";
import { addImage, deleteImage, inspectImage, OWNER_TYPES, updateImage, type OwnerType } from "@/server/modules/media";
import { assertImageOwner, deleteBrand, deleteCategory, deleteTag, renameTag, saveBrand, saveCategory } from "@/server/modules/taxonomy";
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
    else if (op === "fulfil") {
      // Serial numbers arrive as serials_<itemId>, one per line or comma-separated.
      const serials: Record<string, string[]> = {};
      for (const [key, value] of fd.entries()) if (key.startsWith("serials_") && typeof value === "string" && value.trim()) serials[key.slice(8)] = parseSerials(value);
      await fulfilOrder(getDb(), actor, id, serials);
    }
    else if (op === "cancel") await cancelOrder(getDb(), actor, id, str(fd, "reason"));
    else throw invalid("Unknown operation.");
    revalidatePath(`/ops/orders/${id}`);
    return `Order ${op === "confirm" ? "confirmed" : op === "fulfil" ? "marked fulfilled" : "cancelled"}.`;
  });
}

// ── Catalogue ──

const productFields = (fd: FormData) => ({
  name: str(fd, "name"),
  summary: str(fd, "summary"),
  description: str(fd, "description"),
  type: str(fd, "type") as never,
  categoryId: str(fd, "categoryId") || null,
  brandId: str(fd, "brandId") || null,
  specsText: String(fd.get("specsText") ?? ""),
  tagsText: str(fd, "tagsText"),
  status: str(fd, "status") as never,
});

/** Copies come as w<width> files (prepared in the browser) or one "original" file (no JavaScript). */
export async function uploadImageAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const ownerType = str(fd, "ownerType") as OwnerType;
    const ownerId = str(fd, "ownerId");
    if (!OWNER_TYPES.includes(ownerType)) throw invalid("Unknown page for this image.");
    const db = getDb();
    await assertImageOwner(db, ownerType, ownerId);
    const files: { width: number; bytes: Buffer }[] = [];
    for (const [key, value] of fd.entries()) {
      if (!(value instanceof File) || value.size === 0) continue;
      const bytes = Buffer.from(await value.arrayBuffer());
      if (/^w\d{2,4}$/.test(key)) files.push({ width: Number(key.slice(1)), bytes });
      else if (key === "original" && files.length === 0) files.push({ width: inspectImage(bytes)?.width ?? 0, bytes });
    }
    // With JavaScript only the prepared copies are sent; without it, only the original.
    await addImage(db, actor, ownerType, ownerId, { files, alt: str(fd, "alt") });
    revalidatePath("/", "layout");
    return "Picture added.";
  });
}

export async function imageAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const db = getDb();
    const id = str(fd, "id");
    const op = str(fd, "op");
    if (op === "delete") await deleteImage(db, actor, id);
    else if (op === "alt") await updateImage(db, actor, id, { alt: str(fd, "alt") });
    else if (op === "main") await updateImage(db, actor, id, { makeMain: true });
    else if (op === "left" || op === "right") await updateImage(db, actor, id, { move: op === "left" ? -1 : 1 });
    else throw invalid("Unknown action.");
    revalidatePath("/", "layout");
    return op === "delete" ? "Picture removed." : "Saved.";
  });
}

export async function categoryAction(_: Prev, fd: FormData) {
  const actor = await ops();
  const id = str(fd, "id") || null;
  let createdId = "";
  const r = await run(async () => {
    const db = getDb();
    if (str(fd, "op") === "delete") {
      await deleteCategory(db, actor, id!);
      revalidatePath("/", "layout");
      return "Category deleted.";
    }
    const row = await saveCategory(db, actor, id, {
      name: str(fd, "name"),
      slug: str(fd, "slug"),
      description: str(fd, "description"),
      parentId: str(fd, "parentId") || null,
      skuCode: str(fd, "skuCode"),
      active: bool(fd, "active"),
      sortOrder: int(fd, "sortOrder") || 0,
    });
    createdId = id ? "" : row.id;
    revalidatePath("/", "layout");
    return "Category saved.";
  });
  if (r.ok && str(fd, "op") === "delete") redirect("/ops/catalogue/categories");
  if (r.ok && createdId) redirect(`/ops/catalogue/categories/${createdId}`);
  return r;
}

export async function brandAction(_: Prev, fd: FormData) {
  const actor = await ops();
  const id = str(fd, "id") || null;
  let createdId = "";
  const r = await run(async () => {
    const db = getDb();
    if (str(fd, "op") === "delete") {
      await deleteBrand(db, actor, id!);
      revalidatePath("/", "layout");
      return "Brand deleted.";
    }
    const row = await saveBrand(db, actor, id, { name: str(fd, "name"), description: str(fd, "description"), website: str(fd, "website"), active: bool(fd, "active") });
    createdId = id ? "" : row.id;
    revalidatePath("/", "layout");
    return "Brand saved.";
  });
  if (r.ok && str(fd, "op") === "delete") redirect("/ops/catalogue/brands");
  if (r.ok && createdId) redirect(`/ops/catalogue/brands/${createdId}`);
  return r;
}

export async function tagAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const db = getDb();
    if (str(fd, "op") === "delete") await deleteTag(db, actor, str(fd, "id"));
    else await renameTag(db, actor, str(fd, "id"), str(fd, "name"));
    revalidatePath("/", "layout");
    return "Saved.";
  });
}

export async function createProductAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const { product } = await createProduct(
      getDb(),
      actor,
      productFields(fd),
      { sku: str(fd, "sku"), name: str(fd, "variantName"), priceMinor: money(fd, "price"), currency: "GHS", taxable: bool(fd, "taxable"), tracksStock: bool(fd, "tracksStock"), billingPeriod: (str(fd, "billingPeriod") || null) as never, warrantyMonths: int(fd, "warrantyMonths") || 0 },
    );
    id = product.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/catalogue/${id}`);
}

export async function updateProductAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await updateProduct(getDb(), actor, str(fd, "id"), productFields(fd));
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
      warrantyMonths: int(fd, "warrantyMonths") || 0,
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
    return { message: `Connection created. Give the partner the inbound signing secret below over a secure channel.`, secret: `Connection ID: ${r.connection.id}\nInbound (partner signs with this): ${r.inboundSecret}\nOutbound (SES signs with this): ${r.outboundSecret}` };
  });
}

export async function rotateSecretsAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const r = await rotateSecrets(getDb(), actor, str(fd, "id"));
    return { message: "Secrets rotated. The old secrets stop working immediately.", secret: `Connection ID: ${str(fd, "id")}\nInbound (partner signs with this): ${r.inboundSecret}\nOutbound (SES signs with this): ${r.outboundSecret}` };
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
      poApprovalThresholdMinor: money(fd, "poApprovalThreshold"),
      sensitivePriceChangeBp: percentToBp(str(fd, "sensitivePricePercent")),
      quoteValidityDays: int(fd, "quoteValidityDays"),
      reservationHoldHours: int(fd, "reservationHoldHours"),
      returnWindowDays: int(fd, "returnWindowDays"),
      invoiceDueDays: int(fd, "invoiceDueDays"),
      renewalNoticeDays: int(fd, "renewalNoticeDays"),
      renewalGraceDays: int(fd, "renewalGraceDays"),
      ticketAutoCloseDays: int(fd, "ticketAutoCloseDays"),
      aiEnabled: bool(fd, "aiEnabled"),
      aiDailyLimitPerUser: int(fd, "aiDailyLimitPerUser"),
      storeOrderLimitMinor: money(fd, "storeOrderLimit"),
      companyAddress: str(fd, "companyAddress"),
      companyTin: str(fd, "companyTin"),
      paymentInstructions: str(fd, "paymentInstructions"),
      bankName: str(fd, "bankName"),
      bankAccountName: str(fd, "bankAccountName"),
      bankAccountNumber: str(fd, "bankAccountNumber"),
      bankBranch: str(fd, "bankBranch"),
      momoMerchantName: str(fd, "momoMerchantName"),
      momoMerchantId: str(fd, "momoMerchantId"),
      telecelMerchantName: str(fd, "telecelMerchantName"),
      telecelTillNumber: str(fd, "telecelTillNumber"),
      supportEmail: str(fd, "supportEmail"),
      supportPhone: str(fd, "supportPhone"),
      weeklyReport: bool(fd, "weeklyReport"),
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
