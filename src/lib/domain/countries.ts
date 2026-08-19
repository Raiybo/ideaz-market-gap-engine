/**
 * Country registry.
 *
 * `iso3` is the World Bank / UN Comtrade key. The `conditions` overlay holds
 * structural facts that do not appear cleanly in any single free indicator but
 * materially change which businesses work — grid reliability, currency
 * stability, informality, import dependence.
 *
 * Countries without an explicit overlay fall back to NEUTRAL_CONDITIONS and are
 * reported at lower confidence by the engine, rather than being silently
 * treated as if the data were known.
 */

export interface MarketConditions {
  /** 0 = grid fails daily, 1 = reliable 24/7 power. */
  gridReliability: number;
  /** 0 = stable currency, 1 = severe depreciation / capital controls. */
  currencyInstability: number;
  /** 0 = fully formalised economy, 1 = predominantly cash and informal. */
  informality: number;
  /** 0 = self-sufficient, 1 = imports most consumed goods. */
  importDependence: number;
  /** 0 = trivial to open a business, 1 = heavy bureaucratic friction. */
  bureaucraticFriction: number;
  /** 0 = deep local capital markets, 1 = no accessible financing. */
  capitalScarcity: number;
  /** Free-text notes surfaced in the UI so the score is never a black box. */
  notes: string[];
}

export const NEUTRAL_CONDITIONS: MarketConditions = {
  gridReliability: 0.75,
  currencyInstability: 0.25,
  informality: 0.35,
  importDependence: 0.45,
  bureaucraticFriction: 0.4,
  capitalScarcity: 0.4,
  notes: [],
};

export interface Country {
  iso3: string;
  iso2: string;
  name: string;
  region: string;
  /** Present only where conditions were explicitly researched. */
  conditions?: MarketConditions;
}

export const COUNTRIES: Country[] = [
  // ---- Middle East & North Africa -----------------------------------------
  {
    iso3: "LBN",
    iso2: "LB",
    name: "Lebanon",
    region: "Middle East & North Africa",
    conditions: {
      gridReliability: 0.15,
      currencyInstability: 0.95,
      informality: 0.85,
      importDependence: 0.85,
      bureaucraticFriction: 0.75,
      capitalScarcity: 0.9,
      notes: [
        "State electricity supply covers only a few hours per day; private generation is a standing cost line for every business.",
        "Banking sector restrictions since 2019 make local credit largely unavailable — assume self-funded or diaspora capital.",
        "Economy is heavily cash-based and dollarised, which favours low-fixed-cost, fast-payback models.",
        "Very high import dependence across food, fuel and manufactured goods creates unusually wide import-substitution gaps.",
        "Large, wealthy and engaged diaspora is a genuine demand channel most local operators underuse.",
      ],
    },
  },
  { iso3: "ARE", iso2: "AE", name: "United Arab Emirates", region: "Middle East & North Africa", conditions: { gridReliability: 0.97, currencyInstability: 0.05, informality: 0.15, importDependence: 0.8, bureaucraticFriction: 0.25, capitalScarcity: 0.2, notes: ["Free-zone structures make company formation and foreign ownership straightforward.", "Very high import dependence, but low tariffs make local substitution harder to justify on cost alone."] } },
  { iso3: "SAU", iso2: "SA", name: "Saudi Arabia", region: "Middle East & North Africa", conditions: { gridReliability: 0.93, currencyInstability: 0.05, informality: 0.2, importDependence: 0.7, bureaucraticFriction: 0.45, capitalScarcity: 0.25, notes: ["Vision 2030 localisation mandates actively subsidise domestic manufacturing substitution.", "Large state procurement budgets favour B2G-capable operators."] } },
  { iso3: "EGY", iso2: "EG", name: "Egypt", region: "Middle East & North Africa", conditions: { gridReliability: 0.6, currencyInstability: 0.75, informality: 0.7, importDependence: 0.55, bureaucraticFriction: 0.7, capitalScarcity: 0.7, notes: ["Repeated devaluation makes import-dependent models fragile and local production advantaged.", "Very large domestic market supports scale even at low per-capita income."] } },
  { iso3: "JOR", iso2: "JO", name: "Jordan", region: "Middle East & North Africa", conditions: { gridReliability: 0.85, currencyInstability: 0.15, informality: 0.45, importDependence: 0.75, bureaucraticFriction: 0.5, capitalScarcity: 0.55, notes: ["Energy and water import dependence is structural and persistent."] } },
  { iso3: "QAT", iso2: "QA", name: "Qatar", region: "Middle East & North Africa" },
  { iso3: "KWT", iso2: "KW", name: "Kuwait", region: "Middle East & North Africa" },
  { iso3: "BHR", iso2: "BH", name: "Bahrain", region: "Middle East & North Africa" },
  { iso3: "OMN", iso2: "OM", name: "Oman", region: "Middle East & North Africa" },
  { iso3: "IRQ", iso2: "IQ", name: "Iraq", region: "Middle East & North Africa", conditions: { gridReliability: 0.3, currencyInstability: 0.5, informality: 0.8, importDependence: 0.85, bureaucraticFriction: 0.8, capitalScarcity: 0.75, notes: ["Chronic power deficit sustains demand for private generation and storage.", "Extremely high import dependence across nearly all manufactured categories."] } },
  { iso3: "MAR", iso2: "MA", name: "Morocco", region: "Middle East & North Africa" },
  { iso3: "TUN", iso2: "TN", name: "Tunisia", region: "Middle East & North Africa" },
  { iso3: "DZA", iso2: "DZ", name: "Algeria", region: "Middle East & North Africa" },
  { iso3: "TUR", iso2: "TR", name: "Türkiye", region: "Middle East & North Africa", conditions: { gridReliability: 0.85, currencyInstability: 0.8, informality: 0.5, importDependence: 0.45, bureaucraticFriction: 0.45, capitalScarcity: 0.6, notes: ["Persistent lira depreciation makes exporters structurally advantaged.", "Deep existing manufacturing base raises the bar for new entrants."] } },
  { iso3: "ISR", iso2: "IL", name: "Israel", region: "Middle East & North Africa" },

  // ---- Sub-Saharan Africa --------------------------------------------------
  { iso3: "NGA", iso2: "NG", name: "Nigeria", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.2, currencyInstability: 0.85, informality: 0.85, importDependence: 0.7, bureaucraticFriction: 0.75, capitalScarcity: 0.8, notes: ["Grid failure is near-universal; diesel and solar are default infrastructure.", "FX scarcity repeatedly strands importers — local sourcing is a survival trait."] } },
  { iso3: "KEN", iso2: "KE", name: "Kenya", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.6, currencyInstability: 0.5, informality: 0.8, importDependence: 0.6, bureaucraticFriction: 0.55, capitalScarcity: 0.6, notes: ["Mobile money penetration is exceptionally high, lowering payment friction for new models."] } },
  { iso3: "ZAF", iso2: "ZA", name: "South Africa", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.45, currencyInstability: 0.45, informality: 0.5, importDependence: 0.45, bureaucraticFriction: 0.55, capitalScarcity: 0.4, notes: ["Scheduled load-shedding sustains structural demand for backup power."] } },
  { iso3: "GHA", iso2: "GH", name: "Ghana", region: "Sub-Saharan Africa" },
  { iso3: "ETH", iso2: "ET", name: "Ethiopia", region: "Sub-Saharan Africa" },
  { iso3: "TZA", iso2: "TZ", name: "Tanzania", region: "Sub-Saharan Africa" },
  { iso3: "UGA", iso2: "UG", name: "Uganda", region: "Sub-Saharan Africa" },
  { iso3: "SEN", iso2: "SN", name: "Senegal", region: "Sub-Saharan Africa" },
  { iso3: "CIV", iso2: "CI", name: "Côte d'Ivoire", region: "Sub-Saharan Africa" },
  { iso3: "RWA", iso2: "RW", name: "Rwanda", region: "Sub-Saharan Africa" },

  // ---- Europe & Central Asia ----------------------------------------------
  { iso3: "DEU", iso2: "DE", name: "Germany", region: "Europe & Central Asia" },
  { iso3: "FRA", iso2: "FR", name: "France", region: "Europe & Central Asia" },
  { iso3: "GBR", iso2: "GB", name: "United Kingdom", region: "Europe & Central Asia" },
  { iso3: "ITA", iso2: "IT", name: "Italy", region: "Europe & Central Asia" },
  { iso3: "ESP", iso2: "ES", name: "Spain", region: "Europe & Central Asia" },
  { iso3: "NLD", iso2: "NL", name: "Netherlands", region: "Europe & Central Asia" },
  { iso3: "POL", iso2: "PL", name: "Poland", region: "Europe & Central Asia" },
  { iso3: "SWE", iso2: "SE", name: "Sweden", region: "Europe & Central Asia" },
  { iso3: "CHE", iso2: "CH", name: "Switzerland", region: "Europe & Central Asia" },
  { iso3: "PRT", iso2: "PT", name: "Portugal", region: "Europe & Central Asia" },
  { iso3: "GRC", iso2: "GR", name: "Greece", region: "Europe & Central Asia" },
  { iso3: "ROU", iso2: "RO", name: "Romania", region: "Europe & Central Asia" },
  { iso3: "UKR", iso2: "UA", name: "Ukraine", region: "Europe & Central Asia" },
  { iso3: "KAZ", iso2: "KZ", name: "Kazakhstan", region: "Europe & Central Asia" },
  { iso3: "UZB", iso2: "UZ", name: "Uzbekistan", region: "Europe & Central Asia" },
  { iso3: "GEO", iso2: "GE", name: "Georgia", region: "Europe & Central Asia" },
  { iso3: "ARM", iso2: "AM", name: "Armenia", region: "Europe & Central Asia" },
  { iso3: "CYP", iso2: "CY", name: "Cyprus", region: "Europe & Central Asia" },

  // ---- East Asia & Pacific -------------------------------------------------
  { iso3: "CHN", iso2: "CN", name: "China", region: "East Asia & Pacific" },
  { iso3: "JPN", iso2: "JP", name: "Japan", region: "East Asia & Pacific" },
  { iso3: "KOR", iso2: "KR", name: "South Korea", region: "East Asia & Pacific" },
  { iso3: "IDN", iso2: "ID", name: "Indonesia", region: "East Asia & Pacific" },
  { iso3: "VNM", iso2: "VN", name: "Vietnam", region: "East Asia & Pacific" },
  { iso3: "THA", iso2: "TH", name: "Thailand", region: "East Asia & Pacific" },
  { iso3: "PHL", iso2: "PH", name: "Philippines", region: "East Asia & Pacific" },
  { iso3: "MYS", iso2: "MY", name: "Malaysia", region: "East Asia & Pacific" },
  { iso3: "SGP", iso2: "SG", name: "Singapore", region: "East Asia & Pacific" },
  { iso3: "AUS", iso2: "AU", name: "Australia", region: "East Asia & Pacific" },
  { iso3: "NZL", iso2: "NZ", name: "New Zealand", region: "East Asia & Pacific" },

  // ---- South Asia ----------------------------------------------------------
  { iso3: "IND", iso2: "IN", name: "India", region: "South Asia" },
  { iso3: "PAK", iso2: "PK", name: "Pakistan", region: "South Asia", conditions: { gridReliability: 0.4, currencyInstability: 0.8, informality: 0.8, importDependence: 0.6, bureaucraticFriction: 0.7, capitalScarcity: 0.75, notes: ["Recurrent FX crises and load-shedding both favour local production and off-grid power."] } },
  { iso3: "BGD", iso2: "BD", name: "Bangladesh", region: "South Asia" },
  { iso3: "LKA", iso2: "LK", name: "Sri Lanka", region: "South Asia" },
  { iso3: "NPL", iso2: "NP", name: "Nepal", region: "South Asia" },

  // ---- Americas ------------------------------------------------------------
  { iso3: "USA", iso2: "US", name: "United States", region: "North America" },
  { iso3: "CAN", iso2: "CA", name: "Canada", region: "North America" },
  { iso3: "MEX", iso2: "MX", name: "Mexico", region: "Latin America & Caribbean" },
  { iso3: "BRA", iso2: "BR", name: "Brazil", region: "Latin America & Caribbean" },
  { iso3: "ARG", iso2: "AR", name: "Argentina", region: "Latin America & Caribbean", conditions: { gridReliability: 0.7, currencyInstability: 0.95, informality: 0.7, importDependence: 0.4, bureaucraticFriction: 0.75, capitalScarcity: 0.8, notes: ["Chronic inflation and capital controls push demand toward hard-currency and export-earning models."] } },
  { iso3: "CHL", iso2: "CL", name: "Chile", region: "Latin America & Caribbean" },
  { iso3: "COL", iso2: "CO", name: "Colombia", region: "Latin America & Caribbean" },
  { iso3: "PER", iso2: "PE", name: "Peru", region: "Latin America & Caribbean" },
];

export const COUNTRY_BY_ISO3 = new Map(COUNTRIES.map((c) => [c.iso3, c]));

export const DEFAULT_COUNTRY = "LBN";

export function conditionsFor(country: Country): {
  conditions: MarketConditions;
  curated: boolean;
} {
  return country.conditions
    ? { conditions: country.conditions, curated: true }
    : { conditions: NEUTRAL_CONDITIONS, curated: false };
}
