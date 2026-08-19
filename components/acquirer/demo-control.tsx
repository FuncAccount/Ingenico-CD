"use client"

// The presenter's lever.
//
// Deliberately OFF-THEME: mono type, hazard stripes, a colour that appears
// nowhere else in the product. The app is a walkthrough of a regulated
// process, and the most damaging thing a walkthrough can do is leave the room
// unsure which parts were the system and which were the presenter. A control
// that forges evidence must therefore be unmistakably not part of the
// interface it is acting on — if it were styled like the product, the
// simulated document would be indistinguishable from a real one.

import { FlaskConical, Undo2 } from "lucide-react"
import type { Merchant } from "@/lib/acquirer-data"
import { useDemo } from "@/components/acquirer/demo-provider"

/**
 * A small off-theme trigger for "pretend the outside world replied".
 *
 * Shares the purple/mono treatment with the panel above so that everything
 * fabricated in a walkthrough reads as one family, distinct from the product.
 */
export function DemoInbound({ label, onTrigger }: { label: string; onTrigger: () => void }) {
  return (
    <button
      type="button"
      onClick={onTrigger}
      className="inline-flex items-center gap-1.5 self-start rounded border border-dashed border-[#8b5cf6]/70 bg-[#8b5cf6]/[0.06] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#6d28d9] transition-colors hover:bg-[#8b5cf6]/15"
    >
      <FlaskConical className="h-3 w-3" />
      {label}
    </button>
  )
}

export function DemoSupplyDocuments({ merchant }: { merchant: Merchant }) {
  const { documentsArrived, supplyDocuments, resetDocuments } = useDemo()
  const arrived = Boolean(documentsArrived[merchant.id])
  const outstanding = merchant.underwriting?.documentsOutstanding?.length ?? 0

  // Nothing to simulate on a file with no gap, and nothing to undo on a file
  // that was never simulated. Rendering the panel anyway would put a lever in
  // front of the audience that does nothing when pulled.
  if (!arrived && outstanding === 0) return null

  return (
    <div
      className="mt-3 rounded-md border border-dashed border-[#8b5cf6]/60 bg-[#8b5cf6]/[0.06] p-3"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 8px, rgba(139,92,246,0.07) 8px 16px)",
      }}
    >
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#7c3aed]">
        <FlaskConical className="h-3 w-3" />
        Demo control — not part of the product
      </p>

      {arrived ? (
        <>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[#6d28d9]">
            Documents were simulated as received. The score, the sign-off gate and the timeline are
            all reacting to that simulated arrival.
          </p>
          <button
            type="button"
            onClick={() => resetDocuments(merchant.id)}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded border border-[#8b5cf6]/60 bg-white px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#6d28d9] transition-colors hover:bg-[#8b5cf6]/10"
          >
            <Undo2 className="h-3 w-3" />
            Undo — put the file back to incomplete
          </button>
        </>
      ) : (
        <>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[#6d28d9]">
            {`Pretend the merchant replied and attached ${
              outstanding === 1 ? "the outstanding document" : `all ${outstanding} outstanding documents`
            }. Fabricates evidence so the walkthrough can continue past the stop.`}
          </p>
          <button
            type="button"
            onClick={() => supplyDocuments(merchant.id)}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded border border-[#8b5cf6] bg-[#7c3aed] px-2.5 py-1.5 font-mono text-[11px] font-bold text-white transition-colors hover:bg-[#6d28d9]"
          >
            <FlaskConical className="h-3 w-3" />
            Simulate documents received
          </button>
        </>
      )}
    </div>
  )
}
