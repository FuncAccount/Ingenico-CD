// The acquirer's LIVE book — merchants already trading on Ingenico kit.
//
// WHY THIS IS A SEPARATE DATASET FROM `MERCHANTS`.
//
// `MERCHANTS` is the onboarding pipeline: 19 applications in flight, each with
// a `currentStep`, a `status` and an event log. Look-alike search used to run
// against that array, and that was the wrong population twice over:
//
//   1. It is thin by construction. 14 of the 19 were the only merchant of
//      their sector in their country, so an Edinburgh retailer's "nearest
//      comparables" reached Galway, Bergen and Innsbruck. No amount of
//      ranking fixes a book that holds nothing local — the data was the bug.
//   2. An in-flight application has no trading history. The kit panel says it
//      proposes "the device mix most of those merchants run today", and an
//      application that has not gone live yet runs nothing today. Comparing a
//      new applicant against other new applicants answers a different
//      question from the one being asked.
//
// A real acquirer's book is its live estate — thousands of merchants already
// settling. That is the population a comparator should come from, and it is
// deep enough to answer locally. Keeping it out of `MERCHANTS` also keeps the
// portfolio table, the KPI counts, the sign-off queue and the journey switcher
// showing what they are meant to show: work in flight, not the whole estate.
//
// Coverage rule: every (country, sector) an in-flight merchant belongs to has
// at least three live merchants in the SAME country, so the local path is the
// normal path and cross-border stays what it should be — a flagged exception.

/**
 * A live merchant, carrying only what a comparison needs.
 *
 * Deliberately NOT the `Merchant` interface. That type requires `currentStep`,
 * `status`, `submitted` and `events`, none of which a trading merchant has any
 * meaningful value for. Reusing it would have forced a fake onboarding step
 * onto every record here, and a fake step is readable straight through as
 * real progress by anything that reads the field.
 */
export interface BookMerchant {
  id: string
  name: string
  sector: string
  /** "City, CC" — must exist in CITY_COORDS or distanceKm throws. */
  location: string
  /** Annual card volume, in the merchant's own currency. */
  size: string
  /** The device mix this merchant runs today. */
  terminals: string
  terminalCount: number
}

export const LIVE_BOOK: BookMerchant[] = [
  // --- United Kingdom · Hospitality -------------------------------------
  { id: "b-uk-h1", name: "Northern Quarter Kitchen", sector: "Hospitality", location: "Manchester, UK", size: "£1.8m / yr", terminals: "4× A920", terminalCount: 4 },
  { id: "b-uk-h2", name: "Waterside Inn", sector: "Hospitality", location: "Bristol, UK", size: "£940k / yr", terminals: "3× A920", terminalCount: 3 },
  { id: "b-uk-h3", name: "Old Mill Brasserie", sector: "Hospitality", location: "Leeds, UK", size: "£2.2m / yr", terminals: "5× A920 + softPOS", terminalCount: 6 },

  // --- United Kingdom · Retail ------------------------------------------
  { id: "b-uk-r1", name: "Grassmarket Goods", sector: "Retail", location: "Edinburgh, UK", size: "£1.2m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-uk-r2", name: "Shambles Trading Co.", sector: "Retail", location: "York, UK", size: "£760k / yr", terminals: "3× A920", terminalCount: 3 },
  { id: "b-uk-r3", name: "Deansgate Department", sector: "Retail", location: "Manchester, UK", size: "£4.1m / yr", terminals: "8× Move 5000", terminalCount: 8 },

  // --- United Kingdom · the remaining form sectors ------------------------
  // The submit form offers six sectors. The book covered only two of them in
  // the UK, so a UK pharmacy applicant was still shown Irish comparables —
  // the original complaint, reached by a different route. Coverage has to
  // match the vocabulary the form offers, not just the merchants in flight.
  { id: "b-uk-p1", name: "Kingsway Pharmacy", sector: "Pharmacy", location: "Manchester, UK", size: "£1.1m / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-uk-p2", name: "Riverside Chemists", sector: "Pharmacy", location: "Bristol, UK", size: "£820k / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-uk-p3", name: "Whitfield Pharmacy Group", sector: "Pharmacy", location: "Leeds, UK", size: "£2.0m / yr", terminals: "3× Desk 5000", terminalCount: 3 },

  { id: "b-uk-f1", name: "Ironworks Gym", sector: "Health & Fitness", location: "Manchester, UK", size: "£780k / yr", terminals: "3× softPOS", terminalCount: 3 },
  { id: "b-uk-f2", name: "Meadow Lane Leisure Club", sector: "Health & Fitness", location: "York, UK", size: "£1.3m / yr", terminals: "4× softPOS", terminalCount: 4 },
  { id: "b-uk-f3", name: "Clyde Strength Co.", sector: "Health & Fitness", location: "Glasgow, UK", size: "£960k / yr", terminals: "3× softPOS", terminalCount: 3 },

  { id: "b-uk-a1", name: "Pennine Motor Group", sector: "Automotive", location: "Leeds, UK", size: "£5.4m / yr", terminals: "6× Desk 5000", terminalCount: 6 },
  { id: "b-uk-a2", name: "Ashworth Vehicle Services", sector: "Automotive", location: "Manchester, UK", size: "£3.2m / yr", terminals: "4× Desk 5000", terminalCount: 4 },
  { id: "b-uk-a3", name: "Southgate Car Centre", sector: "Automotive", location: "Bristol, UK", size: "£2.6m / yr", terminals: "4× Desk 5000", terminalCount: 4 },

  { id: "b-uk-l1", name: "Harbour Watersports", sector: "Leisure", location: "Bristol, UK", size: "£1.1m / yr", terminals: "3× Move 5000 + softPOS", terminalCount: 4 },
  { id: "b-uk-l2", name: "Loch Lomond Adventure", sector: "Leisure", location: "Glasgow, UK", size: "£1.9m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-uk-l3", name: "City Climbing Works", sector: "Leisure", location: "Manchester, UK", size: "£740k / yr", terminals: "2× Move 5000", terminalCount: 2 },

  // --- Ireland · Retail ---------------------------------------------------
  { id: "b-ie-r1", name: "Claddagh Homeware", sector: "Retail", location: "Galway, IE", size: "€830k / yr", terminals: "3× A920", terminalCount: 3 },
  { id: "b-ie-r2", name: "Corrib Outdoor", sector: "Retail", location: "Galway, IE", size: "€1.4m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-ie-r3", name: "Patrick Street Stores", sector: "Retail", location: "Cork, IE", size: "€2.7m / yr", terminals: "6× Move 5000", terminalCount: 6 },

  // --- Ireland · Pharmacy -------------------------------------------------
  { id: "b-ie-p1", name: "Liffey Pharmacy", sector: "Pharmacy", location: "Dublin, IE", size: "€1.3m / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-ie-p2", name: "Clonard Chemists", sector: "Pharmacy", location: "Cork, IE", size: "€960k / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-ie-p3", name: "Shannon Health Pharmacy", sector: "Pharmacy", location: "Limerick, IE", size: "€1.7m / yr", terminals: "3× Desk 5000", terminalCount: 3 },

  // --- Ireland · Healthcare -----------------------------------------------
  { id: "b-ie-c1", name: "Rathmines Veterinary", sector: "Healthcare", location: "Dublin, IE", size: "€640k / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-ie-c2", name: "Blackrock Dental Care", sector: "Healthcare", location: "Dublin, IE", size: "€1.1m / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-ie-c3", name: "Corrib Animal Clinic", sector: "Healthcare", location: "Galway, IE", size: "€480k / yr", terminals: "1× Desk 5000", terminalCount: 1 },

  // --- Germany · Pharmacy -------------------------------------------------
  { id: "b-de-p1", name: "Elbtor Apotheke", sector: "Pharmacy", location: "Hamburg, DE", size: "€1.6m / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-de-p2", name: "Rosen Apotheke", sector: "Pharmacy", location: "Bremen, DE", size: "€1.1m / yr", terminals: "2× Desk 5000", terminalCount: 2 },
  { id: "b-de-p3", name: "Stadtmitte Apotheke", sector: "Pharmacy", location: "Hanover, DE", size: "€2.3m / yr", terminals: "3× Desk 5000", terminalCount: 3 },

  // --- Germany · Automotive -----------------------------------------------
  { id: "b-de-a1", name: "Autohaus Brenner", sector: "Automotive", location: "Stuttgart, DE", size: "€4.8m / yr", terminals: "6× Desk 5000", terminalCount: 6 },
  { id: "b-de-a2", name: "Neckar Motors", sector: "Automotive", location: "Karlsruhe, DE", size: "€3.1m / yr", terminals: "4× Desk 5000", terminalCount: 4 },
  { id: "b-de-a3", name: "Wagner Fahrzeugtechnik", sector: "Automotive", location: "Munich, DE", size: "€6.2m / yr", terminals: "8× Desk 5000", terminalCount: 8 },

  // --- Spain · Hospitality ------------------------------------------------
  { id: "b-es-h1", name: "Chiringuito Marena", sector: "Hospitality", location: "Málaga, ES", size: "€1.9m / yr", terminals: "4× A920", terminalCount: 4 },
  { id: "b-es-h2", name: "Hotel Costa Lucía", sector: "Hospitality", location: "Marbella, ES", size: "€3.4m / yr", terminals: "6× A920 + softPOS", terminalCount: 7 },
  { id: "b-es-h3", name: "Bodega San Telmo", sector: "Hospitality", location: "Seville, ES", size: "€820k / yr", terminals: "2× A920", terminalCount: 2 },

  // --- Spain · Retail -----------------------------------------------------
  { id: "b-es-r1", name: "Comercial Turia", sector: "Retail", location: "Valencia, ES", size: "€1.5m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-es-r2", name: "Mercat Central Shops", sector: "Retail", location: "Barcelona, ES", size: "€3.8m / yr", terminals: "8× Move 5000", terminalCount: 8 },
  { id: "b-es-r3", name: "Almacenes Sol", sector: "Retail", location: "Alicante, ES", size: "€920k / yr", terminals: "3× A920", terminalCount: 3 },

  // --- Italy · Hospitality ------------------------------------------------
  { id: "b-it-h1", name: "Osteria del Naviglio", sector: "Hospitality", location: "Milan, IT", size: "€740k / yr", terminals: "2× A920", terminalCount: 2 },
  { id: "b-it-h2", name: "Caffè Ottocento", sector: "Hospitality", location: "Turin, IT", size: "€1.2m / yr", terminals: "3× A920", terminalCount: 3 },
  { id: "b-it-h3", name: "Albergo Fiorenza", sector: "Hospitality", location: "Bologna, IT", size: "€2.6m / yr", terminals: "5× A920 + softPOS", terminalCount: 6 },

  // --- Portugal · Retail --------------------------------------------------
  { id: "b-pt-r1", name: "Casa Ribeiro", sector: "Retail", location: "Lisbon, PT", size: "€1.4m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-pt-r2", name: "Mercado Azul", sector: "Retail", location: "Porto, PT", size: "€2.2m / yr", terminals: "6× Move 5000", terminalCount: 6 },
  { id: "b-pt-r3", name: "Quinta Verde Stores", sector: "Retail", location: "Braga, PT", size: "€780k / yr", terminals: "3× A920", terminalCount: 3 },

  // --- Portugal · Hospitality ---------------------------------------------
  { id: "b-pt-h1", name: "Pousada do Douro", sector: "Hospitality", location: "Porto, PT", size: "€2.4m / yr", terminals: "5× A920", terminalCount: 5 },
  { id: "b-pt-h2", name: "Taberna Ribeira", sector: "Hospitality", location: "Porto, PT", size: "€680k / yr", terminals: "2× A920", terminalCount: 2 },
  { id: "b-pt-h3", name: "Hotel Praia Dourada", sector: "Hospitality", location: "Faro, PT", size: "€3.6m / yr", terminals: "7× A920 + softPOS", terminalCount: 8 },

  // --- Netherlands · Health & Fitness -------------------------------------
  { id: "b-nl-f1", name: "Kade Sportclub", sector: "Health & Fitness", location: "Amsterdam, NL", size: "€1.1m / yr", terminals: "4× softPOS", terminalCount: 4 },
  { id: "b-nl-f2", name: "Vondel Fitness", sector: "Health & Fitness", location: "Utrecht, NL", size: "€680k / yr", terminals: "3× softPOS", terminalCount: 3 },
  { id: "b-nl-f3", name: "Maas Health Club", sector: "Health & Fitness", location: "Rotterdam, NL", size: "€1.8m / yr", terminals: "5× softPOS + A920", terminalCount: 6 },

  // --- France · Leisure ---------------------------------------------------
  { id: "b-fr-l1", name: "Port Azur Nautique", sector: "Leisure", location: "Marseille, FR", size: "€2.1m / yr", terminals: "3× Move 5000 + softPOS", terminalCount: 4 },
  { id: "b-fr-l2", name: "Base Nautique Calanques", sector: "Leisure", location: "Toulon, FR", size: "€890k / yr", terminals: "2× Move 5000", terminalCount: 2 },
  { id: "b-fr-l3", name: "Domaine des Lacs", sector: "Leisure", location: "Lyon, FR", size: "€3.2m / yr", terminals: "5× Move 5000 + softPOS", terminalCount: 6 },

  // --- Austria · Retail ---------------------------------------------------
  { id: "b-at-r1", name: "Alpin Ausrüstung", sector: "Retail", location: "Innsbruck, AT", size: "€1.9m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-at-r2", name: "Kaufhaus Steiner", sector: "Retail", location: "Salzburg, AT", size: "€3.3m / yr", terminals: "6× Move 5000", terminalCount: 6 },
  { id: "b-at-r3", name: "Grazer Sporthaus", sector: "Retail", location: "Graz, AT", size: "€1.2m / yr", terminals: "3× A920", terminalCount: 3 },

  // --- Norway · Retail ----------------------------------------------------
  { id: "b-no-r1", name: "Bryggen Sport", sector: "Retail", location: "Bergen, NO", size: "kr 14m / yr", terminals: "4× Move 5000", terminalCount: 4 },
  { id: "b-no-r2", name: "Nordlys Friluft", sector: "Retail", location: "Trondheim, NO", size: "kr 26m / yr", terminals: "6× Move 5000", terminalCount: 6 },
  { id: "b-no-r3", name: "Vestkyst Butikk", sector: "Retail", location: "Stavanger, NO", size: "kr 9.4m / yr", terminals: "3× A920", terminalCount: 3 },
]
