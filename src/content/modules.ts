/**
 * Software modules (code) used by departments (data). A department can use several modules,
 * and a module serves several departments, so adding a department never needs a new application.
 */
export const MODULES: { key: string; name: string; status: "available" | "planned"; milestone: string; href?: string }[] = [
  { key: "sales", name: "Leads, quotations & orders", status: "available", milestone: "M1", href: "/ops/quotes" },
  { key: "catalogue", name: "Catalogue, pricing & stock", status: "available", milestone: "M1", href: "/ops/catalogue" },
  { key: "approvals", name: "Approvals", status: "available", milestone: "M1", href: "/ops/approvals" },
  { key: "integrations", name: "Partner integrations", status: "available", milestone: "M1", href: "/ops/integrations" },
  { key: "admin", name: "Users, access & settings", status: "available", milestone: "M1", href: "/ops/admin/users" },
  { key: "audit", name: "Audit log", status: "available", milestone: "M1", href: "/ops/audit" },
  { key: "procurement", name: "Procurement & purchase orders", status: "available", milestone: "M2", href: "/ops/procurement" },
  { key: "documents", name: "Document management (on orders, quotes, POs)", status: "available", milestone: "M2", href: "/ops/orders" },
  { key: "finance", name: "Invoices, payments & subscriptions", status: "planned", milestone: "M3" },
  { key: "projects", name: "Projects & service delivery", status: "planned", milestone: "M3" },
  { key: "support", name: "Support tickets & SLAs", status: "planned", milestone: "M3" },
  { key: "assets", name: "Assets & service contracts", status: "planned", milestone: "M3" },
  { key: "network", name: "Network operations", status: "planned", milestone: "M3" },
  { key: "hr", name: "HR records", status: "planned", milestone: "M4" },
  { key: "reports", name: "Dashboards & BI exports", status: "planned", milestone: "M4" },
];

export const DEPARTMENT_MODULES: Record<string, string[]> = {
  executive: ["reports", "approvals", "audit", "admin"],
  sales: ["sales", "catalogue", "approvals"],
  marketing: ["sales", "reports"],
  finance: ["finance", "approvals", "reports"],
  procurement: ["procurement", "catalogue", "integrations"],
  engineering: ["projects", "support"],
  architecture: ["projects", "assets"],
  network: ["network", "support", "assets"],
  security: ["audit", "admin", "network"],
  delivery: ["projects", "assets"],
  support: ["support", "assets"],
  hr: ["hr"],
  partnerships: ["integrations", "catalogue", "approvals"],
  analytics: ["reports"],
};
