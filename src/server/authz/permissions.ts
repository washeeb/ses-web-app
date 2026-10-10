export type Domain = "operator" | "partner" | "customer";

interface PermissionDef {
  domain: Domain;
  label: string;
  /** Holding any privileged permission makes MFA mandatory for the user. */
  privileged?: boolean;
}

const op = (label: string, privileged = false): PermissionDef => ({ domain: "operator", label, privileged });
const pa = (label: string, privileged = false): PermissionDef => ({ domain: "partner", label, privileged });
const cu = (label: string, privileged = false): PermissionDef => ({ domain: "customer", label, privileged });

export const PERMISSIONS = {
  // Administration
  "users.read": op("View staff and accounts"),
  "users.manage": op("Create and disable accounts", true),
  "permissions.manage": op("Assign permission sets", true),
  "departments.manage": op("Configure departments", true),
  "settings.manage": op("Change company settings, currencies and taxes", true),
  "audit.read": op("Read the audit log"),
  "approvals.read": op("View approval requests"),
  // Catalogue & inventory
  "catalogue.read": op("View catalogue management"),
  "catalogue.write": op("Create and edit products"),
  "catalogue.price.approve": op("Approve sensitive price changes", true),
  "inventory.read": op("View stock"),
  "inventory.adjust": op("Adjust stock levels"),
  // Sales
  "leads.read": op("View leads"),
  "leads.write": op("Manage leads"),
  "quotes.read": op("View quotations"),
  "quotes.write": op("Create and send quotations"),
  "quotes.approve": op("Approve quotations above limits", true),
  "orders.read": op("View orders"),
  "orders.write": op("Confirm, fulfil and cancel orders"),
  "returns.manage": op("Approve, receive and resolve returns and warranty claims"),
  "refunds.approve": op("Approve refunds", true),
  "data.export": op("Export data to CSV"),
  // Department modules (screens arrive in later milestones)
  "finance.read": op("View finance records"),
  "finance.write": op("Manage invoices and payments", true),
  "procurement.read": op("View procurement"),
  "procurement.write": op("Manage suppliers and purchase orders"),
  "procurement.approve": op("Approve purchase orders above the limit", true),
  "procurement.receive": op("Receive goods into stock"),
  "documents.read": op("View attached documents"),
  "documents.write": op("Upload and remove documents"),
  "projects.read": op("View projects"),
  "projects.write": op("Manage projects"),
  "support.read": op("View support tickets"),
  "support.write": op("Handle support tickets"),
  "network.read": op("View network operations"),
  "network.write": op("Operate network services"),
  "security.read": op("View security posture"),
  "security.manage": op("Manage security controls", true),
  "hr.read": op("View HR records", true),
  "hr.write": op("Manage HR records", true),
  "marketing.write": op("Manage marketing content"),
  "reports.read": op("View reports and dashboards"),
  // Integrations
  "integrations.read": op("View integration health"),
  "integrations.manage": op("Manage partner connections and credentials", true),
  // Partner portal
  "partner.catalogue.read": pa("View own mapped catalogue"),
  "partner.orders.read": pa("View own fulfilment requests"),
  "partner.integration.read": pa("View own integration status"),
  "partner.integration.manage": pa("Manage own integration settings", true),
  "partner.users.manage": pa("Manage own partner users", true),
  // Customer portal
  "customer.quotes.read": cu("View own quotations"),
  "customer.quotes.accept": cu("Accept quotations"),
  "customer.orders.read": cu("View own orders"),
  "customer.orders.pay": cu("Pay own orders online"),
  "customer.documents.read": cu("Download documents shared by SES"),
  "customer.returns.request": cu("Request returns and warranty claims"),
  "customer.users.manage": cu("Manage own customer users", true),
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (p: string): p is Permission => p in PERMISSIONS;

export const permissionDef = (p: Permission): PermissionDef => PERMISSIONS[p];

export const permissionsForDomain = (d: Domain) => ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].domain === d);
