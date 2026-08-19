// The Ingenico agentic onboarding pipeline, from the acquirer's point of view.
// Steps the acquirer OWNS or SIGNS OFF are marked actionable; everything else
// the agent runs and the acquirer watches.

export type Band = "Augment" | "Assist" | "Automate"

export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// A single unit of work the agent performs inside a step, with the artefact
// it produced. This is what the acquirer "plays" through on the journey.
export interface AgentTask {
  label: string
  detail: string
  // short machine-style output the agent emits (rendered mono, like a console)
  output: string
}

/** Who owns the system the agent is driving. This is the whole product claim
 *  on the regulated steps: Ingenico does not replace the acquirer's KYC, risk
 *  or ledger stack — those stay the system of record, and the agent operates
 *  them. An untagged tool list flattened that into "Ingenico does KYC", which
 *  is the one thing an acquirer will not accept. */
export type ToolOwner = "acquirer" | "ingenico" | "external"

export interface Tool {
  name: string
  owner: ToolOwner
}

const acquirerTool = (name: string): Tool => ({ name, owner: "acquirer" })
const ingenicoTool = (name: string): Tool => ({ name, owner: "ingenico" })
const externalTool = (name: string): Tool => ({ name, owner: "external" })

export interface PipelineStep {
  id: StepId
  code: string // "01".."09"
  name: string
  band: Band
  // Does the acquirer have a hands-on role at this step?
  acquirerRole: "owns" | "signs-off" | "approves" | "watch"
  blurb: string
  // What the agent is doing, in one line, for the cockpit header.
  agentMission: string
  // The tools / systems the agent reaches for at this step.
  tools: Tool[]
  /** Only on steps that touch the acquirer's OWN systems. States where the
   *  boundary falls, so the integration is a named arrangement rather than an
   *  inference the reader has to make from the chips. */
  integration?: string
  /** A precondition this step takes as already met.
   *
   *  Distinct from `integration`, which says WHERE the work runs. An
   *  assumption says what must already be TRUE before the step starts, so a
   *  reader cannot mistake the pipeline's starting position for something the
   *  agent achieved. Branding is the clear case: the agent themes the assets
   *  it is given, and saying so keeps "we collected the brand" out of a step
   *  that never collected anything. */
  assumes?: string
  // The replayable task trace — the heart of "see how the agent helps".
  tasks: AgentTask[]
  // What lands back with the acquirer when the step is done.
  handback: string
}

export const PIPELINE: PipelineStep[] = [
  {
    id: 1,
    code: "01",
    name: "Submit",
    band: "Augment",
    acquirerRole: "owns",
    blurb: "Acquirer owns the customer and decides whether the application goes forward.",
    agentMission: "Turn a few merchant details into a shaped application and a kit recommendation.",
    tools: [
      acquirerTool("Merchant CRM"),
      ingenicoTool("Terminal catalog"),
      ingenicoTool("Sector benchmarks"),
    ],
    integration:
      "The agent reads and writes your CRM through Ingenico's integration. The merchant record stays in your system — nothing is re-keyed into a second one.",
    tasks: [
      {
        label: "Read the intake",
        detail: "Parses the details you entered and normalises sector, geography and expected volume.",
        output: "intake.parse → sector=Hospitality region=UK volume_band=£2m–5m ok",
      },
      {
        label: "Find look-alike merchants",
        detail: "Searches your existing book for merchants with a matching profile.",
        output: "match.similar → 42 hospitality merchants, median 3.6 terminals",
      },
      {
        label: "Recommend the kit",
        detail: "Proposes the device mix most of those merchants run today.",
        output: "recommend.kit → 3× A920 + softPOS  (confidence 0.91)",
      },
      {
        label: "Draft the application",
        detail: "Writes the onboarding record into your CRM so nothing has to be re-typed downstream.",
        output: "application.draft → fields populated, gaps named",
      },
    ],
    handback: "The decision is yours. Confirming hands the application to underwriting.",
  },
  {
    id: 2,
    code: "02",
    name: "Underwrite",
    band: "Augment",
    acquirerRole: "signs-off",
    blurb: "Agent verifies identity, parses documents and scores risk. Acquirer signs the regulated decision.",
    agentMission: "Do the full underwriting analysis and surface anything a human must weigh in on.",
    tools: [
      externalTool("Companies House"),
      acquirerTool("KYC / KYB platform"),
      acquirerTool("Sanctions & PEP screening"),
      ingenicoTool("Document AI"),
      acquirerTool("Risk model"),
    ],
    integration:
      "Your KYC, screening and risk model remain the system of record — every check below runs inside them, against your policy and your thresholds. Ingenico supplies the agent that drives them and assembles the result, not the verdict.",
    tasks: [
      {
        label: "Verify the business",
        detail: "Confirms the legal entity and directors against the company registry.",
        output: "kyb.verify → entity active, 2 directors matched ok",
      },
      {
        label: "Screen the principals",
        detail: "Runs sanctions, PEP and adverse-media checks on every beneficial owner.",
        output: "screen.pep_sanctions → 0 sanctions, 0 PEP, 1 media note",
      },
      {
        label: "Parse the documents",
        detail: "Extracts and cross-checks figures across every uploaded document.",
        output: "docai.parse → 6 docs, 18 fields, 0 inconsistencies ok",
      },
      {
        label: "Score the risk",
        detail: "Combines all signals into a single risk score and band.",
        output: "risk.score → 18 / 100  band=LOW",
      },
      {
        label: "Flag edge cases",
        detail: "Isolates anything outside policy for a human to review.",
        output: "policy.flag → 1 edge case raised for sign-off",
      },
    ],
    handback: "The regulated decision is yours. The agent presents its analysis and waits for your sign-off.",
  },
  {
    id: 3,
    code: "03",
    name: "Order",
    band: "Assist",
    acquirerRole: "approves",
    blurb: "Agent proposes the terminal order. Acquirer approves and confirms.",
    agentMission: "Assemble a ready-to-place terminal order with stock and delivery confirmed.",
    tools: [
      ingenicoTool("Ingenico order desk"),
      ingenicoTool("Pricing"),
      ingenicoTool("Logistics validation"),
    ],
    tasks: [
      {
        label: "Build the basket",
        detail: "Turns the approved kit into a concrete order with SKUs and accessories.",
        output: "order.build → 3× A920, 1× softPOS licence, 4× dock",
      },
      {
        // Not "check stock": counting warehouse units is Ingenico's job. The
        // acquirer needs the answer that follows from it — can it be supplied.
        label: "Confirm availability",
        detail: "Ingenico's order desk confirms what it can supply against this basket.",
        output: "availability.confirm → all lines available in full",
      },
      {
        label: "Validate delivery",
        detail: "Verifies the delivery address resolves to a serviceable route.",
        output: "logistics.validate → address serviceable, ETA 3 days ok",
      },
      {
        label: "Price the order",
        detail: "Applies the acquirer's contracted rate card.",
        output: "pricing.apply → rate card NG-2024, total confirmed",
      },
    ],
    handback: "You approve the proposed order. One click confirms it and releases it to fulfilment.",
  },
  {
    id: 4,
    code: "04",
    name: "Branding",
    band: "Augment",
    acquirerRole: "approves",
    blurb: "Agent prepares receipts and on-device branding. Acquirer approves the look.",
    agentMission: "Prepare the merchant's on-device look and localised receipts for your approval.",
    tools: [
      acquirerTool("Brand assets"),
      ingenicoTool("Receipt templates"),
      ingenicoTool("Localisation"),
    ],
    integration:
      "The marks and colours come from your brand library. Ingenico renders them onto the device and receipt, and holds the contrast and clearance rules that the hardware imposes.",
    assumes:
      "the merchant's brand and digital assets have already been uploaded to, or received by, the acquirer or Ingenico. This step themes what it is given — it does not chase missing artwork.",
    tasks: [
      {
        label: "Pull brand assets",
        detail: "Fetches whatever the merchant supplied — colour, artwork, trading name.",
        output: "brand.fetch → assets read from the application",
      },
      {
        label: "Draft the device theme",
        detail: "Applies the merchant's colour to the screens the theme is allowed to reach.",
        output: "device.theme → welcome, amount and approved screens themed",
      },
      {
        label: "Localise the receipt",
        detail: "Sets the language, VAT line and return policy for the merchant's country.",
        output: "receipt.localise → locale, VAT rate and policy applied",
      },
      {
        label: "Run the brand checks",
        detail: "Measures the draft against your brand standard and the hardware limits.",
        output: "brand.check → contrast, name length, co-brand and legal line measured",
      },
    ],
    handback: "The design and the approval are both yours. Checks that fail block the approval until fixed.",
  },
  {
    id: 5,
    code: "05",
    name: "Configure",
    band: "Automate",
    acquirerRole: "watch",
    blurb: "Agent builds the device profile and loads the merchant configuration.",
    agentMission: "Build each device's profile and load the merchant configuration end to end.",
    tools: [
      ingenicoTool("Device profiles"),
      externalTool("Payment schemes"),
      ingenicoTool("Config store"),
    ],
    tasks: [
      {
        label: "Generate profiles",
        detail: "Creates a device profile per terminal from the approved kit.",
        output: "profile.generate → 4 profiles created",
      },
      {
        label: "Enable schemes",
        detail: "Switches on the card schemes and payment methods for the merchant.",
        output: "scheme.enable → Visa, MC, Amex, contactless, softPOS",
      },
      {
        label: "Load configuration",
        detail: "Pushes MID/TID, tipping and currency settings to each profile.",
        output: "config.load → MID/TID bound, tipping=on, ccy=GBP",
      },
      {
        label: "Sign the build",
        detail: "Cryptographically signs the configuration bundle.",
        output: "build.sign → bundle signed, checksum verified ok",
      },
    ],
    handback: "Fully automated. You can watch each profile build in real time.",
  },
  {
    id: 6,
    code: "06",
    name: "Test",
    band: "Automate",
    acquirerRole: "watch",
    blurb: "Agent runs the full test suite on each terminal before dispatch.",
    agentMission: "Run the full pre-dispatch test suite on every terminal.",
    tools: [
      ingenicoTool("Test harness"),
      externalTool("Scheme certification"),
      ingenicoTool("Print / connectivity"),
    ],
    tasks: [
      {
        label: "Connectivity",
        detail: "Confirms each terminal reaches the payment gateway.",
        output: "test.connect → 4/4 terminals online",
      },
      {
        label: "Test transactions",
        detail: "Runs sale, refund and reversal against the certification host.",
        output: "test.txn → sale ok, refund ok, reversal ok (x4)",
      },
      {
        label: "Peripherals",
        detail: "Checks the printer, contactless reader and PIN pad.",
        output: "test.peripherals → printer ok, NFC ok, PIN ok",
      },
      {
        label: "Issue certificate",
        detail: "Records a pass certificate for each device.",
        output: "cert.issue → 4 certificates written",
      },
    ],
    handback: "Fully automated. Any failure is auto-retried and flagged if it persists.",
  },
  {
    id: 7,
    code: "07",
    name: "Ship",
    band: "Automate",
    acquirerRole: "watch",
    blurb: "Agent books logistics and tracks delivery to the merchant.",
    agentMission: "Book logistics and track every parcel to the merchant's door.",
    tools: [
      externalTool("Carrier API"),
      ingenicoTool("Label printing"),
      ingenicoTool("Tracking"),
    ],
    tasks: [
      {
        label: "Book the carrier",
        detail: "Selects a carrier and books collection from the warehouse.",
        output: "ship.book → carrier=DPD, pickup booked",
      },
      {
        label: "Print labels",
        detail: "Generates shipping labels and a packing manifest.",
        output: "label.print → 4 labels, 1 manifest",
      },
      {
        label: "Dispatch",
        detail: "Confirms hand-off to the carrier.",
        output: "dispatch.confirm → 4 parcels in transit",
      },
      {
        label: "Share tracking",
        detail: "Sends the merchant live tracking links.",
        output: "track.notify → merchant emailed tracking ok",
      },
    ],
    handback: "Fully automated. Tracking updates flow straight back into the journey.",
  },
  {
    id: 8,
    code: "08",
    name: "Install",
    band: "Assist",
    acquirerRole: "watch",
    blurb: "Agent guides the merchant through install and activation in their language.",
    agentMission: "Guide the merchant through install and activation, in their own language.",
    tools: [
      ingenicoTool("In-app guide"),
      ingenicoTool("Activation service"),
      ingenicoTool("Localisation"),
    ],
    tasks: [
      {
        label: "Detect arrival",
        detail: "Notices the terminals delivered and reaches out to the merchant.",
        output: "install.detect → delivery confirmed, guide sent",
      },
      {
        label: "Guide setup",
        detail: "Walks the merchant through power-on and pairing step by step.",
        output: "guide.run → locale=es-ES, 4 devices paired",
      },
      {
        label: "Activate",
        detail: "Activates each terminal against the live host.",
        output: "activate.device → 3/4 active, 1 in progress",
      },
      {
        label: "Confirm ready",
        detail: "Runs a £0.01 auth to prove each device can transact.",
        output: "activate.verify → auth test passed on active set",
      },
    ],
    handback: "Fully automated. The agent nudges the merchant if a device stalls.",
  },
  {
    id: 9,
    code: "09",
    name: "Go-live",
    band: "Automate",
    acquirerRole: "watch",
    blurb: "Agent detects the first live payment and writes records back to the acquirer.",
    agentMission: "Confirm the merchant is live and reconcile everything back to your systems.",
    tools: [
      ingenicoTool("Transaction stream"),
      acquirerTool("Acquirer ledger"),
      ingenicoTool("Notifications"),
    ],
    integration:
      "First settlement is confirmed against your own ledger, not Ingenico's view of it. The agent reconciles the two and tells you when they agree.",
    tasks: [
      {
        label: "Watch for first payment",
        detail: "Monitors the transaction stream for the merchant's first real sale.",
        output: "stream.watch → first live payment €48.00 detected ok",
      },
      {
        label: "Reconcile",
        detail: "Matches the merchant, MIDs and terminals to your ledger.",
        output: "ledger.reconcile → MIDs bound, 0 orphans",
      },
      {
        label: "Write back",
        detail: "Pushes the completed onboarding record into your systems.",
        output: "records.writeback → onboarding record synced",
      },
      {
        label: "Close the loop",
        detail: "Notifies you and the merchant that the account is fully live.",
        output: "notify.golive → acquirer + merchant notified",
      },
    ],
    handback: "Fully automated. The merchant is live and everything is reconciled to you.",
  },
]

export function stepById(id: StepId): PipelineStep {
  return PIPELINE.find((s) => s.id === id)!
}

export type MerchantStatus =
  | "On track"
  | "Needs sign-off"
  // You sent it back for more information. Distinct from "On track", which
  // would relabel a request for missing evidence as forward progress, and from
  // "Needs sign-off", which would keep claiming the decision is still yours to
  // take after you have already taken it.
  | "With merchant"
  | "Exception"
  | "Live"

export interface MerchantEvent {
  step: StepId
  actor: "Agent" | "Acquirer"
  text: string
  time: string
  done: boolean
}

export interface Merchant {
  id: string
  name: string
  sector: string
  location: string
  size: string // annual card volume band
  terminals: string // ordered device summary
  terminalCount: number
  currentStep: StepId
  status: MerchantStatus
  submitted: string
  // underwriting detail (used on the sign-off screen)
  underwriting?: {
    identity: string
    documents: string
    /**
     * Required documents the merchant has not supplied, named individually.
     *
     * Named rather than counted because the chase has to ASK for something
     * specific, and because "2 outstanding" cannot tell you whether the file
     * is missing a bank statement or an ownership chain — one is an
     * administrative gap, the other stops underwriting dead.
     */
    documentsOutstanding?: string[]
    /**
     * OPTIONAL BY DESIGN. A risk score cannot exist for a file that could not
     * be assessed, so the type must permit its absence — otherwise every
     * incomplete file is forced to carry a number, which is exactly how
     * Orchard Lane came to be recorded as "22 / 100 · Low" while its
     * beneficial-ownership chain was still unknown. An absent score is a
     * different claim from a low one.
     */
    riskScore?: number
    riskBand?: "Low" | "Medium" | "Elevated"
    edgeCase?: string
  }
  events: MerchantEvent[]
}

export const MERCHANTS: Merchant[] = [
  {
    id: "m-atlas",
    name: "Atlas Coffee Roasters",
    sector: "Hospitality",
    location: "Manchester, UK",
    size: "£2.4m / yr",
    terminals: "3× A920 + softPOS",
    terminalCount: 4,
    currentStep: 2,
    status: "Needs sign-off",
    submitted: "2 days ago",
    underwriting: {
      identity: "Verified — Companies House + director KYC matched",
      documents: "6 documents parsed, all consistent",
      riskScore: 18,
      riskBand: "Low",
      edgeCase: "Director also owns a dormant entity flagged in a 2019 chargeback dispute. No open liabilities.",
    },
    events: [
      { step: 1, actor: "Acquirer", text: "Merchant submitted with expected volume £2.4m.", time: "2d ago", done: true },
      { step: 1, actor: "Agent", text: "Recommended 3× A920 + softPOS from similar hospitality merchants.", time: "2d ago", done: true },
      { step: 2, actor: "Agent", text: "Identity verified and 6 documents parsed. Risk score 18 (Low). One edge case flagged for review.", time: "1d ago", done: true },
      { step: 2, actor: "Acquirer", text: "Awaiting your regulated sign-off.", time: "now", done: false },
    ],
  },
  {
    id: "m-verde",
    name: "Verde Grocers",
    sector: "Retail",
    location: "Lisbon, PT",
    size: "€5.1m / yr",
    terminals: "8× Move 5000",
    terminalCount: 8,
    currentStep: 2,
    status: "Needs sign-off",
    submitted: "1 day ago",
    underwriting: {
      identity: "Verified — VAT + beneficial owner confirmed",
      documents: "9 documents parsed, all consistent",
      riskScore: 34,
      riskBand: "Medium",
      edgeCase: "Projected volume is 3× the sector median for store count. Agent recommends a volume review at 90 days.",
    },
    events: [
      { step: 1, actor: "Acquirer", text: "Merchant submitted, 8 stores.", time: "1d ago", done: true },
      { step: 1, actor: "Agent", text: "Recommended 8× Move 5000 for multi-lane grocery.", time: "1d ago", done: true },
      { step: 2, actor: "Agent", text: "Identity verified, documents parsed. Risk score 34 (Medium). Volume flag raised.", time: "6h ago", done: true },
      { step: 2, actor: "Acquirer", text: "Awaiting your regulated sign-off.", time: "now", done: false },
    ],
  },
  {
    id: "m-nordwind",
    name: "Nordwind Apotheke",
    sector: "Pharmacy",
    location: "Hamburg, DE",
    size: "€1.2m / yr",
    terminals: "2× Desk 5000",
    terminalCount: 2,
    currentStep: 4,
    status: "Needs sign-off",
    submitted: "4 days ago",
    events: [
      { step: 1, actor: "Acquirer", text: "Merchant submitted.", time: "4d ago", done: true },
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 12 (Low).", time: "3d ago", done: true },
      { step: 3, actor: "Acquirer", text: "Terminal order confirmed.", time: "3d ago", done: true },
      { step: 4, actor: "Agent", text: "Receipts and on-device branding prepared. German-language receipt template applied.", time: "2h ago", done: true },
      { step: 4, actor: "Acquirer", text: "Awaiting your branding approval.", time: "now", done: false },
    ],
  },
  {
    id: "m-solmar",
    name: "SolMar Beach Clubs",
    sector: "Hospitality",
    location: "Málaga, ES",
    size: "€3.8m / yr",
    terminals: "6× A920 + 2× softPOS",
    terminalCount: 8,
    currentStep: 8,
    status: "On track",
    submitted: "9 days ago",
    events: [
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 22 (Low).", time: "8d ago", done: true },
      { step: 5, actor: "Agent", text: "Device profiles built and configuration loaded.", time: "5d ago", done: true },
      { step: 6, actor: "Agent", text: "All 8 terminals tested and passed.", time: "4d ago", done: true },
      { step: 7, actor: "Agent", text: "Shipped and delivered to 3 sites.", time: "2d ago", done: true },
      { step: 8, actor: "Agent", text: "Merchant guided through install in Spanish. 6 of 8 terminals activated.", time: "3h ago", done: false },
    ],
  },
  {
    id: "m-brightline",
    name: "Brightline Pharmacy Group",
    sector: "Pharmacy",
    location: "Dublin, IE",
    size: "€6.7m / yr",
    terminals: "12× Desk 5000",
    terminalCount: 12,
    currentStep: 6,
    status: "On track",
    submitted: "6 days ago",
    events: [
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 28 (Medium).", time: "5d ago", done: true },
      { step: 5, actor: "Agent", text: "Configuration loaded across 12 devices.", time: "2d ago", done: true },
      { step: 6, actor: "Agent", text: "Testing in progress — 9 of 12 passed.", time: "1h ago", done: false },
    ],
  },
  {
    id: "m-tavo",
    name: "Tavola Trattoria",
    sector: "Hospitality",
    location: "Milan, IT",
    size: "€0.9m / yr",
    terminals: "2× A920",
    terminalCount: 2,
    currentStep: 3,
    status: "Exception",
    submitted: "3 days ago",
    events: [
      // 41 sits in Medium under the published 25–49 band. The line previously
      // read "Elevated", contradicting the threshold table on the risk desk.
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 41 (Medium).", time: "2d ago", done: true },
      { step: 3, actor: "Agent", text: "Order paused — merchant address failed logistics validation. Awaiting corrected delivery address.", time: "5h ago", done: false },
    ],
  },
  {
    id: "m-fjord",
    name: "Fjord Outdoor Co.",
    sector: "Retail",
    location: "Bergen, NO",
    size: "kr 22m / yr",
    terminals: "5× Move 5000",
    terminalCount: 5,
    currentStep: 7,
    status: "On track",
    submitted: "8 days ago",
    events: [
      { step: 6, actor: "Agent", text: "All terminals tested and passed.", time: "2d ago", done: true },
      { step: 7, actor: "Agent", text: "Shipping today — tracking shared with merchant.", time: "20m ago", done: false },
    ],
  },
  {
    id: "m-lumen",
    name: "Lumen Fitness Studios",
    sector: "Health & Fitness",
    location: "Amsterdam, NL",
    size: "€1.8m / yr",
    terminals: "4× softPOS",
    terminalCount: 4,
    currentStep: 9,
    status: "Live",
    submitted: "12 days ago",
    events: [
      { step: 8, actor: "Agent", text: "Merchant guided through softPOS install in Dutch, now live.", time: "1d ago", done: true },
      { step: 9, actor: "Agent", text: "First live payment detected — €48.00. Records written back to acquirer.", time: "22h ago", done: true },
    ],
  },
  {
    id: "m-cedar",
    name: "Cedar & Co. Bookshop",
    sector: "Retail",
    location: "Edinburgh, UK",
    size: "£0.6m / yr",
    terminals: "1× A920",
    terminalCount: 1,
    currentStep: 5,
    status: "On track",
    submitted: "5 days ago",
    events: [
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 9 (Low).", time: "4d ago", done: true },
      { step: 5, actor: "Agent", text: "Building device profile.", time: "3h ago", done: false },
    ],
  },
  {
    id: "m-havenport",
    name: "Havenport Marina",
    sector: "Leisure",
    location: "Marseille, FR",
    size: "€4.4m / yr",
    terminals: "3× Move 5000 + softPOS",
    terminalCount: 4,
    currentStep: 9,
    status: "Live",
    submitted: "14 days ago",
    events: [
      { step: 8, actor: "Agent", text: "Merchant guided through install in French, now live.", time: "2d ago", done: true },
      { step: 9, actor: "Agent", text: "First live payment detected — €126.50. Records written back to acquirer.", time: "2d ago", done: true },
    ],
  },
  {
    id: "m-kessler",
    name: "Kessler Automotive",
    sector: "Automotive",
    location: "Stuttgart, DE",
    size: "€9.2m / yr",
    terminals: "6× Desk 5000",
    terminalCount: 6,
    currentStep: 6,
    status: "On track",
    submitted: "7 days ago",
    events: [
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 31 (Medium).", time: "6d ago", done: true },
      { step: 6, actor: "Agent", text: "Testing terminals — 4 of 6 passed.", time: "40m ago", done: false },
    ],
  },
  {
    id: "m-marisol",
    name: "Marisol Markets",
    sector: "Retail",
    location: "Valencia, ES",
    size: "€2.1m / yr",
    terminals: "4× A920",
    terminalCount: 4,
    currentStep: 8,
    status: "On track",
    submitted: "10 days ago",
    events: [
      { step: 7, actor: "Agent", text: "Delivered to merchant.", time: "1d ago", done: true },
      { step: 8, actor: "Agent", text: "Guiding merchant through install in Spanish — 3 of 4 activated.", time: "2h ago", done: false },
    ],
  },

  // -------------------------------------------------------------------------
  // Demo coverage. Every step 1-9 carries at least one journey and all five
  // statuses appear, so a walkthrough never lands on an empty screen.
  //
  // These are ordinary fixtures, not a special case. `statusPossibleAt()`
  // rejects any step/status pair the handoff model says cannot occur, and
  // `estateRows` throws on one, so this comment cannot quietly go stale.
  // -------------------------------------------------------------------------

  // Step 1, still being drafted. Having both statuses at this step is the
  // point: here the agent has not finished, so there is nothing yet to decide.
  {
    id: "m-ravenswood",
    name: "Ravenswood Deli",
    sector: "Hospitality",
    location: "Bristol, UK",
    size: "£680k / yr",
    terminals: "2× A920",
    terminalCount: 2,
    currentStep: 1,
    status: "On track",
    submitted: "3 hours ago",
    events: [
      { step: 1, actor: "Acquirer", text: "Intake received — single site, counter service.", time: "3h ago", done: true },
      { step: 1, actor: "Agent", text: "Matching against comparable delis to size the kit.", time: "now", done: false },
    ],
  },

  // Step 1, drafted and now waiting on the acquirer to accept the merchant.
  {
    id: "m-thistle",
    name: "Thistle & Thread",
    sector: "Retail",
    location: "Edinburgh, UK",
    size: "£940k / yr",
    terminals: "2× A920 + softPOS",
    terminalCount: 3,
    currentStep: 1,
    status: "Needs sign-off",
    submitted: "1 day ago",
    events: [
      { step: 1, actor: "Acquirer", text: "Intake received — shop floor plus weekend markets.", time: "1d ago", done: true },
      { step: 1, actor: "Agent", text: "Recommended 2× A920 for the shop and softPOS for market stalls.", time: "5h ago", done: true },
      { step: 1, actor: "Acquirer", text: "Awaiting your confirmation of the setup.", time: "now", done: false },
    ],
  },

  // Step 2, RETURNED to the merchant — the status that was missing entirely.
  // Not "On track", which would relabel a request for missing evidence as
  // progress, and not "Needs sign-off", because the decision is not the
  // acquirer's to take again until the documents come back.
  {
    id: "m-orchard",
    name: "Orchard Lane Veterinary",
    sector: "Healthcare",
    location: "Dublin, IE",
    size: "€1.5m / yr",
    terminals: "3× Desk 5000",
    terminalCount: 3,
    currentStep: 2,
    status: "With merchant",
    submitted: "6 days ago",
    underwriting: {
      identity: "Verified — CRO registration and director KYC matched",
      // A partial parse is stated as partial. "4 documents parsed" alone would
      // read as a complete file.
      documents: "4 of 6 documents parsed — 2 outstanding",
      documentsOutstanding: [
        "Ownership statement for the 30% corporate holder",
        "Bank statement for the settlement account",
      ],
      // No riskScore and no riskBand, deliberately. This file previously read
      // "22 / 100 · Low" while its own edge case said beneficial ownership
      // could not be confirmed — a band issued over an unknown owner. The
      // score is not low here; it is unknown, and the two must not look alike.
      edgeCase:
        "Beneficial ownership cannot be confirmed from the file supplied: a 30% holder is a second company with no ownership statement attached.",
    },
    events: [
      { step: 1, actor: "Acquirer", text: "Merchant submitted — 3 consulting rooms.", time: "6d ago", done: true },
      { step: 2, actor: "Agent", text: "Identity verified. 4 of 6 documents parsed; ownership chain incomplete.", time: "4d ago", done: true },
      { step: 2, actor: "Acquirer", text: "Returned to merchant for the ownership statement and a settlement bank statement.", time: "3d ago", done: true },
      { step: 2, actor: "Agent", text: "Chase sent. Merchant has opened the portal but not uploaded.", time: "now", done: false },
    ],
  },

  // Step 3, validated by the order desk and waiting on the acquirer to commit
  // the spend. Mixed basket so the routing has a real allocation to solve.
  {
    id: "m-meadowbank",
    name: "Meadowbank Farm Shop",
    sector: "Retail",
    location: "York, UK",
    size: "£3.1m / yr",
    terminals: "6× A920 + 4× Move 5000",
    terminalCount: 10,
    currentStep: 3,
    status: "Needs sign-off",
    submitted: "5 days ago",
    events: [
      { step: 1, actor: "Acquirer", text: "Merchant submitted — farm shop, café and a seasonal yard.", time: "5d ago", done: true },
      { step: 2, actor: "Acquirer", text: "Underwriting signed off. Risk score 16 (Low).", time: "4d ago", done: true },
      { step: 3, actor: "Agent", text: "Basket priced and availability confirmed.", time: "1d ago", done: true },
      { step: 3, actor: "Acquirer", text: "Awaiting your order confirmation against the rate card.", time: "now", done: false },
    ],
  },

  // Step 6, Exception. An Ingenico-OWNED step going wrong: the acquirer can
  // see it and chase, but cannot fix it from this screen.
  {
    id: "m-summit",
    name: "Summit Sports",
    sector: "Retail",
    location: "Innsbruck, AT",
    size: "€2.7m / yr",
    terminals: "6× A920",
    terminalCount: 6,
    currentStep: 6,
    status: "Exception",
    submitted: "12 days ago",
    events: [
      { step: 5, actor: "Agent", text: "Configuration built and signed.", time: "4d ago", done: true },
      { step: 6, actor: "Agent", text: "Certification pack run: 4 of 6 terminals passed.", time: "2d ago", done: true },
      { step: 6, actor: "Agent", text: "2 terminals failed the contactless floor-limit test. Held for rebuild — not shipped.", time: "now", done: false },
    ],
  },

  // Step 7, Exception. Despatched then stopped, which is a different failure
  // from never having left: the units exist and are somewhere.
  {
    id: "m-glasswing",
    name: "Glasswing Hotels",
    sector: "Hospitality",
    location: "Porto, PT",
    size: "€4.6m / yr",
    terminals: "10× A920 + 2× Desk 5000",
    terminalCount: 12,
    currentStep: 7,
    status: "Exception",
    submitted: "16 days ago",
    events: [
      { step: 6, actor: "Agent", text: "Certification pack passed on all 12 units.", time: "5d ago", done: true },
      { step: 7, actor: "Agent", text: "Despatched from two depots.", time: "3d ago", done: true },
      { step: 7, actor: "Agent", text: "Second shipment held in transit — commercial invoice rejected at the border. 10 of 12 delivered.", time: "now", done: false },
    ],
  },

  // Step 8, waiting on the merchant rather than progressing. Same status as
  // Orchard Lane but a genuinely different meaning — nothing is missing from
  // the file, the site simply has not let anyone in.
  {
    id: "m-pinegrove",
    name: "Pinegrove Garden Rooms",
    sector: "Retail",
    location: "Galway, IE",
    size: "€1.1m / yr",
    terminals: "2× Move 5000",
    terminalCount: 2,
    currentStep: 8,
    status: "With merchant",
    submitted: "18 days ago",
    events: [
      { step: 7, actor: "Agent", text: "Delivered and signed for at the showroom.", time: "6d ago", done: true },
      { step: 8, actor: "Agent", text: "Install window missed twice. Devices on site, not yet powered on.", time: "2d ago", done: true },
      { step: 8, actor: "Acquirer", text: "Chased the merchant for a third appointment.", time: "now", done: false },
    ],
  },
]

// KPI helpers derived from the book so the numbers always match the table.
/**
 * The order the book is worked in, which is what this page says it is for:
 * "everything onboarding, and what needs your call".
 *
 * The table previously rendered in fixture order — effectively arbitrary, and
 * arbitrary is a claim too: it tells the reader there is no reason to start at
 * the top. Anything demanding the acquirer's own action leads; work parked
 * elsewhere follows; finished journeys sit at the bottom. Ties break by step
 * so a scan still runs along the pipeline.
 */
const STATUS_URGENCY: Record<MerchantStatus, number> = {
  Exception: 0,
  "Needs sign-off": 1,
  "With merchant": 2,
  "On track": 3,
  Live: 4,
}

export function portfolioOrder(merchants: Merchant[]): Merchant[] {
  return [...merchants].sort((a, b) => {
    const u = STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status]
    if (u !== 0) return u
    if (a.currentStep !== b.currentStep) return a.currentStep - b.currentStep
    return a.name.localeCompare(b.name)
  })
}

export function portfolioKpis(merchants: Merchant[]) {
  const liveThisMonth = merchants.filter((m) => m.status === "Live").length
  const awaitingSignOff = merchants.filter((m) => m.status === "Needs sign-off").length
  const exceptions = merchants.filter((m) => m.status === "Exception").length
  return {
    liveThisMonth,
    avgTimeToGoLive: "8.4 days",
    awaitingSignOff,
    exceptions,
  }
}

export function statusTone(status: MerchantStatus): {
  bg: string
  text: string
  dot: string
} {
  switch (status) {
    case "Needs sign-off":
      return { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" }
    // Muted, not amber: the ball is out of your court, so it must not sit in
    // the same colour as the queue of things still waiting on you.
    case "With merchant":
      return { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" }
    case "Exception":
      return { bg: "bg-destructive/12", text: "text-destructive", dot: "bg-destructive" }
    case "Live":
      return { bg: "bg-success/15", text: "text-success", dot: "bg-success" }
    default:
      return { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary" }
  }
}

export function bandTone(band: Band): string {
  switch (band) {
    case "Augment":
      return "bg-primary/10 text-primary"
    case "Assist":
      return "bg-chart-4/12 text-chart-4"
    case "Automate":
      return "bg-success/12 text-success"
  }
}
