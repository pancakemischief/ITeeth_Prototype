import { PaddleOcrService, V5_EN_MOBILE_MODEL } from "ppu-paddle-ocr";

export const PADDLE_MODEL_ID = "pp-ocrv5-en-mobile";

let serviceInstance = null;
let initPromise = null;

/**
 * Lazily initialize and reuse a singleton PaddleOcrService (PP-OCRv5 English)
 * so ONNX sessions stay warm across uploads.
 */
export async function getPaddleOcrService() {
  if (serviceInstance && serviceInstance.isInitialized()) {
    return serviceInstance;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const instance = new PaddleOcrService({
        model: V5_EN_MOBILE_MODEL,
        debugging: {
          verbose: false,
          debug: false,
        },
        detection: {
          maxSideLength: "auto",
          paddingVertical: 0.45,
          paddingHorizontal: 0.65,
          minimumAreaThreshold: 8,
        },
        recognition: {
          strategy: "per-line",
          minimumConfidence: 0.35,
          spaceRecovery: true,
        },
      });
      await instance.initialize();
      serviceInstance = instance;
      return instance;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }

  return initPromise;
}

const KNOWN_LABELS_RX =
  /^(Name|Home\s*Address|Birth\s*Date|Birthdate|Age|Sex|Ht\.?|Height|Wt\.?|Weight|Civil\s*Status|Home\s*Tel\.?\s*No\.?|Cell\s*Phone\s*No\.?|Nationality|Occupation|Religion|Allergy,?\s*specify|Other\s*Il+nesses|Medications\s*currently\s*taking|Previous\s*Extraction|If\s*yes\s*when\??|Head|Eyes|TMJ|Blood\s*Pressure|BP|Pulse\s*Rate|Respiratory\s*Rate|Temperature|Radiographic\s*Interpretation|Examined\s*by|Date|Clinic\s*Level|C\.?I\.?'?s?\s*Remarks)\s*:?/i;

const PAST_HISTORY_LINE_RX =
  /(rheumatic|myocardial|cerebro|asthma|diabetes|liver\s*disease|stomach\s*ulcer|kidney\s*disease|pregnancy|\bt\.?\s*b\.?\b|hypertension|hypotension)/i;

/**
 * Build synthetic key-value pairs and Past History table rows from spatially sorted
 * PaddleOCR line boxes so `parseAzurePage1ToForm` and `parseAzurePage2ToForm`
 * populate fields reliably without Azure Document Intelligence.
 */
function extractStructuredDataFromLines(lines) {
  const lineStrings = [];
  const keyValuePairs = [];
  const pastHistoryRows = [];

  for (const line of lines) {
    const tokens = (line || [])
      .map((item) => ({
        text: String(item?.text || "").trim(),
        confidence: typeof item?.confidence === "number" ? item.confidence : null,
        box: item?.box || { x: 0, y: 0, width: 0, height: 0 },
      }))
      .filter((t) => t.text.length > 0);

    if (tokens.length === 0) continue;

    const lineText = tokens.map((t) => t.text).join(" ");
    lineStrings.push(lineText);

    // 1. Extract inline "Label: Value" or adjacent label + value tokens on the same row
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const inlineMatch = tok.text.match(
        /^(Name|Home\s*Address|Birth\s*Date|Birthdate|Age|Sex|Ht\.?|Height|Wt\.?|Weight|Civil\s*Status|Home\s*Tel\.?\s*No\.?|Cell\s*Phone\s*No\.?|Nationality|Occupation|Religion|Allergy,?\s*specify|Other\s*Il+nesses|Medications\s*currently\s*taking|Blood\s*Pressure|BP|Pulse\s*Rate|Respiratory\s*Rate|Temperature|Radiographic\s*Interpretation|Examined\s*by|Clinic\s*Level|C\.?I\.?'?s?\s*Remarks)\s*[:-]\s*(.+)$/i
      );

      if (inlineMatch) {
        const key = inlineMatch[1].trim();
        const val = inlineMatch[2].replace(/^_+|_+$/g, "").trim();
        if (val && !KNOWN_LABELS_RX.test(val)) {
          keyValuePairs.push({ key, value: val, confidence: tok.confidence });
        }
        continue;
      }

      const labelOnlyMatch = tok.text.match(KNOWN_LABELS_RX);
      if (labelOnlyMatch && i + 1 < tokens.length) {
        const nextTok = tokens[i + 1];
        if (!KNOWN_LABELS_RX.test(nextTok.text)) {
          const cleanVal = nextTok.text.replace(/^_+|_+$/g, "").trim();
          if (cleanVal) {
            keyValuePairs.push({
              key: labelOnlyMatch[1].trim(),
              value: cleanVal,
              confidence: nextTok.confidence,
            });
          }
        }
      }
    }

    // 2. Preserve Past History grid rows as structured table cells (adjacent marks stay next to conditions)
    if (PAST_HISTORY_LINE_RX.test(lineText)) {
      pastHistoryRows.push(tokens.map((t) => t.text));
    }
  }

  const tables = [];
  if (pastHistoryRows.length > 0) {
    const maxCols = Math.max(...pastHistoryRows.map((r) => r.length));
    tables.push({
      rowCount: pastHistoryRows.length,
      columnCount: maxCols,
      rows: pastHistoryRows.map((r) => [
        ...r,
        ...Array.from({ length: Math.max(0, maxCols - r.length) }, () => ""),
      ]),
    });
  }

  return {
    content: lineStrings.join("\n"),
    lineStrings,
    keyValuePairs,
    tables,
  };
}

/**
 * Run local server-side PaddleOCR (PP-OCRv5) on an uploaded image Buffer.
 */
export async function runAnalyzeWithPaddle(buffer, pageNumber = 1) {
  const service = await getPaddleOcrService();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const raw = await service.recognize(ab);

  const lines = Array.isArray(raw?.lines) ? raw.lines : [];
  const structured = extractStructuredDataFromLines(lines);

  return {
    configured: true,
    provider: "paddle-ocr",
    modelId: PADDLE_MODEL_ID,
    requestedPage: pageNumber,
    confidence: typeof raw?.confidence === "number" ? raw.confidence : null,
    content: structured.content || raw?.text || "",
    fields: {},
    keyValuePairs: structured.keyValuePairs,
    tables: structured.tables,
    pages: [
      {
        pageNumber,
        lines: structured.lineStrings,
        selectionMarks: [],
      },
    ],
  };
}
