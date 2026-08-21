/**
 * Source registry.
 *
 * Every number this engine shows should be traceable to something a reader can
 * go and check. This file is that mapping: who publishes it, how often, under
 * what licence, and — where it matters — what the dataset does *not* say.
 *
 * The last part is the point. "Access to electricity: 100%" is a true World
 * Bank figure for Lebanon and a useless measure of whether the power stays on,
 * because it counts connections rather than supply. Recording that limitation
 * next to the source is what stops the number being used as if it meant
 * something it does not.
 */

export type SourceKind = "live" | "reference";

export interface Source {
  id: string;
  name: string;
  publisher: string;
  url: string;
  /** How often the upstream data changes. */
  cadence: string;
  licence: string;
  kind: SourceKind;
  /** What this engine uses it for. */
  drives: string;
  /** Known limitation, where one materially affects interpretation. */
  caveat?: string;
}

export const SOURCES: Record<string, Source> = {
  worldbank: {
    id: "worldbank",
    name: "World Development Indicators",
    publisher: "World Bank Open Data",
    url: "https://data.worldbank.org",
    cadence: "Annual, with a one to three year publication lag",
    licence: "CC BY 4.0",
    kind: "live",
    drives:
      "GDP, GDP per capita, population, growth, inflation, unemployment, sector value added, urbanisation, internet penetration, remittances, tourist arrivals, and the derived condition dimensions below.",
    caveat:
      "Indicators lag reality, sometimes badly. Each observation is shown with its own year and is discounted by age in the confidence score rather than being treated as current.",
  },
  comtrade: {
    id: "comtrade",
    name: "UN Comtrade international trade statistics",
    publisher: "United Nations Statistics Division",
    url: "https://comtradeplus.un.org",
    cadence: "Annual, published roughly one year in arrears",
    licence: "UN Comtrade terms of use; keyless preview endpoint used here",
    kind: "live",
    drives:
      "Every observed import gap: imports and exports per HS code against the world, the three-year trajectory baseline, and the 6-digit product drill-down.",
    caveat:
      "Reported by the importing country's own customs administration, so quality varies by reporter. Rows are pinned to fully aggregated flows — without that, richer reporters break the same trade out by partner, transport mode and customs procedure, which inflates totals several-fold.",
  },
  osm: {
    id: "osm",
    name: "OpenStreetMap, queried via Overpass",
    publisher: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
    cadence: "Continuous community mapping",
    licence: "Open Database License (ODbL)",
    kind: "live",
    drives:
      "Observed premise density — the only signal here that counts competitors directly rather than inferring them from trade balances.",
    caveat:
      "Mapping completeness varies enormously by country, so raw counts are meaningless across borders. Each segment is measured as a share of its own country's mapped commercial premises, which cancels completeness within a country. Countries with fewer than 500 mapped premises are omitted rather than estimated.",
  },
  wcoHs: {
    id: "wcoHs",
    name: "Harmonized System nomenclature (HS 2022)",
    publisher: "World Customs Organization",
    url: "https://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools/hs-nomenclature-2022-edition.aspx",
    cadence: "Revised every five years",
    licence: "WCO nomenclature; descriptions bundled in-repo",
    kind: "reference",
    drives:
      "The 3,817-line product index that turns a segment's coarse chapters into individual customs lines.",
  },
  enterpriseSurveys: {
    id: "enterpriseSurveys",
    name: "Enterprise Surveys",
    publisher: "World Bank Group",
    url: "https://www.enterprisesurveys.org",
    cadence: "Country rounds every few years, not synchronised",
    licence: "World Bank terms of use",
    kind: "reference",
    drives:
      "The research basis for the grid reliability dimension — firm-reported outage frequency and duration, and generator ownership.",
    caveat:
      "Country rounds are years apart and the outage indicators are not exposed through the main indicator API, so this informs a researched value rather than being read live.",
  },
  ilostat: {
    id: "ilostat",
    name: "ILOSTAT informal economy statistics",
    publisher: "International Labour Organization",
    url: "https://ilostat.ilo.org/topics/informality/",
    cadence: "Annual where national labour force surveys allow",
    licence: "ILO terms of use",
    kind: "reference",
    drives: "The research basis for the informality dimension.",
    caveat:
      "Country coverage through the World Bank indicator API is too sparse to derive a value automatically, so informality is a researched constant.",
  },
  imfWeo: {
    id: "imfWeo",
    name: "World Economic Outlook database",
    publisher: "International Monetary Fund",
    url: "https://www.imf.org/en/Publications/WEO",
    cadence: "Twice a year, April and October",
    licence: "IMF terms of use",
    kind: "reference",
    drives:
      "Cross-check for inflation and exchange-rate conditions, and the basis for currency judgements in countries where the official rate diverges from the market rate.",
    caveat:
      "Where a parallel exchange rate exists, the official rate understates instability. This is why the currency dimension blends depreciation with inflation rather than trusting either alone.",
  },
  bReady: {
    id: "bReady",
    name: "Business Ready (B-READY)",
    publisher: "World Bank Group",
    url: "https://www.worldbank.org/en/businessready",
    cadence: "Annual; first report published October 2024",
    licence: "World Bank terms of use",
    kind: "reference",
    drives: "The research basis for the bureaucratic friction dimension.",
    caveat:
      "B-READY replaced Doing Business, which the World Bank discontinued in September 2021 after an external review found data irregularities. Country coverage is still expanding, so this informs a researched value rather than being read live.",
  },
  segmentModel: {
    id: "segmentModel",
    name: "Segment structural economics",
    publisher: "This repository",
    url: "https://github.com/",
    cadence: "Versioned with the code",
    licence: "In-repo",
    kind: "reference",
    drives:
      "Per-segment capital intensity, regulatory burden, infrastructure dependency, import substitutability, labour intensity, income elasticity and time to first revenue — the coefficients the feasibility term is built from.",
    caveat:
      "These are curated judgements, not measurements, and are labelled as such wherever they affect a score. They describe the segment in general rather than a specific country.",
  },
};

export const SOURCE_LIST = Object.values(SOURCES);
