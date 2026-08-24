"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { MERCHANTS, type Merchant } from "@/lib/acquirer-data"
import { defaultBasket, summariseOrder } from "@/lib/artifacts"
import { createMerchant, type MerchantDraft } from "@/lib/new-merchant"
import type { OrderDraft } from "@/components/acquirer/artifact-inspector"

/**
 * The merchant book, and the order against each merchant.
 *
 * WHY THIS EXISTS, when the app already has four providers.
 *
 * Two bugs with one cause. `MERCHANTS` is a frozen module constant imported
 * directly by eight files, so "submit a merchant" had nowhere to write and the
 * form simply discarded what you typed — the success screen's "View in
 * portfolio" led to a portfolio that had never heard of it. And the order
 * draft (the devices) lived in `useState` INSIDE `MerchantJourney`, so opening
 * the sign-off screen unmounted the component holding your edit and sign-off
 * recomputed the kit from the fixture: the old device count, exactly as
 * reported.
 *
 * `ProgressProvider` already names this rule for its own state — "a record of
 * completed work cannot live in a component that the act of completing the work
 * unmounts". The order is the same kind of fact. It is the acquirer's own
 * decision about what the merchant gets, it is read by at least four screens,
 * and it was being destroyed by the navigation to the screen that approves it.
 *
 * WHY THE BOOK AND THE ORDER SIT TOGETHER, rather than as a fifth and sixth
 * provider. Decisions, progress and brand are separate because they are
 * separate CLAIMS about a merchant. These two are not: the order is part of the
 * merchant's file, and `merchants` below is only correct BECAUSE it reads the
 * orders — a merchant whose basket has been edited must report the edited kit
 * everywhere, or we are back to two numbers for one thing.
 */

/** The order as it stands, defaults included. Shared by the basket, stock,
 *  delivery and pricing artefacts, so changing a quantity moves every
 *  downstream figure. */
export function defaultOrder(merchant: Merchant): OrderDraft {
  return { lines: defaultBasket(merchant), serviceId: "standard", requestedIso: null }
}

interface BookContextValue {
  /**
   * Every merchant in the acquirer's book — fixtures plus anything submitted
   * this session — with each one's kit reconciled against its live order.
   *
   * This is the ONLY merchant list any acquirer screen should read. Importing
   * `MERCHANTS` directly is what let a screen show a book that predates both
   * the submission and the edit.
   */
  merchants: Merchant[]
  /** Record a submission. Returns the created merchant so the caller can open
   *  it without re-finding it by name. */
  submit: (draft: MerchantDraft) => Merchant
  /** The live order for a merchant, falling back to the kit on their file. */
  orderFor: (merchant: Merchant) => OrderDraft
  /** Takes the MERCHANT, not an id: the first edit has to be seeded from that
   *  merchant's own default, and a submitted merchant is not in `MERCHANTS` to
   *  be looked up — an id-only signature silently no-opped for exactly the
   *  merchants this provider was added to support. */
  setOrder: (merchant: Merchant, next: OrderDraft | ((prev: OrderDraft) => OrderDraft)) => void
  /** Drop the override, so the stage returns to "nobody has touched this". */
  resetOrder: (merchantId: string) => void
  /** Whether an override exists at all. Asked of the provider so "edited" has
   *  ONE definition, rather than a structural comparison at each call site that
   *  could drift from the one the reset performs. */
  orderEdited: (merchantId: string) => boolean
}

/** No default value, for the reason the other providers give: a screen mounted
 *  outside the provider would read an empty book, which does not render as an
 *  error — it renders as an acquirer with no merchants. */
const BookContext = createContext<BookContextValue | null>(null)

export function BookProvider({ children }: { children: React.ReactNode }) {
  const [submitted, setSubmitted] = useState<Merchant[]>([])
  const [orders, setOrders] = useState<Record<string, OrderDraft>>({})

  // Newest first: a merchant you just created should not be below the fold of
  // a nineteen-row table while you are looking for confirmation it exists.
  // (`portfolioOrder` re-sorts for display; this only fixes the tie.)
  const roster = useMemo(() => [...submitted, ...MERCHANTS], [submitted])

  const merchants = useMemo(
    () =>
      roster.map((m) => {
        const order = orders[m.id]
        if (!order) return m
        // The kit is DERIVED from the order wherever one exists, so the
        // portfolio row, the sign-off header and the agent bar cannot quote a
        // device count the basket disagrees with.
        return { ...m, ...summariseOrder(order.lines) }
      }),
    [roster, orders],
  )

  const submit = useCallback((draft: MerchantDraft) => {
    let created!: Merchant
    setSubmitted((prev) => {
      // Ids are checked against the whole book, not just this session's
      // additions, or a new "Atlas Coffee Roasters" would collide with the
      // fixture and edit its file.
      const taken = new Set([...MERCHANTS, ...prev].map((m) => m.id))
      created = createMerchant(draft, taken)
      return [created, ...prev]
    })
    return created
  }, [])

  const orderFor = useCallback(
    (merchant: Merchant) => orders[merchant.id] ?? defaultOrder(merchant),
    [orders],
  )

  const setOrder = useCallback(
    (merchant: Merchant, next: OrderDraft | ((prev: OrderDraft) => OrderDraft)) => {
      setOrders((prev) => {
        // On the first edit there is no override, so the updater is applied to
        // this merchant's own default. Keyed by id, which is what stops one
        // merchant's basket appearing against another — the old single `useState`
        // slot needed a reset-on-switch effect to paper over exactly that, and
        // the effect also discarded edits you meant to keep.
        const base = prev[merchant.id] ?? defaultOrder(merchant)
        const draft = typeof next === "function" ? next(base) : next

        /* A NO-OP WRITE MUST NOT PRODUCE NEW STATE. This used to allocate
           `{ ...prev }` unconditionally, so an updater that returned its own
           input — the standard way to say "nothing to change" — still published
           a new orders object.
        
           That was an infinite render loop, and the log shows it firing: the
           delivery artefact defaults the requested date once, guarded by
           `if (d.requestedIso) return d`. The guard was correct and got thrown
           away here. The new object changed the context value, which gave
           `themeFor`/`playedFor` new identities, which recomputed `halted` and
           `live` in app/page.tsx, which handed the cockpit a NEW merchant object,
           which rebuilt `setDraft`, whose identity is the effect's dependency —
           so the effect ran again, wrote again, and round it went until React
           threw "Maximum update depth exceeded" and tore down the tree. Since
           every screen and provider here is in-memory, the remount landed back
           on the portfolio: the "it goes back to the main page" report.
        
           Bailing out on an unchanged draft cuts the cycle at its first link and
           honours the signal callers were already sending. `resetOrder` below
           has always done this; `setOrder` was the outlier.
        
           Compared against `base`, not against the stored entry, so that a
           no-op against a merchant with no override yet does not CREATE one —
           `orderEdited` is "is there an entry", so writing an unchanged draft
           would report the kit as edited by the acquirer when nobody touched
           it. */
        if (draft === base) return prev

        return { ...prev, [merchant.id]: draft }
      })
    },
    [],
  )

  const resetOrder = useCallback((merchantId: string) => {
    setOrders((prev) => {
      if (!(merchantId in prev)) return prev
      const nextState = { ...prev }
      delete nextState[merchantId]
      return nextState
    })
  }, [])

  const orderEdited = useCallback((merchantId: string) => merchantId in orders, [orders])

  const value = useMemo(
    () => ({ merchants, submit, orderFor, setOrder, resetOrder, orderEdited }),
    [merchants, submit, orderFor, setOrder, resetOrder, orderEdited],
  )

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>
}

export function useBook(): BookContextValue {
  const ctx = useContext(BookContext)
  if (!ctx) throw new Error("useBook must be used inside <BookProvider>")
  return ctx
}
