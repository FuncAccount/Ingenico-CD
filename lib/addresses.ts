/**
 * The street address on file for each merchant — ONE copy, because there were
 * two and they disagreed.
 *
 * The delivery map and trace read this register and rendered "Via Tortona 27,
 * Milan, IT serviceable", while the logistics exception beside it described a
 * failure at "Via Roma 12/A and 12/B in 20121 Milano" — a different street, a
 * different postcode, for the same merchant on the same screen. Two hand-typed
 * copies of one fact will drift, and an exception that names an address the
 * rest of the app has never heard of cannot be acted on: nobody can correct a
 * record they cannot find.
 *
 * Lives in its own module rather than in `artifacts.ts` because `artifacts.ts`
 * imports `exceptions.ts`, so the exception fixtures cannot import back from it
 * without a cycle. Both now depend on this instead.
 */
const STREET: Record<string, string> = {
  "m-atlas": "18 Tib Street, Northern Quarter",
  "m-verde": "Rua da Prata 62",
  "m-nordwind": "Eppendorfer Landstraße 77",
  "m-solmar": "Paseo Marítimo Pablo Ruiz Picasso 21",
  "m-brightline": "44 Dame Street",
  "m-tavo": "Via Tortona 27",
  "m-fjord": "Torgallmenningen 8",
  "m-lumen": "Overtoom 301",
  "m-cedar": "9 Victoria Street",
  "m-havenport": "Quai du Port 14",
  "m-kessler": "Königstraße 52",
  "m-marisol": "Carrer de Colón 18",
}

/** The street line alone. Falls back to a NAMED absence rather than an empty
 *  string, which would render as a stray comma and read as a broken template. */
export function streetFor(merchantId: string): string {
  return STREET[merchantId] ?? "Address on file"
}
