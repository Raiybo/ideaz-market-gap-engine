/**
 * Pull the text out of an uploaded document.
 *
 * Decks are the common case and they are hostile to this: text is scattered
 * across positioned boxes, so extraction returns fragments in reading order
 * that is only approximately reading order. That is fine for what happens next
 * — matching against a taxonomy is a bag-of-words problem, not a comprehension
 * one — but it does mean the extracted text should never be shown back to the
 * user as if it were the document.
 */

export interface ExtractedDocument {
  text: string;
  pages: number;
  /** Characters of usable text. A scanned deck returns almost none. */
  length: number;
}

/** Larger than any realistic deck, small enough to bound memory. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Below this, the document is almost certainly scanned images rather than
 * text — and no amount of matching will rescue it, so it is worth saying so
 * plainly rather than returning a confident match on twelve words.
 */
const MIN_USABLE_CHARS = 220;

export class ExtractionError extends Error {}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  // Imported lazily: pdf.js is large and only the validate route needs it.
  const { extractText, getDocumentProxy } = await import("unpdf");

  let text: string;
  let pages: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    pages = pdf.numPages;
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } catch (err) {
    throw new ExtractionError(
      `Could not read that PDF (${err instanceof Error ? err.message : "unknown error"}). If it is password-protected or exported oddly, try re-exporting it.`,
    );
  }

  const cleaned = text
    // Decks routinely produce runs of whitespace between positioned boxes.
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < MIN_USABLE_CHARS) {
    throw new ExtractionError(
      `Only ${cleaned.length} characters of text came out of ${pages} page${pages === 1 ? "" : "s"}. That usually means the file is scanned images rather than text, which this cannot read. Export it with selectable text, or paste the idea in as text instead.`,
    );
  }

  return { text: cleaned, pages, length: cleaned.length };
}
