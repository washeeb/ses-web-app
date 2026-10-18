export interface ServiceArea {
  slug: string;
  title: string;
  /** One line, used on cards and in search results. */
  summary: string;
  /** Two or three sentences for the service page. */
  intro: string;
  items: string[];
  /** Who it is typically for. */
  forWhom: string[];
  /** Questions people ask before getting in touch. Answers describe how SES works; no prices, clients or guarantees. */
  faqs: { q: string; a: string }[];
  /** Store categories with related products (slugs). */
  storeCategories?: string[];
  note?: string;
}

/** How every engagement runs, shown on each service page. */
export const HOW_WE_WORK = [
  { title: "Tell us what you need", text: "Send an enquiry, book a call or message us on WhatsApp. A specialist replies within one business day." },
  { title: "Understand and scope", text: "We talk through your goals, current systems and constraints, and visit the site where that helps." },
  { title: "Written proposal", text: "You receive a clear scope, timeline and quotation in GHS before any work starts." },
  { title: "Deliver and support", text: "We deliver in agreed stages, train your team and stay available through our support desk." },
];

const ASK_PRICE = { q: "How much does it cost?", a: "It depends on scope. After a short conversation we send a written quotation in GHS, so you know the cost before anything starts." };

export const SERVICE_AREAS: ServiceArea[] = [
  {
    slug: "enterprise-software",
    title: "Enterprise software",
    summary: "Systems that run the business day to day, configured for how your teams actually work.",
    intro: "ERP, CRM, point of sale and inventory systems set up around your processes, not the other way round. We configure, migrate your data, train your people and support the system after go-live.",
    items: ["ERP", "CRM", "Point of sale (POS)", "Inventory & warehouse management", "Business process automation"],
    forWhom: ["Businesses outgrowing spreadsheets and paper", "Multi-branch retailers and distributors", "Teams that need approvals and reporting in one place"],
    faqs: [ASK_PRICE, { q: "Can you move our existing data across?", a: "Yes. Data migration and clean-up is part of a rollout, so you start on the new system with your customers, products and balances in place." }, { q: "Will our staff be trained?", a: "Yes. Training is planned per team, and we support the system after go-live through our support desk." }],
    storeCategories: ["software"],
  },
  {
    slug: "software-integration",
    title: "Software development & integration",
    summary: "Custom applications and the plumbing that connects them to everything else you run.",
    intro: "When off-the-shelf software does not fit, we build what you need, and we connect the systems you already have through documented, secure APIs so data flows without re-typing.",
    items: ["Custom software development", "APIs", "Systems integration", "Data migration"],
    forWhom: ["Organisations re-entering the same data in several systems", "Businesses with a process no package covers", "Partners who need a secure data exchange"],
    faqs: [ASK_PRICE, { q: "Who owns the software you build?", a: "Ownership and licensing are agreed in writing in the proposal before work starts." }, { q: "Can you connect to systems we already use?", a: "Usually, where the system offers an API or a data export. We check this during scoping and say clearly if it cannot be done." }],
  },
  {
    slug: "infrastructure",
    title: "IT architecture & infrastructure",
    summary: "Designs that scale, on-premises, in the cloud or both, with the option of us running them for you.",
    intro: "Servers, storage, cloud and hybrid setups designed for your size and budget, documented properly, and run by us as a managed service if you prefer not to do it in-house.",
    items: ["IT architecture", "Infrastructure", "Cloud & hybrid deployments", "Managed services"],
    forWhom: ["Organisations planning a move to the cloud", "Growing businesses with ageing servers", "Teams without in-house IT staff"],
    faqs: [ASK_PRICE, { q: "Cloud or on-premises?", a: "Whichever fits. We compare cost, connectivity and risk with you and recommend in writing; hybrid setups are common." }, { q: "Can you run it for us afterwards?", a: "Yes, as a managed service with an agreed scope and support arrangements." }],
    storeCategories: ["computing", "managed-services"],
  },
  {
    slug: "telecoms-networks",
    title: "Telecommunications & networks",
    summary: "Network solutions delivered together with telecom operators, ISPs and related providers.",
    intro: "Office and campus networks, Wi-Fi, VPNs between branches and the links that connect them, designed and rolled out with licensed operators and ISPs, then monitored.",
    items: ["Connectivity", "VPNs", "Network design and rollout", "Network monitoring"],
    forWhom: ["Offices and campuses with patchy Wi-Fi", "Businesses connecting several branches", "Organisations that need a backup internet link"],
    faqs: [ASK_PRICE, { q: "Do you provide the internet connection?", a: "Connectivity is delivered through partnerships with licensed operators and providers; we design, install and manage the network around it." }, { q: "Can you survey our site first?", a: "Yes. A site survey is usually the first step for Wi-Fi and cabling work." }],
    storeCategories: ["networking"],
    note: "Delivered through partnerships with licensed operators and providers.",
  },
  {
    slug: "security-continuity",
    title: "Cybersecurity & continuity",
    summary: "Protect systems and data, and recover quickly when something goes wrong.",
    intro: "Practical protection for your systems and data: secure configuration, backups that are tested rather than assumed, and a recovery plan your team can follow when something fails.",
    items: ["Cybersecurity", "Backup", "Disaster recovery"],
    forWhom: ["Organisations holding customer or patient data", "Businesses relying on one server or one office", "Teams worried about ransomware"],
    faqs: [ASK_PRICE, { q: "Where do we start?", a: "Often with a readiness assessment: a short, fixed-scope review that gives you a prioritised list of what to fix first." }, { q: "Do you test our backups?", a: "Yes. Recovery is tested end to end as part of the work, not assumed." }],
    storeCategories: ["security"],
  },
  {
    slug: "hardware-licensing",
    title: "Hardware, licensing & subscriptions",
    summary: "Supply, installation and maintenance of equipment, plus licences and subscriptions managed in one place.",
    intro: "Laptops, servers, network equipment and software licences supplied, installed and maintained, with renewals tracked so nothing lapses unnoticed.",
    items: ["Hardware supply", "Installation", "Maintenance", "Software licensing", "Subscriptions"],
    forWhom: ["Businesses equipping new staff or offices", "Organisations with many licences to renew", "Teams that want one supplier for equipment and support"],
    faqs: [ASK_PRICE, { q: "Can I order online?", a: "Yes. Many items are in our online store; larger orders go through a quotation." }, { q: "Do you install and support what you sell?", a: "Yes. Installation and maintenance can be included in the quotation." }],
    storeCategories: ["computing", "networking", "software"],
  },
  {
    slug: "data-intelligence",
    title: "Data, analytics & intelligence",
    summary: "Turn operational data into decisions, using AI and IoT where they genuinely help.",
    intro: "Dashboards and reports built on the data you already collect, and AI or IoT where they add real value, so decisions rest on figures rather than guesses.",
    items: ["Data analytics", "Business intelligence", "Applied AI", "IoT solutions"],
    forWhom: ["Managers who compile reports by hand each month", "Businesses with data spread across systems", "Organisations exploring AI or sensors"],
    faqs: [ASK_PRICE, { q: "Do we need new systems first?", a: "Not usually. We start from the data you already have and say where gaps limit what is possible." }, { q: "Is AI right for us?", a: "Sometimes. We look for a specific, measurable use and recommend against it where a simpler report does the job." }],
  },
  {
    slug: "readiness-assessments",
    title: "Fixed-price readiness assessments",
    summary: "Short, fixed-scope IT and cybersecurity assessments with a prioritised roadmap.",
    intro: "A clear picture of where you stand, at a price agreed up front: we review your IT, security or cloud readiness and hand you a prioritised roadmap you can act on with us or anyone else.",
    items: ["IT health check", "Cyber readiness review", "Cloud readiness"],
    forWhom: ["Organisations unsure where to start", "Boards and managers who need an independent view", "Teams preparing a budget or a cloud move"],
    faqs: [{ q: "What does fixed-price mean?", a: "The scope and price are agreed in writing before we start, so the cost does not grow during the assessment." }, { q: "What do we receive?", a: "A written report with findings and a prioritised roadmap, and a session to walk through it with you." }, { q: "Do we have to use you for the fixes?", a: "No. The roadmap is yours to act on with us or anyone else." }],
  },
  {
    slug: "managed-soc",
    title: "Managed security monitoring",
    summary: "Ongoing monitoring and response built on existing network monitoring and cybersecurity work.",
    intro: "We watch your logs and alerts, triage what matters, act on agreed responses and report to you monthly, so security does not depend on someone remembering to check.",
    items: ["Log monitoring", "Alert triage", "Monthly security reporting"],
    forWhom: ["Organisations without a security team", "Businesses with compliance or customer security requirements", "Teams overwhelmed by alerts"],
    faqs: [ASK_PRICE, { q: "What is monitored?", a: "The systems agreed in the scope, such as firewalls, servers and key applications, with response steps written down in advance." }, { q: "How do we see what you found?", a: "Through a monthly security report, and immediately for anything urgent, as agreed in the scope." }],
    storeCategories: ["managed-services", "security"],
  },
  {
    slug: "data-protection",
    title: "Data protection compliance support",
    summary: "Practical support with obligations under Ghana's Data Protection Act, 2012 (Act 843).",
    intro: "Practical help to meet your obligations under the Data Protection Act, 2012 (Act 843): knowing what personal data you hold, setting sensible policies and retention, and preparing for registration with the Data Protection Commission.",
    items: ["Data inventories", "Policies and retention schedules", "Registration support"],
    forWhom: ["Organisations handling customer, staff or patient data", "Businesses registering with the Data Protection Commission", "Teams writing their first privacy policies"],
    faqs: [ASK_PRICE, { q: "Is this legal advice?", a: "No. We provide practical, technical and organisational support; for legal opinions we recommend a qualified lawyer." }, { q: "Where do we start?", a: "With a data inventory: what personal data you hold, where, why and for how long." }],
  },
  {
    slug: "payments-integration",
    title: "Mobile money & payments integration",
    summary: "Connect business systems to mobile money, card and bank-transfer providers.",
    intro: "Take mobile money, card and bank-transfer payments in your own systems, with automatic reconciliation and receipts, through licensed payment providers.",
    items: ["Payment gateway integration", "Reconciliation", "Receipts and invoicing"],
    forWhom: ["Businesses selling online or at the counter", "Organisations reconciling payments by hand", "Schools, churches and associations collecting fees"],
    faqs: [ASK_PRICE, { q: "Which providers do you work with?", a: "Licensed gateways that support mobile money, cards and bank transfer; we recommend one based on your needs during scoping." }, { q: "Do you handle the money?", a: "No. Payments go through the licensed provider to your account; we build and support the integration." }],
  },
  {
    slug: "device-as-a-service",
    title: "Device-as-a-Service",
    summary: "Laptops and network equipment on a monthly plan, including support and replacement.",
    intro: "Equip your team with laptops and network equipment for a predictable monthly fee, with setup, support and replacement included, instead of a large upfront purchase.",
    items: ["Leasing", "Lifecycle management", "Support"],
    forWhom: ["Growing teams that want predictable costs", "Organisations replacing ageing laptops", "Businesses without in-house IT support"],
    faqs: [ASK_PRICE, { q: "What happens when a device fails?", a: "Support and replacement are part of the plan, as set out in your agreement." }, { q: "What is included?", a: "Devices, setup, support and lifecycle management; the exact terms are agreed in writing." }],
    storeCategories: ["computing"],
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
    serviceSlug: "enterprise-software",
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
    serviceSlug: "telecoms-networks",
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
    serviceSlug: "security-continuity",
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
    serviceSlug: "enterprise-software",
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
    status: "Integration partner",
    description:
      "Technology, design and supplies for businesses, schools, churches and homes. KingsView is the first partner connected through the SES partner integration.",
    links: [
      { label: "kingsviewsolutions.com", href: "https://kingsviewsolutions.com" },
      { label: "Instagram", href: "https://www.instagram.com/kinxview/" },
      { label: "Facebook", href: "https://www.facebook.com/kinxview/" },
    ],
  },
];
