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
  { iso3: "QAT", iso2: "QA", name: "Qatar", region: "Middle East & North Africa", conditions: { gridReliability: 0.96, currencyInstability: 0.05, informality: 0.15, importDependence: 0.85, bureaucraticFriction: 0.45, capitalScarcity: 0.2, notes: ["Almost everything consumed is imported, but zero-tariff access means local production competes on logistics rather than duty avoidance.", "Small population caps domestic scale; most viable plays serve regional or transit demand."] } },
  { iso3: "KWT", iso2: "KW", name: "Kuwait", region: "Middle East & North Africa", conditions: { gridReliability: 0.92, currencyInstability: 0.05, informality: 0.2, importDependence: 0.85, bureaucraticFriction: 0.6, capitalScarcity: 0.25, notes: ["Heavy state employment leaves private-sector services comparatively underdeveloped.", "Business licensing is slower than the regional average."] } },
  { iso3: "BHR", iso2: "BH", name: "Bahrain", region: "Middle East & North Africa" },
  { iso3: "OMN", iso2: "OM", name: "Oman", region: "Middle East & North Africa" },
  { iso3: "IRQ", iso2: "IQ", name: "Iraq", region: "Middle East & North Africa", conditions: { gridReliability: 0.3, currencyInstability: 0.5, informality: 0.8, importDependence: 0.85, bureaucraticFriction: 0.8, capitalScarcity: 0.75, notes: ["Chronic power deficit sustains demand for private generation and storage.", "Extremely high import dependence across nearly all manufactured categories."] } },
  { iso3: "MAR", iso2: "MA", name: "Morocco", region: "Middle East & North Africa", conditions: { gridReliability: 0.88, currencyInstability: 0.2, informality: 0.6, importDependence: 0.55, bureaucraticFriction: 0.5, capitalScarcity: 0.45, notes: ["Established automotive and aerospace export base means industrial inputs have a real local customer.", "EU proximity and trade agreements favour export-oriented manufacturing over pure import substitution."] } },
  { iso3: "TUN", iso2: "TN", name: "Tunisia", region: "Middle East & North Africa", conditions: { gridReliability: 0.8, currencyInstability: 0.5, informality: 0.6, importDependence: 0.6, bureaucraticFriction: 0.65, capitalScarcity: 0.65, notes: ["Persistent FX pressure and import licensing make input-dependent models fragile.", "Skilled technical labour is inexpensive relative to Europe, favouring offshored services."] } },
  { iso3: "DZA", iso2: "DZ", name: "Algeria", region: "Middle East & North Africa", conditions: { gridReliability: 0.85, currencyInstability: 0.5, informality: 0.65, importDependence: 0.6, bureaucraticFriction: 0.8, capitalScarcity: 0.6, notes: ["Import restrictions are used actively as policy, which both protects local producers and makes input supply unpredictable.", "Hydrocarbon dependence leaves most non-energy categories thinly served."] } },
  { iso3: "TUR", iso2: "TR", name: "Türkiye", region: "Middle East & North Africa", conditions: { gridReliability: 0.85, currencyInstability: 0.8, informality: 0.5, importDependence: 0.45, bureaucraticFriction: 0.45, capitalScarcity: 0.6, notes: ["Persistent lira depreciation makes exporters structurally advantaged.", "Deep existing manufacturing base raises the bar for new entrants."] } },
  { iso3: "ISR", iso2: "IL", name: "Israel", region: "Middle East & North Africa" },

  // ---- Sub-Saharan Africa --------------------------------------------------
  { iso3: "NGA", iso2: "NG", name: "Nigeria", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.2, currencyInstability: 0.85, informality: 0.85, importDependence: 0.7, bureaucraticFriction: 0.75, capitalScarcity: 0.8, notes: ["Grid failure is near-universal; diesel and solar are default infrastructure.", "FX scarcity repeatedly strands importers — local sourcing is a survival trait."] } },
  { iso3: "KEN", iso2: "KE", name: "Kenya", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.6, currencyInstability: 0.5, informality: 0.8, importDependence: 0.6, bureaucraticFriction: 0.55, capitalScarcity: 0.6, notes: ["Mobile money penetration is exceptionally high, lowering payment friction for new models."] } },
  { iso3: "ZAF", iso2: "ZA", name: "South Africa", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.45, currencyInstability: 0.45, informality: 0.5, importDependence: 0.45, bureaucraticFriction: 0.55, capitalScarcity: 0.4, notes: ["Scheduled load-shedding sustains structural demand for backup power."] } },
  { iso3: "GHA", iso2: "GH", name: "Ghana", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.55, currencyInstability: 0.75, informality: 0.8, importDependence: 0.65, bureaucraticFriction: 0.6, capitalScarcity: 0.7, notes: ["Cedi depreciation has repeatedly wiped out importer margins, advantaging locally sourced inputs.", "Scheduled outages ('dumsor') make private generation a standing cost for any production."] } },
  { iso3: "ETH", iso2: "ET", name: "Ethiopia", region: "Sub-Saharan Africa", conditions: { gridReliability: 0.45, currencyInstability: 0.8, informality: 0.85, importDependence: 0.6, bureaucraticFriction: 0.75, capitalScarcity: 0.8, notes: ["Foreign exchange is rationed; access to hard currency is often the binding constraint rather than demand.", "Very large population at low income favours staples and volume over premium positioning."] } },
  { iso3: "TZA", iso2: "TZ", name: "Tanzania", region: "Sub-Saharan Africa" },
  { iso3: "UGA", iso2: "UG", name: "Uganda", region: "Sub-Saharan Africa" },
  { iso3: "SEN", iso2: "SN", name: "Senegal", region: "Sub-Saharan Africa" },
  { iso3: "CIV", iso2: "CI", name: "Côte d'Ivoire", region: "Sub-Saharan Africa" },
  { iso3: "RWA", iso2: "RW", name: "Rwanda", region: "Sub-Saharan Africa" },

  // ---- Europe & Central Asia ----------------------------------------------
  { iso3: "DEU", iso2: "DE", name: "Germany", region: "Europe & Central Asia", conditions: { gridReliability: 0.97, currencyInstability: 0.08, informality: 0.12, importDependence: 0.4, bureaucraticFriction: 0.55, capitalScarcity: 0.25, notes: ["Industrial electricity costs have risen sharply since 2022, eroding the margin advantage of energy-intensive production.", "Permitting and administrative process is slow by developed-market standards.", "Dense incumbent industry means most goods gaps are supplied by domestic firms, not left open."] } },
  { iso3: "FRA", iso2: "FR", name: "France", region: "Europe & Central Asia", conditions: { gridReliability: 0.95, currencyInstability: 0.08, informality: 0.15, importDependence: 0.42, bureaucraticFriction: 0.6, capitalScarcity: 0.3, notes: ["Labour regulation makes headcount a long-term commitment; models that scale on people carry more risk than capital-intensive ones."] } },
  { iso3: "GBR", iso2: "GB", name: "United Kingdom", region: "Europe & Central Asia", conditions: { gridReliability: 0.93, currencyInstability: 0.18, informality: 0.15, importDependence: 0.48, bureaucraticFriction: 0.3, capitalScarcity: 0.28, notes: ["Post-Brexit customs friction has reopened import-substitution gaps in categories previously served frictionlessly from the EU."] } },
  { iso3: "ITA", iso2: "IT", name: "Italy", region: "Europe & Central Asia", conditions: { gridReliability: 0.92, currencyInstability: 0.1, informality: 0.35, importDependence: 0.5, bureaucraticFriction: 0.7, capitalScarcity: 0.4, notes: ["Administrative friction is high for a developed market, and payment terms run long.", "Strong domestic manufacturing tradition in food, machinery and design categories."] } },
  { iso3: "ESP", iso2: "ES", name: "Spain", region: "Europe & Central Asia" },
  { iso3: "NLD", iso2: "NL", name: "Netherlands", region: "Europe & Central Asia" },
  { iso3: "POL", iso2: "PL", name: "Poland", region: "Europe & Central Asia", conditions: { gridReliability: 0.9, currencyInstability: 0.22, informality: 0.3, importDependence: 0.48, bureaucraticFriction: 0.45, capitalScarcity: 0.35, notes: ["Cost base remains well below Western Europe while sitting inside the single market — a durable manufacturing and services arbitrage.", "Coal-heavy generation exposes energy-intensive production to carbon pricing."] } },
  { iso3: "SWE", iso2: "SE", name: "Sweden", region: "Europe & Central Asia" },
  { iso3: "CHE", iso2: "CH", name: "Switzerland", region: "Europe & Central Asia" },
  { iso3: "PRT", iso2: "PT", name: "Portugal", region: "Europe & Central Asia" },
  { iso3: "GRC", iso2: "GR", name: "Greece", region: "Europe & Central Asia", conditions: { gridReliability: 0.88, currencyInstability: 0.12, informality: 0.5, importDependence: 0.58, bureaucraticFriction: 0.65, capitalScarcity: 0.55, notes: ["Bank lending to SMEs remains constrained a decade after the debt crisis.", "High informality in services leaves formalised, tax-compliant operators a differentiation angle."] } },
  { iso3: "ROU", iso2: "RO", name: "Romania", region: "Europe & Central Asia" },
  { iso3: "UKR", iso2: "UA", name: "Ukraine", region: "Europe & Central Asia", conditions: { gridReliability: 0.35, currencyInstability: 0.65, informality: 0.6, importDependence: 0.55, bureaucraticFriction: 0.6, capitalScarcity: 0.85, notes: ["Wartime conditions: infrastructure is a live risk, not a background assumption, and any siting decision is a security decision.", "Reconstruction demand in building materials and energy equipment is large but contingent on financing and security.", "Treat every score here as provisional — the underlying indicators lag the situation badly."] } },
  { iso3: "KAZ", iso2: "KZ", name: "Kazakhstan", region: "Europe & Central Asia", conditions: { gridReliability: 0.8, currencyInstability: 0.45, informality: 0.5, importDependence: 0.6, bureaucraticFriction: 0.55, capitalScarcity: 0.5, notes: ["Landlocked, with most manufactured goods imported across long distances — freight cost is a structural moat for local producers.", "Resource dependence leaves consumer-facing categories comparatively underbuilt."] } },
  { iso3: "UZB", iso2: "UZ", name: "Uzbekistan", region: "Europe & Central Asia" },
  { iso3: "GEO", iso2: "GE", name: "Georgia", region: "Europe & Central Asia" },
  { iso3: "ARM", iso2: "AM", name: "Armenia", region: "Europe & Central Asia" },
  { iso3: "CYP", iso2: "CY", name: "Cyprus", region: "Europe & Central Asia" },

  // ---- East Asia & Pacific -------------------------------------------------
  { iso3: "CHN", iso2: "CN", name: "China", region: "East Asia & Pacific", conditions: { gridReliability: 0.92, currencyInstability: 0.2, informality: 0.35, importDependence: 0.2, bureaucraticFriction: 0.55, capitalScarcity: 0.3, notes: ["Supply chains are deep enough that most import gaps are already served domestically — expect few easy substitution plays.", "Scale of incumbent competition is the binding constraint, not demand."] } },
  { iso3: "JPN", iso2: "JP", name: "Japan", region: "East Asia & Pacific", conditions: { gridReliability: 0.95, currencyInstability: 0.3, informality: 0.1, importDependence: 0.52, bureaucraticFriction: 0.45, capitalScarcity: 0.25, notes: ["A weak yen has made imports expensive and domestic production and inbound tourism structurally more attractive.", "Ageing population drives durable demand in elder care and labour-saving automation."] } },
  { iso3: "KOR", iso2: "KR", name: "South Korea", region: "East Asia & Pacific" },
  { iso3: "IDN", iso2: "ID", name: "Indonesia", region: "East Asia & Pacific", conditions: { gridReliability: 0.8, currencyInstability: 0.35, informality: 0.7, importDependence: 0.35, bureaucraticFriction: 0.6, capitalScarcity: 0.5, notes: ["Downstream-processing mandates on raw commodities actively push value-add onshore.", "Archipelago geography makes internal logistics, not international freight, the dominant cost."] } },
  { iso3: "VNM", iso2: "VN", name: "Vietnam", region: "East Asia & Pacific", conditions: { gridReliability: 0.8, currencyInstability: 0.25, informality: 0.6, importDependence: 0.6, bureaucraticFriction: 0.55, capitalScarcity: 0.5, notes: ["A primary beneficiary of supply-chain diversification away from China, concentrating demand in industrial inputs and logistics.", "Northern industrial zones have experienced summer power rationing — a real constraint on energy-intensive plants."] } },
  { iso3: "THA", iso2: "TH", name: "Thailand", region: "East Asia & Pacific" },
  { iso3: "PHL", iso2: "PH", name: "Philippines", region: "East Asia & Pacific", conditions: { gridReliability: 0.7, currencyInstability: 0.35, informality: 0.7, importDependence: 0.55, bureaucraticFriction: 0.65, capitalScarcity: 0.55, notes: ["Remittance inflows underwrite consumer demand largely independently of domestic wages.", "English-language services export (BPO) is an established, proven channel."] } },
  { iso3: "MYS", iso2: "MY", name: "Malaysia", region: "East Asia & Pacific" },
  { iso3: "SGP", iso2: "SG", name: "Singapore", region: "East Asia & Pacific", conditions: { gridReliability: 0.98, currencyInstability: 0.1, informality: 0.1, importDependence: 0.9, bureaucraticFriction: 0.15, capitalScarcity: 0.15, notes: ["Imports nearly everything, but near-zero tariffs and no land for production mean import volume is not a substitution opportunity — read those gaps as trade-hub throughput, not unmet local demand.", "Land and labour costs rule out most physical production regardless of demand."] } },
  { iso3: "AUS", iso2: "AU", name: "Australia", region: "East Asia & Pacific" },
  { iso3: "NZL", iso2: "NZ", name: "New Zealand", region: "East Asia & Pacific" },

  // ---- South Asia ----------------------------------------------------------
  { iso3: "IND", iso2: "IN", name: "India", region: "South Asia", conditions: { gridReliability: 0.72, currencyInstability: 0.3, informality: 0.8, importDependence: 0.35, bureaucraticFriction: 0.65, capitalScarcity: 0.45, notes: ["Production-linked incentive schemes subsidise domestic manufacturing in targeted categories — check whether a segment qualifies before modelling margins.", "Regulation varies materially by state; a national average understates both the best and worst cases.", "Very large low-income population rewards volume and affordability over premium positioning."] } },
  { iso3: "PAK", iso2: "PK", name: "Pakistan", region: "South Asia", conditions: { gridReliability: 0.4, currencyInstability: 0.8, informality: 0.8, importDependence: 0.6, bureaucraticFriction: 0.7, capitalScarcity: 0.75, notes: ["Recurrent FX crises and load-shedding both favour local production and off-grid power."] } },
  { iso3: "BGD", iso2: "BD", name: "Bangladesh", region: "South Asia", conditions: { gridReliability: 0.6, currencyInstability: 0.65, informality: 0.8, importDependence: 0.5, bureaucraticFriction: 0.7, capitalScarcity: 0.7, notes: ["Economy is heavily concentrated in ready-made garments; most other categories are thinly served.", "Recurrent dollar shortages have delayed letters of credit for importers, favouring locally sourced inputs."] } },
  { iso3: "LKA", iso2: "LK", name: "Sri Lanka", region: "South Asia", conditions: { gridReliability: 0.65, currencyInstability: 0.7, informality: 0.7, importDependence: 0.65, bureaucraticFriction: 0.65, capitalScarcity: 0.8, notes: ["Following sovereign default, import restrictions and FX access remain the practical constraint on any import-dependent model.", "Tourism recovery is the main source of hard currency reaching domestic businesses."] } },
  { iso3: "NPL", iso2: "NP", name: "Nepal", region: "South Asia" },

  // ---- Americas ------------------------------------------------------------
  { iso3: "USA", iso2: "US", name: "United States", region: "North America", conditions: { gridReliability: 0.9, currencyInstability: 0.08, informality: 0.12, importDependence: 0.35, bureaucraticFriction: 0.3, capitalScarcity: 0.15, notes: ["Deepest risk-capital market in the world; financing is rarely the binding constraint on a good thesis.", "Regulation is largely state-level, so a national score hides wide variation.", "Most import gaps reflect deliberate cost arbitrage rather than missing capability — substitution needs a tariff, logistics or speed argument."] } },
  { iso3: "CAN", iso2: "CA", name: "Canada", region: "North America" },
  { iso3: "MEX", iso2: "MX", name: "Mexico", region: "Latin America & Caribbean", conditions: { gridReliability: 0.85, currencyInstability: 0.3, informality: 0.65, importDependence: 0.45, bureaucraticFriction: 0.55, capitalScarcity: 0.45, notes: ["Nearshoring into the US market is the dominant industrial tailwind, concentrating demand in industrial space, logistics and components.", "Northern border states and the south operate as effectively different economies."] } },
  { iso3: "BRA", iso2: "BR", name: "Brazil", region: "Latin America & Caribbean", conditions: { gridReliability: 0.85, currencyInstability: 0.45, informality: 0.6, importDependence: 0.25, bureaucraticFriction: 0.8, capitalScarcity: 0.5, notes: ["Tax and compliance complexity is a genuine barrier to entry — and therefore a moat for whoever absorbs it.", "High import tariffs make domestic production viable at scales that would not work elsewhere."] } },
  { iso3: "ARG", iso2: "AR", name: "Argentina", region: "Latin America & Caribbean", conditions: { gridReliability: 0.7, currencyInstability: 0.95, informality: 0.7, importDependence: 0.4, bureaucraticFriction: 0.75, capitalScarcity: 0.8, notes: ["Chronic inflation and capital controls push demand toward hard-currency and export-earning models."] } },
  { iso3: "CHL", iso2: "CL", name: "Chile", region: "Latin America & Caribbean" },
  { iso3: "COL", iso2: "CO", name: "Colombia", region: "Latin America & Caribbean", conditions: { gridReliability: 0.82, currencyInstability: 0.45, informality: 0.65, importDependence: 0.4, bureaucraticFriction: 0.55, capitalScarcity: 0.5, notes: ["Large informal economy means formalisation itself — payments, credit, invoicing — is a recurring opportunity.", "Terrain makes internal logistics expensive relative to coastal import costs."] } },
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
