import type { Permission } from "../authz/permissions";

/** Approval request types, who may decide them, and where the subject is shown. */
export const APPROVAL_TYPES: Record<string, { label: string; permission: Permission; link?: (subjectId: string) => string }> = {
  "quote.approval": { label: "Quotation", permission: "quotes.approve", link: (id) => `/ops/quotes/${id}` },
  "price.change": { label: "Price change", permission: "catalogue.price.approve" },
  "permission.change": { label: "Permission change", permission: "permissions.manage" },
  "po.approval": { label: "Purchase order", permission: "procurement.approve", link: (id) => `/ops/procurement/${id}` },
  "refund": { label: "Refund", permission: "refunds.approve", link: (id) => `/ops/returns/${id}` },
};
