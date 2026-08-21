// The Ingenico agentic onboarding pipeline, from the acquirer's point of view.
// Steps the acquirer OWNS or SIGNS OFF are marked actionable; everything else
// the agent runs and the acquirer watches.

export type Band = "Augment" | "Assist" | "Automate"

/** Stable keys, NOT positions. 10 and 11 are KYC and Pricing, which were split
 *  out of Underwriting (2) and sit BEFORE it on the risk lane — the numbers are
 *  out of running order on purpose, because 63 artefact cases and every fixture
 *  event are addressed by id. Read order from the PIPELINE array. */
export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

// A single unit of work the agent performs inside a step, with the artefact
// it produced. This is what the acquirer "plays" through on the journey.
export interface AgentTask {
  label: string
  detail: string
  // short machine-style output the agent emits (rendered mono, like a console)
  output: string
  /**
   * Set when the agent does NOT perform this work itself.
   *
   * Absent means the agent did it — reading documents, drafting, judging
   * against policy. Present means it assembled a request, sent it to a named
   * system and read the answer back. Both are real work and the app was
   * showing them identically, which quietly claimed Ingenico's agent decides
   * KYC, pricing and credit. It does not; it drives the systems that do.
   *
   * Deliberately per-TASK, not per-step. `tools` is a capability list for the
   * whole step, so it cannot say which unit of work leaves the agent — on
   * Underwriting the parse is genuinely ours and the score is not, and one
   * chip row cannot express that.
   */
  delegate?: Delegation
}

/**
 * A unit of work performed by a system the agent operates rather than by the
 * agent itself.
 *
 * A discriminated union on `runsOn`, because the three cases carry genuinely
 * different obligations rather than being one shape with a label:
 *
 *  - `acquirer` — their existing contract, their system of record. Nothing to
 *    sell and nothing to swap.
 *  - `ingenico` — our tool is serving a capability the acquirer could serve
 *    themselves, so `swap` is REQUIRED. A fallback presented without its
 *    alternative reads as a dependency, which is the objection this whole
 *    distinction exists to answer.
 *  - `external` — public or scheme infrastructure (a companies register, a
 *    certification host). There is no `swap` because nobody is selling it and
 *    a "replace this" affordance on a statutory register would be nonsense.
 *
 * `runsOn` mirrors `ToolOwner`'s values on purpose — same question, same
 * vocabulary — but is not the same type: a Tool is a capability the step can
 * reach for, a Delegation is a round trip that actually happened.
 */
export type Delegation = { capability: string; system: string; prepares: string; reads: string } & (
  | { runsOn: "acquirer" }
  | {
      runsOn: "ingenico"
      /** How the acquirer takes this over with their own provider. Required,
       *  so Ingenico's tool can never be the only option on screen. */
      swap: string
    }
  | { runsOn: "external" }
)

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

/**
 * Where a piece of the application CAME FROM.
 *
 * Deliberately not `ToolOwner`. A tool is a system the agent drives and is
 * owned by us, Ingenico or a third party; a source is provenance, and its most
 * important value — the merchant themselves — is not a system at all. Reusing
 * `ToolOwner` would have forced the merchant's own bundle to be filed as
 * "external", flattening the one distinction an acquirer checks first: did we
 * take this from the applicant, or corroborate it independently?
 */
export type SourceOrigin = "merchant" | "acquirer" | "external"

export interface InputSource {
  name: string
  origin: SourceOrigin
  /**
   * `primary` is the material the application is built FROM. Only primary
   * sources are rendered: an enrichment source is, in every case so far, also
   * a tool the agent operates, so listing it here as well printed the same
   * name twice on adjacent rows. The value is kept in the union because a
   * corroborating source that is NOT a tool is a real possibility (a document
   * the acquirer holds outside any system), and it should be filed honestly
   * when one appears rather than promoted to primary.
   */
  role: "primary" | "enrichment"
  detail: string
}

/** Which track a step sits on once the journey forks.
 *
 *  Underwriting runs AT THE SAME TIME as the kit is ordered and built — that is
 *  how time to delivery is compressed in practice — so the pipeline is not one
 *  line. `spine` steps are the shared backbone (capture, then ship onwards);
 *  `risk` and `build` are the two parallel lanes between the fork and the
 *  rejoin at Ship. */
export type Lane = "spine" | "risk" | "build"

export interface PipelineStep {
  id: StepId
  /** Display label ONLY — never an index. Numbers ("01".."04") mark a position
   *  on the spine; letters ("R", "B1".."B4") mark a lane, where no single
   *  sequence exists to be Nth in. Deliberately decoupled from `id`, which is a
   *  stable key: 63 artefact cases and every fixture event are addressed by
   *  `id`, so renumbering those to match the new labels would silently
   *  re-point the entire artefact layer. */
  code: string
  name: string
  lane: Lane
  band: Band
  /**
   * Does the acquirer have a hands-on role at this step?
   *
   * `releases` is deliberately NOT `signs-off`. A sign-off is a judgement on
   * the substance — the acquirer reads the analysis and takes the regulated
   * decision — and it gates the sign-off queue. A release is narrower: the
   * work is settled and the only question left is whether it leaves for
   * another system. Folding the two together would have put Go-live into the
   * decision queue as though a determination were outstanding, when what is
   * actually outstanding is a dispatch.
   *
   * It is not `watch` either, which is what it used to be — `watch` means the
   * step completes without the acquirer, and Go-live no longer does.
   */
  acquirerRole: "owns" | "signs-off" | "approves" | "releases" | "watch"
  blurb: string
  // What the agent is doing, in one line, for the cockpit header.
  agentMission: string
  // The tools / systems the agent reaches for at this step.
  tools: Tool[]
  /**
   * What the step's output is BUILT FROM, as distinct from `tools`, which is
   * what the agent operates. A registry legitimately appears in both — it is a
   * system the agent queries and a provenance class for the fields it returns —
   * and separating them is what lets the screen answer "where did this value
   * come from?" without the reader inferring it from a capability list.
   */
  sources?: InputSource[]
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
    name: "Merchant capture",
    lane: "spine",
    band: "Augment",
    acquirerRole: "owns",
    blurb: "Acquirer owns the customer and decides whether the application goes forward.",
    agentMission:
      "Turn a merchant's documents and a few details into a shaped, corroborated application and a kit recommendation.",
    // "Merchant CRM" stays a tool as well as a source: task 9 WRITES to it, and
    // the integration banner directly below asserts the agent reads and writes
    // it. A chip row with nothing of the acquirer's on it would leave that claim
    // unsupported by the one row that names whose systems are in play.
    tools: [
      ingenicoTool("Document AI"),
      acquirerTool("Merchant CRM"),
      externalTool("Public registries"),
      externalTool("Web research"),
    ],
    /* Capture is dominated by DOCUMENTS, not typed fields: the merchant hands
       over a bundle, and everything else on this step exists to corroborate it.
    
       Only the primary source is listed. The three enrichment sources — CRM,
       registries, web research — are all in `tools` above, and carrying them
       here too printed each name twice on adjacent rows. Corroboration is
       stated in `agentMission` and evidenced per-task instead. */
    sources: [
      {
        name: "Uploaded documents",
        origin: "merchant",
        role: "primary",
        detail: "The bundle the merchant supplied — incorporation, address, ID, bank statement",
      },
    ],
    integration:
      "The agent reads and writes your CRM through Ingenico's integration. The merchant record stays in your system — nothing is re-keyed into a second one.",
    /* ONE task for the whole document pass.
    
       This was five — classify, extract, quality, checklist, reconcile — and the
       split was wrong twice over. They are not five decisions but five internal
       passes of a single act, none separately actionable: nobody chases a
       merchant because "extraction" finished. Worse, it scattered the answer, so
       "what is missing?" sat on a different panel from "what arrived?" and from
       "what did we learn?" — three sides of one question, on three screens.
    
       The tasks that survive are the ones with genuinely different sources and
       different failure modes: the register is independent of the applicant, the
       website is an inference, the kit is a recommendation, the draft is a write. */
    tasks: [
      {
        label: "Process the document bundle",
        detail:
          "Classifies each file, reads the fields out of it, checks it is legible and in date, matches the required set, and reconciles the documents against each other.",
        output: "doc.process → classified, extracted, checked, reconciled",
      },
      {
        label: "Enrich from public registries",
        detail: "Pulls registration, directors and tax ID from the registry.",
        output: "registry.enrich → company number + directors + tax id",
      },
      {
        label: "Research the business online",
        detail:
          "Reads the merchant's website to confirm what the business actually does and corroborate the stated sector.",
        output: "web.research → stated sector corroborated",
      },
      {
        label: "Shape the application and recommend the kit",
        detail:
          "Normalises sector, geography and volume, finds look-alike merchants, and proposes the device mix.",
        output: "recommend.kit → device mix proposed from look-alikes",
      },
      {
        label: "Draft into CRM",
        // "Writes the onboarding record into your CRM" claimed the agent performs
        // the write. It fills the form; you release it. The label stays "Draft
        // into CRM" because that IS the output — a draft addressed at the CRM —
        // but the verb had to stop being "writes".
        detail:
          "Fills in your CRM record so nothing is re-typed downstream, and holds it for you to check and release.",
        output: "application.draft → fields populated, gaps named, held for release",
      },
    ],
    // Confirming now releases BOTH lanes, not just underwriting. Saying only
    // "hands it to underwriting" would describe the old sequential pipeline
    // and hide the very thing that compresses the timeline.
    // NOTE: `handback` is currently rendered NOWHERE — the surface that actually
    // asks for confirmation is `STEP_HANDOFFS` in lib/handoffs.ts, and that is
    // where the web-inference caveat had to go. Left as-is deliberately: editing
    // unread copy would look like the claim had been updated when nothing on
    // screen changed.
    handback: "The decision is yours. Confirming starts underwriting and the kit build at the same time.",
  },
  /* The risk lane, in running order: KYC → Pricing → Underwriting.
   *
   *  KYC and Underwriting were ONE step called "Underwrite", which conflated two
   *  unrelated questions — is this entity legitimate (compliance), and can we
   *  carry its financial exposure (credit). They fail for different reasons, are
   *  cleared by different teams and have different remedies, so a single verdict
   *  over both could only ever name one of them.
   *
   *  Underwriting KEEPS id 2 through the split. The ids on this lane therefore
   *  run 10 → 11 → 2, which looks wrong and is deliberate: 63 artefact cases and
   *  every fixture event are keyed on `id`, so renumbering to make the lane read
   *  tidily would silently re-point the whole artefact layer. Order lives in the
   *  array. */
  {
    id: 10,
    code: "R1",
    name: "KYC",
    lane: "risk",
    band: "Augment",
    acquirerRole: "signs-off",
    blurb: "Agent screens the entity and its owners. Compliance, not credit — the two are separate calls.",
    agentMission: "Clear the straightforward majority automatically and escalate only genuine hits.",
    tools: [
      externalTool("Companies House"),
      acquirerTool("KYC / KYB platform"),
      acquirerTool("Sanctions & PEP screening"),
      // Ingenico's, not theirs — this fixture's acquirer buys screening and
      // KYB but not media. The chip and the task's `delegate.runsOn` answer the
      // same question, so they must not disagree.
      ingenicoTool("Adverse media"),
    ],
    // Names the exception rather than leaving the per-task strip to contradict
    // it: three of these four calls land on the acquirer's own stack, one does
    // not, and a blanket "runs inside your systems" was false about the fourth.
    integration:
      "The agent screens nobody itself — it calls your platform over your existing contract and reads the results back, and your platform stays the system of record. Adverse media is the one capability running on Ingenico's here, because this acquirer does not buy it; it can be pointed at yours.",
    tasks: [
      /* Every task on this step is a round trip — the agent screens nobody. It
         shapes the request, calls out and reads the answer back. Stating that
         four times is not repetition here; it IS the step. */
      {
        label: "Verify the entity",
        detail: "Confirms the legal entity and its directors against the company registry.",
        output: "kyb.verify → entity active, 2 directors matched ok",
        delegate: {
          runsOn: "external",
          capability: "Company registry",
          system: "Companies House",
          prepares: "Company number and the two director names taken off the certificate",
          reads: "The live filing, compared field by field against what was submitted",
        },
      },
      {
        label: "Screen sanctions and PEP",
        detail: "Checks every beneficial owner above 25% against the consolidated lists.",
        output: "screen.pep_sanctions → 0 sanctions, 0 PEP",
        delegate: {
          runsOn: "acquirer",
          capability: "Sanctions and PEP",
          system: "Your screening platform",
          prepares: "Every owner above 25%, with dates of birth and nationalities resolved",
          reads: "Each hit scored, and only genuine matches escalated to you",
        },
      },
      {
        label: "Verify identity",
        detail: "Matches submitted identity documents to the named owners.",
        output: "identity.verify → 2 of 2 owners matched",
        delegate: {
          runsOn: "acquirer",
          capability: "Identity verification",
          system: "Your KYC / KYB platform",
          prepares: "Identity documents paired to the owner each one belongs to",
          reads: "The match result per owner, written back onto the application",
        },
      },
      {
        label: "Scan adverse media",
        detail: "Searches the five-year window and flags only material findings.",
        output: "media.scan → 1 note raised for review",
        /* The one capability on this step Ingenico serves, and the reason the
           swap line is a required field: an acquirer who already buys media
           screening must be able to see, here, that ours is not compulsory. */
        delegate: {
          runsOn: "ingenico",
          capability: "Adverse media",
          system: "Ingenico media scan",
          prepares: "Entity and owner names, plus the five-year window and languages to search",
          reads: "Material findings only — routine mentions are discarded, not queued",
          swap: "Point this at your own media provider over REST and the agent calls yours instead. Your contract, your retention policy.",
        },
      },
    ],
    // The non-blocking point, said once and in the right place: this lane runs
    // beside the build, so a KYC still in flight does not stop the kit.
    handback:
      "Compliance sign-off is yours. The build lane keeps moving while this resolves — only Ship waits on it.",
  },
  {
    id: 11,
    code: "R2",
    name: "Pricing",
    lane: "risk",
    band: "Augment",
    acquirerRole: "owns",
    blurb: "Acquirer sets the commercial model: monthly fee, setup fee and per-transaction rates by method.",
    agentMission: "Recommend a tariff for this merchant type and show what it costs in sign-ups.",
    tools: [
      acquirerTool("Pricing book"),
      ingenicoTool("Sector benchmarks"),
      ingenicoTool("Conversion model"),
    ],
    integration:
      "Rates are written back to your pricing book. Website offers and bank-channel promotions stay yours to set — the agent proposes within the bands you allow, it does not discount on your behalf.",
    tasks: [
      {
        label: "Model the economics",
        detail: "Projects revenue per method against the merchant's expected mix and volume.",
        output: "econ.model → blended 1.31% on £2.4m/yr",
        delegate: {
          runsOn: "ingenico",
          capability: "Conversion modelling",
          system: "Ingenico conversion model",
          prepares: "Sector, expected volume and method mix, matched to comparable merchants",
          reads: "Sign-up sensitivity per rate line, with the supported range it was fitted over",
          swap: "Acquirers who run their own elasticity model call it here instead — the agent sends the same inputs and reads your curve back.",
        },
      },
      {
        label: "Recommend a tariff",
        detail: "Proposes monthly, setup and per-transaction rates for this merchant type.",
        output: "tariff.recommend → £19/mo, £0 setup, card 1.4% / wallet 0.9%",
        delegate: {
          runsOn: "acquirer",
          capability: "Rate card",
          system: "Your pricing book",
          prepares: "The merchant category and the bands you allow for it",
          reads: "Rates proposed inside your bands — the agent does not discount on your behalf",
        },
      },
    ],
    // "the agent shows both sides" meant the two A/B variants. With the test
    // removed there is no "both sides" anywhere on this step, so the sentence
    // would have gone on pointing at something the step no longer contains.
    handback:
      "The commercial call is yours. The agent proposes rates within the bands you allow and shows what they cost in sign-ups — it does not set the price for you.",
  },
  {
    id: 2,
    code: "R3",
    name: "Underwriting",
    lane: "risk",
    band: "Augment",
    acquirerRole: "signs-off",
    blurb: "Agent assembles the evidence and runs it through your risk engine. Acquirer signs the regulated decision.",
    agentMission:
      "Put a complete, reconciled file in front of your risk engine, then show exactly what it returned and what stands behind it.",
    tools: [
      ingenicoTool("Document AI"),
      acquirerTool("Risk model"),
      acquirerTool("Credit policy"),
    ],
    /* The offer of "an in-context model for acquirers who do not run one" is
       DELETED, not softened. It contradicted this step's own `tools` row, where
       both the risk model and the credit policy are the acquirer's, and it is
       what made an "Integrate your own model" button look sensible: if Ingenico
       ships a fallback, swapping it in is a real act. It does not. The engine is
       theirs, the agent calls it, and its answer is not ours to revise. */
    integration:
      "Your risk model and credit policy are the system of record and your thresholds decide the outcome. The agent calls them over your existing integration and applies what they return — it cannot re-weight a factor, move a limit, or proceed against a decline.",
    tasks: [
      /* Two of these four carry no `delegate`, and that is the point of the
         field. Reading the documents and spotting what sits outside policy are
         the agent's own work; scoring the exposure and setting the limit are
         decisions the acquirer's model owns. Marking all four as handoffs would
         understate what the agent does, marking none overstates it. */
      {
        label: "Parse the documents",
        detail: "Extracts and cross-checks figures across every uploaded document.",
        output: "docai.parse → 6 docs, 18 fields, 0 inconsistencies ok",
      },
      {
        /* "Score the risk" / "Combines all signals into a single risk score"
           said the AGENT weights the factors — which this task's own
           `delegate.reads` directly denies one line below. On the KYC lane
           "Verify" and "Screen" are fine: they name an operation the agent
           genuinely initiates. "Score" and "Set" are DECISION verbs, and the
           decision is the engine's. */
        label: "Read your risk score",
        detail: "Sends the parsed signals to your risk model and reads back the score and band.",
        output: "risk.score → 18 / 100  band=LOW  (returned by your risk model)",
        delegate: {
          runsOn: "acquirer",
          capability: "Risk scoring",
          system: "Your risk model",
          prepares: "The parsed figures and screening results, mapped to your model's inputs",
          reads: "Your score and band — the agent does not weight the factors itself",
        },
      },
      {
        label: "Read your acceptance limit",
        // Not "Recommends": a recommendation is Ingenico's view, offered for
        // the acquirer to take or leave. The limit is their credit policy's
        // ruling coming back, and the agent applies it as returned.
        detail: "Reads the daily exposure your credit policy allows, and the rule that produced it.",
        output: "limit.fetch → £14,000/day  (rule: standard retail)",
        delegate: {
          runsOn: "acquirer",
          capability: "Credit policy",
          system: "Your credit policy",
          prepares: "Merchant category, band and projected volume",
          reads: "The limit your policy allows, with the rule that produced it named",
        },
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
    code: "B1",
    name: "Order",
    lane: "build",
    band: "Assist",
    acquirerRole: "approves",
    blurb: "Agent proposes the terminal order. Acquirer approves and places it.",
    // "with stock and delivery confirmed" promised a confirmation that only
    // the order desk can give, and only AFTER the order is placed. What the
    // agent assembles is an order ready TO place, checked as far as published
    // information allows.
    agentMission: "Assemble a ready-to-place terminal order, checked against stock and delivery.",
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
        // Counting warehouse units is Ingenico's job — and so is COMMITTING to
        // it. This said "Ingenico's order desk confirms what it can supply",
        // which credited the agent's own lookup with another party's
        // commitment, and asserted it before that party had been asked
        // anything: the order desk is only engaged once the order is placed,
        // one panel below. What the agent can honestly do is read the
        // published stock position, which indicates rather than commits.
        label: "Check availability",
        detail: "Reads Ingenico's published stock position for an indication against this basket.",
        output: "availability.check → all lines showing in stock (indicative)",
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
    // Placing is not the end of the step: the order desk still has to come
    // back with stock and a date. Saying "releases it to fulfilment" made the
    // acquirer's click sound terminal and left that wait unmentioned.
    handback:
      "You approve the proposed order and place it. Ingenico's order desk then confirms availability and commits a delivery date.",
  },
  {
    id: 4,
    code: "B2",
    name: "Branding",
    lane: "build",
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
    code: "B3",
    name: "Configure",
    lane: "build",
    band: "Automate",
    acquirerRole: "watch",
    /* INGENICO LOADS THE CONFIGURATION. THE AGENT ONLY SPECIFIES IT.
    
       This said the agent "loads the merchant configuration end to end", which
       claimed the entire act and flatly contradicted the step's own handoff two
       panels below: "Deployment team loads settings and injects security keys",
       Ingenico, two working days. The agent derives the parameter set and writes
       it into Ingenico's config store; putting it onto the terminals and
       injecting the keys is the deployment team's work.
    
       "End to end" was the tell. The agent's work stops at handover — which is
       precisely why this step carries a Waiting · Ingenico chip and cannot close
       until they return it. A step that waits on someone cannot also have done
       the thing it is waiting for. */
    blurb: "Agent builds the device profiles and specifies the configuration Ingenico loads.",
    agentMission:
      "Build each device's profile and specify the configuration Ingenico loads onto the terminals.",
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
        // Named for what it does. "Enable schemes" promised the agent widens
        // acceptance by itself; acceptance is the acquirer's commercial call,
        // and Ingenico actions it.
        label: "Read scheme acceptance",
        detail:
          "Lists what the merchant may accept today. Changing it is yours to instruct — Ingenico applies it.",
        output: "scheme.read → live acceptance listed",
      },
      {
        /* Named for the handover, not the load. "Pushes … to each profile" put
           the agent's hands on the terminals; it writes the set into Ingenico's
           config store — the third tool listed on this step — and Ingenico's
           deployment team loads it from there. Same correction as "Read scheme
           acceptance" above: the agent states the position, Ingenico actions it. */
        label: "Publish the configuration",
        detail:
          "Writes MID/TID, tipping and currency into Ingenico's config store. Ingenico's deployment team loads them onto the terminals.",
        // Unrendered fallback — `traceFor` covers all four tasks on this step —
        // but it said `tipping=on, ccy=GBP` while the record below derives
        // tipping from sector and prints "Disabled" for most of them. A dead
        // literal that contradicts the live record is a trap for whoever
        // revives it.
        output: "config.publish → MID/TID, tipping and currency written to the config store",
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
    code: "B4",
    name: "Test",
    lane: "build",
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
    code: "02",
    name: "Ship",
    lane: "spine",
    band: "Automate",
    /* `watch` asserts the step completes without the acquirer, and this one no
       longer does: it is the rejoin, so it is the only step reachable with the
       other lane unfinished, and hardware must not leave over an open file.
       `releases` is the honest role — Ingenico runs every parcel movement and
       the acquirer contributes exactly one thing, permission to go.
    
       Note the release here is GRANTED BY THE CHECKS, not by a click (see
       lib/ship-clearance.ts). The role still belongs to the acquirer because
       it is the acquirer's clearance being given; automation decides when, not
       whose it is. */
    acquirerRole: "releases",
    blurb: "Ingenico ships the kit. You observe — and your clearance is what lets the parcels leave.",
    agentMission: "Get every parcel to the merchant's door, once the file is clear to release.",
    tools: [
      externalTool("Carrier API"),
      ingenicoTool("Label printing"),
      ingenicoTool("Tracking"),
    ],
    tasks: [
      {
        label: "Book the carrier",
        detail: "Selects a carrier and books collection from the warehouse.",
        // Unreachable while the derived trace covers 7.x, but it named a
        // DIFFERENT carrier (DPD) from the one every artefact on this step
        // reports — a fallback that contradicts the thing it stands in for.
        output: "ship.book → carrier=DHL Freight, pickup booked",
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
    /* "Fully automated" was true of the logistics and false of the step: this
       is the rejoin, and nothing leaves the warehouse until both lanes have
       passed. The sentence now separates the two — Ingenico's work is
       automatic, the clearance in front of it is a condition. */
    handback:
      "Ingenico handles the logistics end to end and tracking flows straight back into the journey. Release is automatic once every prior step has passed — until then the parcels stay put.",
  },
  {
    id: 8,
    code: "03",
    name: "Install",
    lane: "spine",
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
    code: "04",
    name: "Go-live",
    lane: "spine",
    band: "Automate",
    // Was "watch". The step now ends on two acquirer-released commits — the
    // CRM write and the merchant notice — so it does not complete unattended,
    // which is precisely what `watch` asserts.
    acquirerRole: "releases",
    blurb: "Agent detects the first live payment and prepares the closing record and notice for your release.",
    agentMission: "Confirm the merchant is live, reconcile to your systems, and put the closing record and notice in front of you.",
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
        // "Pushes … into your systems" / "synced" described a write no control
        // performed. The agent assembles the closing record; releasing it into
        // the system of record is the acquirer's act, on the artefact.
        detail: "Assembles the closing record for your CRM and holds it for you to release.",
        output: "records.writeback → closing record assembled, held for your release",
      },
      {
        label: "Close the loop",
        // The same defect, in its worst instance: this notice leaves the
        // company. "notified" claimed the merchant had already been told.
        detail: "Drafts the go-live notice to you and the merchant, for you to send.",
        output: "notify.golive → notice drafted, awaiting your send",
      },
    ],
    // Was "Fully automated." — on the one step that both writes to the system
    // of record and messages the customer, which made it the least true and
    // most consequential claim in the pipeline.
    handback:
      "Automated up to the two commits: the CRM write and the merchant notice are yours to release.",
  },
]

export function stepById(id: StepId): PipelineStep {
  return PIPELINE.find((s) => s.id === id)!
}

/** The risk lane's state — a verdict AND, when the lane is still open, WHERE.
 *
 *  A bare verdict was enough while the lane was one step. Now it runs
 *  KYC → Pricing → Underwriting, and "in-flight" alone cannot say which of the
 *  three is open: rendering it against all of them would claim three concurrent
 *  checks on a sequential lane. Worse for "referred", where the position IS the
 *  meaning — a sanctions hit at KYC and a credit referral at Underwriting are
 *  different events with different remedies, and painting the whole lane red
 *  would assert that Pricing was also sent back.
 *
 *  So the position rides on the non-cleared arms only. A union rather than an
 *  optional field: `cleared` needs no position (every step is done), and an
 *  optional `at` would let an open lane exist with nowhere to point. */
export type RiskLane =
  | { verdict: "cleared" }
  | { verdict: "in-flight"; at: StepId }
  | { verdict: "referred"; at: StepId }

/** The risk lane in running order.
 *
 *  Order comes from the PIPELINE array, NEVER from `id`: the lane's ids are
 *  10 → 11 → 2, deliberately non-monotonic so that splitting Underwrite in
 *  three kept its id — and with it the artefact cases and fixture events keyed
 *  on it. Any `a.id < b.id` comparison across this lane is therefore wrong. */
export const RISK_LANE: PipelineStep[] = PIPELINE.filter((s) => s.lane === "risk")

/** Position of a risk step within its lane. -1 for anything not on it. */
function riskIndex(id: StepId): number {
  return RISK_LANE.findIndex((s) => s.id === id)
}

/** How far a merchant has got, ON THE LANE THE STEP BELONGS TO.
 *
 *  Replaces the bare `step.id < currentStep` comparison, which could only
 *  describe one line of travel. Under the fork the risk lane advances on its
 *  own clock, so asking `currentStep` about Underwrite would report a file as
 *  finished purely because the kit had moved on — the exact false claim the
 *  parallel model exists to avoid.
 *
 *  Ship (the rejoin) is the one step that answers to both lanes, so it is
 *  reported as reachable only when the build has arrived AND risk has cleared;
 *  see `shipClearance` in lib/ship-clearance.ts for the gate that holds the
 *  shipment when it has not. */
export function laneState(
  merchant: Pick<Merchant, "currentStep" | "riskLane">,
  step: PipelineStep,
  /** Steps completed during this session, on top of the fixture's position.
   *
   *  REQUIRED, and deliberately so. This was optional, on the reasoning that
   *  read-only callers have no session and omitting it is the honest default.
   *  It is not: an omission and "nothing has happened yet" are different
   *  claims, and the default quietly converted the first into the second. The
   *  Ship gate forgot the argument and therefore judged a fully-built file
   *  against the bare fixture, reporting three finished build steps as
   *  outstanding while the rail beside it showed them done.
   *
   *  A surface with genuinely no session passes `NO_SESSION_PROGRESS`, which
   *  says so. */
  progressed: ReadonlySet<StepId>,
  /** Steps carrying an unresolved blocking finding.
   *
   *  REQUIRED, for precisely the reason `progressed` is. The signal already
   *  existed: the journey built a `findingSteps` set — under a comment saying
   *  "positional state alone could never know this" — and wired it to the amber
   *  MARKER while withholding it from this function. So the model that decides
   *  doneness could not see what the agent had found. Branding drew a halt
   *  while Configure and Test, which consume its output, drew ticks, and the
   *  handoff beneath them synthesised "Approved by you · date not recorded".
   *
   *  A default of "nothing is blocked" would let any forgotten call site make
   *  that same confident claim, so surfaces that genuinely cannot evaluate
   *  findings pass `NO_HALTS` and say so. */
  halted: ReadonlySet<StepId>,
  /* A SECOND, NARROWER SET USED TO SIT HERE and has been removed rather than
     left unread, because a parameter that no longer changes an answer is worse
     than none: the next reader would pass it and believe a distinction was
     being honoured.
  
     It carried the ordering rules while `halted` carried the withholding rule,
     on the theory that a FINDING (judged and failed) must veto its successors
     while an UNRESOLVED CHECK (nobody answered) should withhold only its own
     tick. That distinction is real for FAULT and irrelevant for ORDER — "is
     this finished" and "may the next one be called finished" are one question
     about one step — and splitting it let Kessler Automotive draw ticks on
     Pricing and Underwriting beneath an amber KYC, which reads as an acquirer
     that priced and underwrote an entity it never confirmed.
  
     The case that justified the split was a DATA defect wearing the costume of
     a counter-example: Summit's KYC was amber only because the merchant had no
     `underwriting` record and `artifacts.ts` rendered that absence as a failed
     registry check — on a lane whose verdict read `cleared`. When a rule and a
     datum disagree, check whether the datum is true before loosening the
     rule. */
  /** Stages the acquirer has explicitly reset to be shown fresh.
   *
   *  REQUIRED, like the two above and for the same reason: a defaulted empty
   *  set is a confident "nothing was reset", which is exactly the claim that
   *  let the rail tick a stage the cockpit was showing as never run. Callers
   *  with no session pass `NO_SESSION_PROGRESS`, which says so. */
  wasReset: ReadonlySet<StepId>,
): "done" | "active" | "upcoming" {
  /* A BLOCKING FINDING VETOES COMPLETION — on every lane, at any position.
  
     Checked before anything else, because position and session progress are
     both claims about how far the file has TRAVELLED, while a finding is a
     claim about what is TRUE of it. The second has to win: SolMar sits at 03
     Install, so whole-journey order marked every build step done, brand rule or
     not. It must also beat `progressed` specifically — approve the branding,
     then pick a clashing colour, and the approval on file describes a design
     that no longer exists.
  
     "active", not a fourth state and not "upcoming". This mirrors the risk
     lane's own treatment of a referred file a few lines down — stalled work is
     still active work — and the amber marker already separates held from
     working. "upcoming" would be worse than the tick it replaces: it would file
     a step that ran and failed as one that never started. */
  /* THE TRUNK IS TESTED FIRST, ahead of this step's own halt.
  
     Ordering matters here and cost a pass to find. On Orchard Lane, capture is
     halted on an incomplete bundle and R1 KYC carries an unresolved check of
     its own, so `halted` contains both — and this veto returned "active" for
     R1 before any ordering rule ran. The rail showed screening under way on an
     application that had not been assembled.
  
     A step that cannot legitimately have STARTED outranks the question of
     whether it stopped: "not reached yet" is the truer claim, and it keeps the
     alarm on the trunk step where the work actually is. Lane-relative, so it
     applies to the fork's two lanes and never to the trunk itself. */
  if (step.lane !== "spine" && PRE_FORK.some((s) => !isLaneStepDone(merchant, s, progressed, halted))) {
    return "upcoming"
  }

  /* THE WITHHOLDING RULE: an incomplete step draws no tick.
  
     One set now serves both this and the ordering rules, which is the point.
     There was briefly a second, narrower set for ordering, on the theory that
     an unanswered check should withhold a step's own tick without holding the
     lane. It reads plausibly and it is wrong: "is this finished" and "may the
     next one be called finished" are THE SAME QUESTION asked of one step, and
     answering them from two sets is what let R2 and R3 tick under an open R1. */
  if (halted.has(step.id)) return "active"

  /* A RESET STAGE IS NOT DONE EITHER — same reasoning, different claim.
  
     "Reset stage" asserts that this step is being shown for the first time, and
     the cockpit honours it: badge "Ready", "0/4 tasks", "Play agent run". But
     the assertion lived in a ref inside the cockpit, so the rail — reading lane
     position — went on drawing a solid completion tick directly beside it. One
     surface said the step had never run while the other said it was finished.
  
     "upcoming", NOT "active", and this is the one place that differs from the
     halt above. A halted step ran and stopped, so filing it as never-started
     would lose that. A reset step is being shown as though it had not run at
     all, so "upcoming" is precisely the claim being made. */
  if (wasReset.has(step.id)) return "upcoming"

  if (step.lane === "risk") {
    const lane = merchant.riskLane
    const here = riskIndex(step.id)

    // The trunk gate at the top of this function already covers this lane —
    // deliberately hoisted there rather than repeated per branch, since the
    // risk branch returns before `pathOf` and would otherwise need its own copy
    // of a rule that must not be able to differ between lanes.

    /* AN OPEN STEP HOLDS EVERYTHING BEHIND IT ON THIS LANE.
    
       The same rule the build/spine branch below already enforces, which the
       risk lane skipped entirely — and the comment this replaced actually
       STATED the rule ("you cannot price a merchant whose KYC has not run")
       while the code checked only lane POSITION. So a file whose `riskLane.at`
       had moved past an unresolved KYC drew a green tick on Pricing and
       Underwriting underneath an amber KYC: R1 open, R2 and R3 finished. Read
       down the rail it says the acquirer priced and underwrote a merchant
       whose entity was never confirmed.
    
       Position is what the fixture ASSERTS; a finding is what is TRUE. The
       second wins, exactly as it does at the top of this function — the
       difference is that this vetoes the SUCCESSORS rather than the step
       itself.
    
       `upcoming`, not `active`: unlike the halted step, which ran and stopped,
       these have not legitimately been reached. And unlike a halt it draws no
       second alarm — the problem is at R1 and gets marked there once, rather
       than reporting one finding three times down the lane. */
    /* `halted` — THE WIDE SET, restored after a narrowing that reopened the
       exact bug the block above describes.

       That narrowing read `blocking` (findings only) on the argument that an
       unanswered check "settles nothing against the merchant" and so should
       not veto the lane. The distinction is real for FAULT and irrelevant for
       ORDER. This rule is not about blame; it is about completeness, and a
       step with an open question is not complete however innocent the reason.
       Reading down the rail, R2 and R3 ticked under an amber R1 says the
       acquirer priced and underwrote a merchant whose entity was never
       confirmed — which is what a reader saw on Kessler Automotive, and it is
       untrue whether the registry declined or merely never wrote back.

       The case that motivated the narrowing was itself a data bug, not a
       counter-example: Summit's KYC was amber only because the merchant
       carried no `underwriting` record and `artifacts.ts` rendered that
       absence as a failed registry check, on a lane whose verdict said
       `cleared`. A contradiction between a lane verdict and a check on that
       lane is a defect in the check, and the fix belongs there — not in a
       rule loosened to accommodate it. */
    const blockedAt = RISK_LANE.findIndex((s) => halted.has(s.id))
    if (blockedAt !== -1 && here > blockedAt) return "upcoming"

    if (lane.verdict === "cleared") return "done"
    // Compared by LANE POSITION, not by id — see RISK_LANE. The steps ahead of
    // the open one are genuinely finished, and the ones behind it have not
    // started.
    const open = riskIndex(lane.at)
    if (here < open) return "done"
    if (progressed.has(step.id)) return "done"
    // A referred file is emphatically NOT done — it is active work that has
    // stalled, and collapsing it into "done" would file a rejection alongside
    // an approval.
    if (here === open) return "active"
    return "upcoming"
  }

  /* BUILD AND SPINE, BY LANE POSITION — never `step.id < currentStep`.
  
     That comparison was two bugs at once. It ranked steps by id across lanes
     that do not share a line of travel, so a merchant sitting at 01 (id 1) had
     every build step read `id > 1` = "upcoming", yet nothing distinguished B4
     from B1 and the cockpit let you start the last one first. And it consulted
     only the fixture, so completing a step changed nothing at all: `currentStep`
     is never written in this app, which is why an approved B1 kept reporting
     itself as unfinished.

     `progressed` IS NOT CONSULTED DIRECTLY HERE, and that omission is the fix
     for the second half of the halt bug. This used to open with
     `if (progressed.has(step.id)) return "done"`, which returned before the
     lane order below was ever computed — so a step approved earlier in the
     session kept its tick no matter what had since failed UPSTREAM of it. The
     veto at the top of this function only protects the halted step itself, so
     Branding drew its halt while Configure and Test, approved moments earlier
     by the same agent run, sat beneath it still ticked.

     Session progress is still honoured — `isLaneStepDone` consults it — but it
     now goes through the lane-order gate like every other claim, so a halted
     predecessor demotes its successors to `upcoming`. Removing the shortcut
     also removes the duplicate rule: doneness is decided in ONE place. */

  /* The spine picks up the build lane in front of it. Ship is the rejoin, so
     the steps the file must pass to REACH it include all four build steps —
     evaluating the spine on its own reported Ship as active while B1 Order was
     still outstanding, inviting a dispatch for a terminal nobody had ordered.
     (The risk lane is deliberately absent: it runs concurrently and is
     enforced at Ship by `shipClearance`, which can say WHICH risk step is
     open. Folding it in here would only make Ship `upcoming`, which reads as
     "not your turn yet" rather than "held".) */
  // Via `pathOf`, so this and `blockingPredecessor` cannot come to disagree
  // about which path a step travels — the risk branch above has returned.
  const lane = pathOf(step)
  const here = lane.findIndex((s) => s.id === step.id)

  /* The first step on this lane that is not yet finished. A step is `active`
     only if it IS that step — so B4 stays `upcoming` while B1 is outstanding,
     which is what stops you starting at the end of the lane. */
  // `halted`, the wide set — same correction as the risk branch above, for the
  // same reason: an open question on a predecessor makes it incomplete, and a
  // tick behind an incomplete step claims a sequence that did not happen.
  const openIdx = lane.findIndex((s) => !isLaneStepDone(merchant, s, progressed, halted))
  if (openIdx === -1) return "done"
  if (here < openIdx) return "done"
  if (here === openIdx) return "active"
  return "upcoming"
}

/**
 * Pass this when a surface has no session to consult — estate rollups, the
 * portfolio table, anything reading the book rather than driving one file.
 *
 * Named for what it MEANS rather than for being empty, because it is passed
 * explicitly at every such call site: `laneState` used to default to it, and a
 * default turned every forgotten argument into the confident claim that
 * nothing had progressed. That is precisely how the Ship gate came to list
 * three build steps as unfinished on a file whose rail showed them all ticked.
 */
export const NO_SESSION_PROGRESS: ReadonlySet<StepId> = new Set()

/**
 * Pass this where findings genuinely cannot be evaluated.
 *
 * A blocking finding is computed in `lib/artifacts.ts`, which imports THIS
 * module — so `laneState` cannot reach it without a cycle, and the set has to
 * arrive from the caller. Book-level surfaces are the honest users: the brand
 * rule is measured against the theme held in session, and a rollup reading the
 * estate has no session to measure.
 *
 * Named for what it MEANS, like `NO_SESSION_PROGRESS`, and for the same reason:
 * this is a real gap in what the caller can see, not a statement that the file
 * is clean. Anywhere the caller CAN evaluate findings — the journey, the ship
 * gate — must pass the real set, or it re-opens exactly the bug this parameter
 * was added to close.
 */
export const NO_HALTS: ReadonlySet<StepId> = new Set()

/** Whether a step on the build/spine path counts as finished.
 *
 *  Split out because `laneState` needs it while it is still computing its own
 *  answer, and calling itself would recurse. Deliberately NOT a second opinion
 *  about doneness: it applies the same two rules — the fixture's position, and
 *  what this session has completed. */
function isLaneStepDone(
  merchant: Pick<Merchant, "currentStep" | "riskLane">,
  step: PipelineStep,
  progressed: ReadonlySet<StepId>,
  /** `laneState`'s `halted` — every step with something open on it, whether a
   *  judged finding or a check nobody answered.
   *
   *  This doc previously said the opposite ("never the wider `halted`"), from
   *  the period when ordering ran off a narrower set. Both sets are the same
   *  set again: this function answers "is this step finished", and an open
   *  question means no regardless of who left it open. */
  halted: ReadonlySet<StepId>,
): boolean {
  /* THE SAME VETO, AND THIS IS THE HALF THAT REACHES THE SUCCESSORS.
  
     `laneState` returning "active" for Branding fixes only Branding. What made
     Configure and Test draw ticks is this function: it is what `openIdx`
     consults to find the first unfinished step on the lane, so until a halt
     counts as unfinished HERE, the open index runs straight past Branding and
     everything behind it reports done. With the veto, `openIdx` stops at the
     halted step and its successors fall out as "upcoming" — which is the
     truth. Configure and Test consume a device theme that was never approved.
  
     Before `progressed`, deliberately: a step approved earlier in the session
     and broken since is not done, and checking progress first would let the
     stale approval win. */
  if (halted.has(step.id)) return false

  if (progressed.has(step.id)) return true

  const cur = PIPELINE.find((s) => s.id === merchant.currentStep)
  if (!cur) return false

  /* CROSS-LANE POSITION. `currentStep` names ONE place, but the build and
     spine paths run in sequence around the fork, so "am I past this step"
     often has to be answered about a different lane from the one the merchant
     is standing on. Comparing only within a matching lane got two things
     wrong, both caught by probing every fixture rather than reasoning about
     it: 01 Capture reported `active` for merchants long past it, and SolMar —
     sitting at 03 Install — reported B1 Order as still active while its
     terminals were on site.
  
     Whole-journey order is the honest comparison, taken from the PIPELINE
     array so it survives any lane being reordered. */
  const orderOf = (id: StepId) => PIPELINE.findIndex((s) => s.id === id)
  const at = orderOf(cur.id)
  const here = orderOf(step.id)

  /* Anything BEFORE the fork is finished once the merchant is past it. Beyond
     the fork the two lanes are genuinely concurrent, so a merchant on the
     build lane says nothing about the risk lane — that is `riskLane`'s job,
     handled above, and this function is never asked about a risk step. */
  return here < at
}

/**
 * Has the agent actually run here — that is, do this step's artefacts exist?
 *
 * THE MISSING PRECONDITION ON EVERY FINDING. The brand rules are pure functions
 * of a theme, so they returned a verdict for a step the agent had never
 * touched: Nordwind sat at B2 reading "Ready · 0/4 tasks · Play agent run" with
 * an Exception badge in the header and the artefact pane saying, in as many
 * words, "this task has not run yet". A check that never ran cannot have found
 * anything, and a status derived from one is an accusation with no evidence
 * behind it.
 *
 * DELIBERATELY NOT `progressed`. Completion excludes failure — `stepFinished`
 * is `!blocker && …`, so a halted run never records progress — which means
 * gating findings on progress deadlocks: no finding until the step passes, and
 * no pass because of the finding. `played` is the honest signal because it is
 * written when the run STARTS.
 *
 * `halted` is deliberately absent from the signature. Whether a run happened is
 * a question about the past; whether it found something is a question about the
 * result. Taking `halted` here would be the cycle: findings would depend on
 * evidence which depended on findings.
 */
export function stepEvidenced(
  merchant: Pick<Merchant, "currentStep" | "riskLane">,
  step: PipelineStep,
  /** Steps whose run has been played this session. REQUIRED — a default of
   *  "none played" reads as the confident claim that the agent has done
   *  nothing, which on a settled file is false. Surfaces with no session pass
   *  `NO_SESSION_PROGRESS`. */
  played: ReadonlySet<StepId>,
): boolean {
  if (played.has(step.id)) return true

  if (step.lane === "risk") {
    const lane = merchant.riskLane
    // A cleared lane ran every one of its steps to get there.
    if (lane.verdict === "cleared") return true
    // Steps AHEAD of the open one on the risk lane have run; the open one and
    // everything behind it have not. Same lane-position comparison `laneState`
    // uses, never an id comparison.
    return riskIndex(step.id) < riskIndex(lane.at)
  }

  // Whole-journey order, from the PIPELINE array. A step the file has travelled
  // past has necessarily run; the step it is standing on has not, unless the
  // record says otherwise (see `blockingFinding`, where an authored exception
  // is itself the record of a run).
  const orderOf = (id: StepId) => PIPELINE.findIndex((s) => s.id === id)
  return orderOf(step.id) < orderOf(merchant.currentStep)
}

/** The build and spine paths in running order — same reason as RISK_LANE:
 *  position comes from the PIPELINE array, never from `id`. */
export const BUILD_LANE: PipelineStep[] = PIPELINE.filter((s) => s.lane === "build")
export const SPINE_LANE: PipelineStep[] = PIPELINE.filter((s) => s.lane === "spine")



/** The first spine step after the fork — where the lanes meet again.
 *
 *  Derived, not written down as `7`: the rejoin is a property of the lane
 *  layout, and a hardcoded id would quietly point at the wrong step the moment
 *  a lane gained or lost one. */
export const REJOIN_STEP: StepId = (() => {
  // By ARRAY POSITION, not by id. The old version compared ids, which only
  // worked while they happened to ascend; the risk lane now runs 10 → 11 → 2,
  // so "the first spine step with a bigger id than the fork" is meaningless.
  const forkAt = PIPELINE.findIndex((s) => s.lane !== "spine")
  return PIPELINE.slice(forkAt).find((s) => s.lane === "spine")!.id
})()

/** Everything a file must pass to travel the spine, in order.
 *
 *  The spine is NOT one unbroken run: 01 Capture sits BEFORE the fork and is
 *  what starts the build, while Ship onwards sit AFTER it and cannot begin
 *  until the build lane has finished. Splicing the build lane in at the rejoin
 *  states that once, here, so `laneState` never has to re-derive it.
 *
 *  Declared below REJOIN_STEP deliberately — it reads it at module-init, and
 *  above it that is a temporal dead zone, i.e. a crash on import.
 *
 *  Prefixing the build lane to the WHOLE spine was wrong in a way that looked
 *  right across all 19 fixtures: it put 01 behind the four steps it precedes,
 *  so every merchant past capture reported it as still upcoming. The risk lane
 *  is deliberately excluded — it runs concurrently, and is enforced at Ship by
 *  `shipClearance`, which can name which risk step is open. */
export const SPINE_PATH: PipelineStep[] = (() => {
  const rejoinAt = SPINE_LANE.findIndex((s) => s.id === REJOIN_STEP)
  return [...SPINE_LANE.slice(0, rejoinAt), ...BUILD_LANE, ...SPINE_LANE.slice(rejoinAt)]
})()

/** The path a step travels on — the same three definitions `laneState` uses,
 *  named once so a caller cannot pick a different one and disagree with it. */
/**
 * The spine steps BEFORE the fork — the trunk both lanes descend from.
 *
 * Derived from the same `rejoinAt` index `SPINE_PATH` uses, so the three paths
 * cannot come to disagree about where the fork opens.
 */
export const PRE_FORK: PipelineStep[] = SPINE_LANE.slice(
  0,
  SPINE_LANE.findIndex((s) => s.id === REJOIN_STEP),
).filter((s) => !BUILD_LANE.some((b) => b.id === s.id))

/** The risk lane WITH the trunk in front of it. */
export const RISK_PATH: PipelineStep[] = [...PRE_FORK, ...RISK_LANE]

/** The build lane WITH the trunk in front of it. */
export const BUILD_PATH: PipelineStep[] = [...PRE_FORK, ...BUILD_LANE]

/**
 * A step's full line of travel, from the start of the journey.
 *
 * THE LANES USED TO BEGIN AT THE FORK. `SPINE_PATH` correctly prefixed capture,
 * but `RISK_LANE` and `BUILD_LANE` started at R1 and B1, so neither lane could
 * see the trunk step feeding it. Orchard Lane Veterinary sat at 0/11 steps with
 * capture halted on an incomplete document bundle, and the rail drew R1 KYC and
 * B1 Order as live work directly beneath it — screening and an equipment order
 * running against an application that had not been assembled yet.
 *
 * A fork does not start until the step above it finishes, so both lanes now
 * carry that step and every ordering rule downstream picks it up for free —
 * including `blockingPredecessor`, which can now NAME capture as the thing a
 * lane head is waiting on.
 */
export function pathOf(step: PipelineStep): PipelineStep[] {
  if (step.lane === "risk") return RISK_PATH
  if (step.lane === "build") return BUILD_PATH
  return SPINE_PATH
}

/**
 * The earliest step still outstanding in front of `step`, or null when it is
 * reachable now.
 *
 * Exists so a refusal can NAME what it is waiting for. "Not yet" on its own
 * leaves the reader to guess which of eight steps is holding them up, and a
 * control that cannot say why it is disabled is indistinguishable from one
 * that is broken.
 *
 * Derived from `laneState` rather than re-deriving order, so the rail's
 * "upcoming" and this explanation always agree about the reason.
 */
export function blockingPredecessor(
  merchant: Pick<Merchant, "currentStep" | "riskLane">,
  step: PipelineStep,
  progressed: ReadonlySet<StepId>,
  /** Threaded through for the same reason the caller needs it: a halted step is
   *  the most likely thing to be holding a successor up, and without this the
   *  scan would walk straight past it and report "nothing is blocking you" to a
   *  step that cannot in fact start. */
  halted: ReadonlySet<StepId>,
  /* A SECOND SET WAS THREADED HERE and is gone with the one it mirrored on
     `laneState`. The hazard it guarded against is worth keeping in view: this
     function decides whether a run may START and the rail decides whether to
     RECORD it, so if the two are ever handed different sets they will disagree
     about one file — the gate opened R3 Underwriting and the rail then refused
     to tick it. One set, passed once, is what makes that disagreement
     unrepresentable rather than merely unlikely. */
  /** Threaded through for the same reason again: a reset step reads as
   *  "upcoming", so without this the scan would judge it against a stale
   *  doneness and could name the wrong blocker — or none. */
  wasReset: ReadonlySet<StepId>,
): PipelineStep | null {
  if (laneState(merchant, step, progressed, halted, wasReset) !== "upcoming") return null
  const path = pathOf(step)
  const here = path.findIndex((s) => s.id === step.id)
  for (let i = 0; i < here; i++) {
    if (laneState(merchant, path[i], progressed, halted, wasReset) !== "done") return path[i]
  }
  return null
}

/**
 * WHICH STEP TO OPEN A FILE ON.
 *
 * `merchant.currentStep` records where the file's ATTENTION sits, and that is
 * frequently not a step anyone can act on. Orchard Lane records R3
 * Underwriting because underwriting is what the missing documents are holding
 * up — but nothing on that file has run, and R3 cannot start until 01 Merchant
 * capture has the documents. Opening there put the reader in front of a step
 * badged "Not started", a disabled run control, and an empty artefact pane
 * reading "This task has not run yet", with the actual outstanding work three
 * steps behind them and no indication they were in the wrong place.
 *
 * WHERE A CONSEQUENCE IS REPORTED IS NOT WHERE THE WORK IS. The exception is
 * legitimately recorded against underwriting; the thing to do about it lives at
 * capture. A landing rule has to resolve to the second.
 *
 * The app already knew this and did not act on it — the same
 * `blockingPredecessor` call that renders "Waiting on 01" on the disabled run
 * button was sitting one screen away from the decision about where to put the
 * reader. That is the recurring shape here: a value computed, rendered, and
 * then not consumed at the one point where it would have changed what someone
 * saw.
 *
 * Returns `currentStep` untouched whenever it is reachable, so this only ever
 * moves a reader OFF a step they could not have used.
 */
export function openingStep(
  merchant: Pick<Merchant, "currentStep" | "riskLane">,
  halted: ReadonlySet<StepId>,
): StepId {
  const recorded = PIPELINE.find((s) => s.id === merchant.currentStep)
  if (!recorded) return merchant.currentStep
  const blocker = blockingPredecessor(
    merchant,
    recorded,
    NO_SESSION_PROGRESS,
    halted,
    NO_SESSION_PROGRESS,
  )
  return blocker ? blocker.id : merchant.currentStep
}

/* `shipRisk` lived here. It warned and allowed the run anyway, and it read
 * ONLY `riskLane` — so a rejected order or a failed terminal configuration on
 * the build lane could not hold a shipment back at all.
 *
 * Superseded by `shipClearance` in `lib/ship-clearance.ts`: a hard gate
 * derived from every prerequisite on BOTH lanes. Deleted rather than left
 * beside it, because two functions answering "may this ship?" is precisely
 * the second source that drifts, and the weaker one would go on being
 * called. */

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
  // The merchant acts on this timeline too — supplying documents is an event
  // the file records. Without them here an inbound arrival had to be
  // attributed to the Agent, crediting the agent with the merchant's own act.
  actor: "Agent" | "Acquirer" | "Merchant"
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
  /** Position on the BUILD/SPINE path only — not on the risk lane.
   *
   *  Before the fork this was the whole journey, so "past step 2" implied
   *  underwriting had cleared. It no longer does: a merchant can be at B3
   *  Configure with their file still open. Read `riskLane` for that. */
  currentStep: StepId
  /** Where the risk lane has got to, independently of the build.
   *
   *  REQUIRED, and deliberately without a default. The old model only carried
   *  `underwriting` on merchants parked at step 2 because position implied the
   *  verdict; once the lanes run in parallel that inference is gone. A default
   *  of "cleared" would assert an approval nobody gave, on precisely the
   *  merchants whose file was never opened. */
  riskLane: RiskLane
  /**
   * The band colour this merchant's branding was signed off against — the one
   * physically on their terminals.
   *
   * REQUIRED AND NULLABLE, no default, for the same reason as `riskLane`.
   * `null` means branding has not been approved yet, which is a DIFFERENT claim
   * from "approved against the current design". An optional field would let a
   * fixture omit it and be silently read as matching whatever the studio happens
   * to be showing.
   *
   * This exists because the brand rules are evaluated against the LIVE studio
   * theme and nothing recorded what a merchant had actually been approved on. So
   * one swatch change retroactively put merchants into breach on a step they had
   * passed weeks earlier — three of them with terminals installed and taking
   * payments. A check with no "as at" cannot tell "this design is not allowed"
   * apart from "this design is not the one we shipped".
   */
  brandingApprovedAgainst: string | null
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
    // Its timeline already records identity verified and a risk score, so the
    // lane is past KYC and Pricing and sitting on the credit decision.
    riskLane: { verdict: "in-flight", at: 2 },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "in-flight", at: 2 },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#00736D",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#2B2F77",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#12456B",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#3C3C3C",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#7A1E2B",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#1F6F4A",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#2B2F77",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#4A4A4A",
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
    // Intake three hours ago — screening has only just opened.
    riskLane: { verdict: "in-flight", at: 10 },
    brandingApprovedAgainst: null,
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
    // A small, clean file: screening cleared automatically, so the lane has
    // moved on to the commercial terms while the kit is still being confirmed.
    // This is the one fixture sitting at Pricing — without it the middle step
    // of the lane is never seen in an active state.
    riskLane: { verdict: "in-flight", at: 11 },
    brandingApprovedAgainst: null,
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
    // Referred on CREDIT, not compliance — the position is the point. Veterinary
    // work carries deferred-payment exposure, which is a limit question, and
    // sending the reader to KYC would be the wrong screen and the wrong remedy.
    riskLane: { verdict: "referred", at: 2 },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: null,
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#4A4A4A",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#4A4A4A",
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
    riskLane: { verdict: "cleared" },
    brandingApprovedAgainst: "#4A4A4A",
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
