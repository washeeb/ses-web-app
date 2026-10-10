import { permissionsForDomain, type Domain, type Permission } from "./permissions";

export interface RoleTemplate {
  key: string;
  name: string;
  domain: Domain;
  description: string;
  permissions: Permission[];
}

const READ_CORE: Permission[] = ["catalogue.read", "inventory.read", "leads.read", "quotes.read", "orders.read"];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "platform_admin",
    name: "Platform Administrator",
    domain: "operator",
    description: "Full operator access. Keep to a very small number of accounts.",
    permissions: permissionsForDomain("operator"),
  },
  {
    key: "company_admin",
    name: "Company Administrator",
    domain: "operator",
    description: "Manages people, departments and settings; no finance or HR record access.",
    permissions: ["users.read", "users.manage", "permissions.manage", "departments.manage", "settings.manage", "audit.read", "approvals.read", ...READ_CORE],
  },
  {
    key: "executive",
    name: "Executive",
    domain: "operator",
    description: "Read access across the business and approval of high-value quotations.",
    permissions: [...READ_CORE, "approvals.read", "quotes.approve", "finance.read", "reports.read", "integrations.read", "projects.read", "support.read", "procurement.read", "procurement.approve", "documents.read"],
  },
  {
    key: "department_manager",
    name: "Department Manager",
    domain: "operator",
    description: "Manages a department's records; usually assigned with a department scope.",
    permissions: [...READ_CORE, "leads.write", "quotes.write", "approvals.read", "reports.read", "users.read", "documents.read", "documents.write"],
  },
  {
    key: "finance_officer",
    name: "Finance Officer",
    domain: "operator",
    description: "Finance records, quotation approval and price approvals.",
    permissions: [...READ_CORE, "finance.read", "finance.write", "approvals.read", "quotes.approve", "catalogue.price.approve", "reports.read", "procurement.read", "procurement.approve", "documents.read"],
  },
  {
    key: "sales_officer",
    name: "Sales Officer",
    domain: "operator",
    description: "Leads, quotations and orders.",
    permissions: [...READ_CORE, "leads.write", "quotes.write", "orders.write", "documents.read", "documents.write"],
  },
  {
    key: "procurement_officer",
    name: "Procurement Officer",
    domain: "operator",
    description: "Suppliers, purchase orders and catalogue maintenance.",
    permissions: [...READ_CORE, "procurement.read", "procurement.write", "procurement.receive", "catalogue.write", "integrations.read", "documents.read", "documents.write"],
  },
  {
    key: "warehouse_officer",
    name: "Warehouse Officer",
    domain: "operator",
    description: "Stock levels and order fulfilment.",
    permissions: ["catalogue.read", "inventory.read", "inventory.adjust", "orders.read", "orders.write", "procurement.read", "procurement.receive", "documents.read"],
  },
  {
    key: "engineer",
    name: "Engineer",
    domain: "operator",
    description: "Delivery and engineering work.",
    permissions: ["catalogue.read", "projects.read", "projects.write", "support.read", "integrations.read"],
  },
  {
    key: "network_operator",
    name: "Network Operator",
    domain: "operator",
    description: "Telecom and network operations.",
    permissions: ["network.read", "network.write", "support.read", "integrations.read"],
  },
  {
    key: "support_agent",
    name: "Support Agent",
    domain: "operator",
    description: "Customer support and managed services.",
    permissions: ["support.read", "support.write", "orders.read", "catalogue.read", "documents.read"],
  },
  {
    key: "hr_officer",
    name: "HR Officer",
    domain: "operator",
    description: "Human resources records.",
    permissions: ["hr.read", "hr.write", "users.read"],
  },
  {
    key: "integration_manager",
    name: "Integration Manager",
    domain: "operator",
    description: "Partner connections, credentials and sync health (Partnerships & Vendor Management).",
    permissions: ["integrations.read", "integrations.manage", "catalogue.read", "catalogue.write", "inventory.read", "approvals.read"],
  },
  {
    key: "auditor",
    name: "Read-only Auditor",
    domain: "operator",
    description: "Read-only access including the audit log. Cannot change anything.",
    permissions: [...READ_CORE, "audit.read", "approvals.read", "finance.read", "integrations.read", "reports.read", "users.read", "procurement.read", "documents.read"],
  },
  {
    key: "partner_admin",
    name: "Partner Administrator",
    domain: "partner",
    description: "Manages the partner organisation's integration and users.",
    permissions: permissionsForDomain("partner"),
  },
  {
    key: "partner_staff",
    name: "Partner Staff",
    domain: "partner",
    description: "Views mapped catalogue and fulfilment requests.",
    permissions: ["partner.catalogue.read", "partner.orders.read", "partner.integration.read"],
  },
  {
    key: "customer_admin",
    name: "Customer Administrator",
    domain: "customer",
    description: "Accepts quotations and manages the customer's users.",
    permissions: permissionsForDomain("customer"),
  },
  {
    key: "customer_user",
    name: "Customer User",
    domain: "customer",
    description: "Views quotations and orders.",
    permissions: ["customer.quotes.read", "customer.orders.read", "customer.documents.read"],
  },
];
