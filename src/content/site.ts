export interface ServiceArea {
  slug: string;
  title: string;
  summary: string;
  items: string[];
  /** "available" = core service from the brief; "proposed" = recommended, not yet offered. */
  status: "available" | "proposed";
  note?: string;
}

export const SERVICE_AREAS: ServiceArea[] = [
  {
    slug: "enterprise-software",
    title: "Enterprise software",
    summary: "Systems that run the business day to day, configured for how your teams actually work.",
    items: ["ERP", "CRM", "Point of sale (POS)", "Inventory & warehouse management", "Business process automation"],
    status: "available",
  },
  {
    slug: "software-integration",
    title: "Software development & integration",
    summary: "Custom applications and the plumbing that connects them to everything else you run.",
    items: ["Custom software development", "APIs", "Systems integration", "Data migration"],
    status: "available",
  },
  {
    slug: "infrastructure",
    title: "IT architecture & infrastructure",
    summary: "Designs that scale, on-premises, in the cloud or both, with the option of us running them for you.",
    items: ["IT architecture", "Infrastructure", "Cloud & hybrid deployments", "Managed services"],
    status: "available",
  },
  {
    slug: "telecoms-networks",
    title: "Telecommunications & networks",
    summary: "Network solutions delivered together with telecom operators, ISPs and related providers.",
    items: ["Connectivity", "VPNs", "Network design and rollout", "Network monitoring"],
    status: "available",
    note: "Delivered through partnerships with licensed operators and providers.",
  },
  {
    slug: "security-continuity",
    title: "Cybersecurity & continuity",
    summary: "Protect systems and data, and recover quickly when something goes wrong.",
    items: ["Cybersecurity", "Backup", "Disaster recovery"],
    status: "available",
  },
  {
    slug: "hardware-licensing",
    title: "Hardware, licensing & subscriptions",
    summary: "Supply, installation and maintenance of equipment, plus licences and subscriptions managed in one place.",
    items: ["Hardware supply", "Installation", "Maintenance", "Software licensing", "Subscriptions"],
    status: "available",
  },
  {
    slug: "data-intelligence",
    title: "Data, analytics & intelligence",
    summary: "Turn operational data into decisions, using AI and IoT where they genuinely help.",
    items: ["Data analytics", "Business intelligence", "Applied AI", "IoT solutions"],
    status: "available",
  },
  {
    slug: "readiness-assessments",
    title: "Fixed-price readiness assessments",
    summary: "Short, fixed-scope IT and cybersecurity assessments with a prioritised roadmap.",
    items: ["IT health check", "Cyber readiness review", "Cloud readiness"],
    status: "proposed",
  },
  {
    slug: "managed-soc",
    title: "Managed security monitoring",
    summary: "Ongoing monitoring and response built on existing network monitoring and cybersecurity work.",
    items: ["Log monitoring", "Alert triage", "Monthly security reporting"],
    status: "proposed",
  },
  {
    slug: "data-protection",
    title: "Data protection compliance support",
    summary: "Practical support with obligations under Ghana's Data Protection Act, 2012 (Act 843).",
    items: ["Data inventories", "Policies and retention schedules", "Registration support"],
    status: "proposed",
  },
  {
    slug: "payments-integration",
    title: "Mobile money & payments integration",
    summary: "Connect business systems to mobile money, card and bank-transfer providers.",
    items: ["Payment gateway integration", "Reconciliation", "Receipts and invoicing"],
    status: "proposed",
  },
  {
    slug: "device-as-a-service",
    title: "Device-as-a-Service",
    summary: "Laptops and network equipment on a monthly plan, including support and replacement.",
    items: ["Leasing", "Lifecycle management", "Support"],
    status: "proposed",
  },
];

/**
 * Example engagements: realistic project patterns SES delivers, presented as examples — not as named
 * clients. Replace or extend with client-approved case studies (with permission) as projects complete.
 */
export const CASE_STUDIES = [
  {
    title: "Multi-branch retail: one view of stock and sales",
    sector: "Retail & distribution",
    services: ["POS", "Inventory & warehouse", "Integration", "Training"],
    challenge:
      "A retailer with several branches runs standalone tills and spreadsheets. Stock counts disagree between branches and head office, transfers are tracked on paper, and month-end reconciliation takes days.",
    solution:
      "Cloud POS in every branch connected to central inventory and accounting, barcode-based stock transfers, mobile-money and card payments at the till, offline mode for unreliable connectivity, and staff training per branch.",
    outcomes: ["Live stock levels across all branches", "Fewer stock-outs and over-orders", "Month-end close reduced from days to hours", "Daily sales dashboards for management"],
  },
  {
    title: "Campus network, Wi-Fi and 24/7 monitoring",
    sector: "Education",
    services: ["Network design", "Wi-Fi", "Telecom/ISP partnership", "Monitoring"],
    challenge:
      "A tertiary institution has patchy Wi-Fi in lecture halls and hostels, a single internet link that fails several times a term, and no visibility of network problems until students complain.",
    solution:
      "Site survey and redesign with managed switches and Wi-Fi 6 access points, a second ISP link through a partner provider with automatic failover, VLANs separating staff, students and administration, and 24/7 monitoring with alerting.",
    outcomes: ["Coverage across teaching and residential areas", "Automatic failover between ISP links", "Faults detected before users report them", "Monthly capacity and availability reports"],
  },
  {
    title: "Clinic records: backup, recovery and security",
    sector: "Healthcare",
    services: ["Backup", "Disaster recovery", "Cybersecurity review"],
    challenge:
      "A private clinic keeps patient records on one on-site server with occasional USB backups. A disk failure or ransomware attack would halt consultations and put sensitive data at risk.",
    solution:
      "Encrypted daily off-site backups with retention policies, a documented and tested recovery procedure, endpoint protection, multi-factor authentication for remote access and a staff awareness session.",
    outcomes: ["Recovery tested end to end, not assumed", "Backups protected from ransomware", "Clear recovery time and data-loss targets", "Reduced risk to patient data"],
  },
  {
    title: "Manufacturer: ERP rollout with data migration",
    sector: "Manufacturing",
    services: ["ERP", "Data migration", "Process automation", "BI"],
    challenge:
      "A manufacturer manages purchasing, production and sales in separate tools. Costing is estimated, approvals happen by e-mail, and management reports are compiled by hand each month.",
    solution:
      "Discovery workshops and fit-gap analysis, phased ERP rollout (procurement, inventory, production, sales, finance), migration and cleansing of master data, automated approval workflows and management dashboards.",
    outcomes: ["One system of record for operations and finance", "Product costing based on actual data", "Approvals with a full audit trail", "Management reports available on demand"],
  },
];

export const PARTNERS = [
  {
    name: "KingsView Solutions",
    status: "Integration in preparation",
    description:
      "First integration partner. Their web application is not live yet; product, pricing and stock data will appear here once their store connects through the SES partner integration.",
    links: [
      { label: "Instagram", href: "https://www.instagram.com/kinxview/" },
      { label: "Facebook", href: "https://www.facebook.com/kinxview/" },
    ],
  },
];
