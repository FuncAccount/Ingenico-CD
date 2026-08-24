/**
 * Does every merchant's underwriting record agree with where that merchant has
 * got to?
 *
 * The defect this exists to catch: a file shown as approved, shipped or live
 * while its risk category and acceptance limit read "not on file". Those two
 * cannot both be true — nothing can have passed a regulated sign-off without a
 * limit behind it — and the screen resolves the disagreement by proceeding,
 * which is the worst of the three options.
 */
import { ALL_JOURNEYS } from "@/lib/estate"
import {
  recordedScore,
  outstandingDocuments,
  riskAssessment,
  acceptanceLimit,
  DEFERRED_DELIVERY,
  UNDERWRITING_STEP,
} from "@/lib/underwriting"
import { RISK_LANE } from "@/lib/acquirer-data"
import { artifactFor } from "@/lib/artifacts"

const merchantIsDeferred = (sector: string) => Boolean(DEFERRED_DELIVERY[sector])

const fails: string[] = []
const notes: string[] = []
let checks = 0

function check(cond: boolean, msg: string) {
  checks++
  if (!cond) fails.push(msg)
}

// Where each risk step sits in lane order. Ids are NOT ordered on this lane
// (10 → 11 → 2), so position must come from the array, never a comparison.
const laneOrder = new Map(RISK_LANE.map((s, i) => [s.id, i]))
const uwIndex = laneOrder.get(UNDERWRITING_STEP)!

console.log(`Merchants: ${ALL_JOURNEYS.length}\n`)
console.log(
  ["merchant", "step", "lane verdict", "score", "docs out", "scoreable"].join(" | "),
)
console.log("-".repeat(96))

for (const m of ALL_JOURNEYS) {
  const score = recordedScore(m)
  const out = outstandingDocuments(m)
  const a = riskAssessment(m)
  const verdict = m.riskLane?.verdict ?? "(none)"
  const atIdx = m.riskLane && "at" in m.riskLane ? laneOrder.get(m.riskLane.at) : undefined

  console.log(
    [
      m.name.padEnd(28),
      String(m.currentStep).padStart(4),
      String(verdict).padEnd(12),
      score === null ? "  null" : String(score).padStart(6),
      String(out.length).padStart(8),
      String(a.scoreable).padEnd(9),
    ].join(" | "),
  )

  /* 1. A cleared risk lane means underwriting returned a decision, and a
        decision has a limit behind it.

        This deliberately asks whether the file is SCOREABLE, not whether a
        number was typed into the record. `recordedScore` is the score noted at
        sign-off, used to reconcile the factor breakdown; its absence is normal
        and is not a defect. Asserting on it was how the original version of
        this audit described the bug rather than the invariant. */
  if (verdict === "cleared") {
    check(
      !acceptanceLimit(m).unscored,
      `${m.name}: risk lane CLEARED but the file is unscoreable — the limit panel would read "not on file" on an approved merchant`,
    )
    check(
      out.length === 0,
      `${m.name}: risk lane CLEARED but ${out.length} document(s) still outstanding`,
    )
  }

  /* 2. Anything shipped, installed or live has, by definition, been
        underwritten, so it must carry a category and a limit. */
  if (m.currentStep >= 7) {
    const L = acceptanceLimit(m)
    check(
      L.category.value !== null && L.dailyLimit.value !== null,
      `${m.name}: at step ${m.currentStep} (terminals shipped or live) with no category or limit on file`,
    )
  }

  /* 3. Outstanding documents and a score are mutually exclusive by design —
        the file is unscoreable until the bundle is complete. */
  if (out.length > 0) {
    check(score === null, `${m.name}: has ${out.length} outstanding document(s) AND a score of ${score}`)
    check(!a.scoreable, `${m.name}: documents outstanding but assessment reports scoreable`)
  }

  /* 4. A referral is positioned. An unpositioned referral cannot say which
        step is open. */
  if (verdict === "referred") {
    check(atIdx !== undefined, `${m.name}: referred but no resolvable lane position`)
  }

  if (acceptanceLimit(m).unscored) {
    notes.push(`${m.name}: unscoreable — panel withholds category + daily limit (${out.length} document(s) outstanding)`)
  }
}

/* ---------------------------------------------- what the limit panel renders */

console.log("\n--- acceptance panel, as rendered ---")
console.log(["merchant", "category", "daily limit", "fuller review"].join(" | "))
console.log("-".repeat(96))

for (const m of ALL_JOURNEYS) {
  const L = acceptanceLimit(m)
  const a = riskAssessment(m)
  console.log(
    [
      m.name.padEnd(26),
      (L.category.value ?? "— withheld").padEnd(20),
      (L.dailyLimit.value ?? "— withheld").padEnd(16),
      L.fullerReview.value ?? "—",
    ].join(" | "),
  )

  /* 5. Withholding happens for exactly one reason, and it is the same reason
        the halt banner and the sign-off gate use. */
  check(
    L.unscored === Boolean(a.blocked),
    `${m.name}: panel withholding (${L.unscored}) disagrees with the assessment block (${Boolean(a.blocked)})`,
  )

  /* 6. Category and limit travel together — a category with no limit, or a
        limit with no category, is half an answer. */
  check(
    (L.category.value === null) === (L.dailyLimit.value === null),
    `${m.name}: category and daily limit disagree about whether this file is scored`,
  )

  /* 7. A withheld value must still say why. A blank row is unreadable. */
  for (const [name, row] of Object.entries(L)) {
    if (name === "unscored") continue
    const r = row as { value: string | null; source: string }
    check(r.source.trim().length > 0, `${m.name}: ${name} has no source note`)
    if (r.value === null) {
      check(/cannot|no limit|could not/i.test(r.source), `${m.name}: ${name} withheld without saying why`)
    }
  }

  /* 8. The deferred-delivery answer must match the policy list, and must be
        answerable even when the file cannot be scored. */
  const shouldDefer = merchantIsDeferred(m.sector)
  check(
    L.fullerReview.value !== null,
    `${m.name}: fuller-review row withheld — this test reads the trade, which is always known`,
  )
  check(
    L.fullerReview.value!.startsWith("Yes") === shouldDefer,
    `${m.name}: sector ${m.sector} deferred=${shouldDefer} but panel says "${L.fullerReview.value}"`,
  )

  /* 9. A scored file must quote its own score in the category source, so the
        panel and the sign-off screen cannot drift apart. */
  if (!L.unscored) {
    check(
      L.category.source.includes(String(a.score)),
      `${m.name}: category source does not cite the score it was derived from`,
    )
  }
}

/* -------------------------------- false absences on the go-live write-back */

/* 10. A row must not report a gap for a figure the record already holds.
       Tested through the real artefact rather than a copy of its parsing rule,
       so this checks what the reader is actually shown. */
console.log("\n--- go-live write-back: onboarding duration ---")
for (const m of ALL_JOURNEYS) {
  const art = artifactFor(9, 2, m)
  if (!art || art.kind !== "records") continue
  const row = art.rows.find((r) => r.label === "Onboarding duration")
  if (!row) continue
  const holdsTimestamp = /\d+\s+(hour|day)s?\s+ago/.test(m.submitted)
  check(
    !(holdsTimestamp && row.value === null),
    `${m.name}: submitted "${m.submitted}" is on the record, but the write-back reports the duration as absent`,
  )
  if (m.currentStep >= 9) console.log(`  ${m.name.padEnd(26)} ${row.value ?? "— withheld"}`)
}

console.log("\n--- unscored files (limit panel withholds) ---")
notes.forEach((n) => console.log("  " + n))

console.log(`\n${checks} checks, ${fails.length} failures`)
fails.forEach((f) => console.log("  FAIL  " + f))

/* A probe that cannot fail proves nothing. Each of these reintroduces one of
   the defects this audit exists to catch, and must be reported. */
console.log("\n--- must-fail probes ---")

// (a) The original bug: a merchant live in the estate whose file cannot be
//     scored, so the panel reports "not on file" on a trading merchant.
const live = ALL_JOURNEYS.find((m) => m.currentStep >= 7)!
const unscoreable = {
  ...live,
  underwriting: { ...live.underwriting, documentsOutstanding: ["Bank statement"] },
}
const brokenLimit = acceptanceLimit(unscoreable as never)
console.log(
  brokenLimit.category.value === null && brokenLimit.unscored
    ? `  OK: ${live.name} forced unscoreable → category withheld, so check 2 would fire`
    : "  BROKEN HARNESS: a live merchant with a missing document still reported a category",
)

// (b) The self-contradiction in the screenshot: a category-derived verdict
//     answered confidently while the category itself is withheld.
console.log(
  brokenLimit.fullerReview.value !== null
    ? `  OK: fuller review still answered ("${brokenLimit.fullerReview.value}") from the trade, not the withheld category`
    : "  BROKEN HARNESS: fuller review withheld — it reads the sector, which is always known",
)

// (c) The false-absence check must be able to see a false absence: feed the
//     write-back a record whose timestamp will not parse and confirm the row
//     withholds, which is the only state check 10 permits.
const noStamp = artifactFor(9, 2, { ...live, submitted: "recently" } as never)
const noStampRow =
  noStamp && noStamp.kind === "records"
    ? noStamp.rows.find((r) => r.label === "Onboarding duration")
    : undefined
console.log(
  noStampRow && noStampRow.value === null && /could not be read/.test(noStampRow.source)
    ? "  OK: an unparseable timestamp withholds the duration and names why"
    : `  BROKEN HARNESS: expected a withheld duration, got "${noStampRow?.value}"`,
)

// (d) The deferred-delivery list must actually discriminate. If every sector
//     answered the same way, check 8 would pass vacuously.
const answers = new Set(ALL_JOURNEYS.map((m) => acceptanceLimit(m).fullerReview.value!.startsWith("Yes")))
console.log(
  answers.size === 2
    ? "  OK: the deferred-delivery test returns both Yes and No across the book"
    : "  BROKEN HARNESS: every merchant gets the same fuller-review answer — check 8 is vacuous",
)
