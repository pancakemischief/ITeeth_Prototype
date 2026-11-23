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
function extractStructuredDataFromLines(lines, pageNumber = 1) {
  const lineStrings = [];
  const keyValuePairs = [];
  const fields = {};
  const pastHistoryRows = [];
  const allTokens = [];

  for (const line of lines) {
    const tokens = (line || [])
      .map((item) => {
        const box = item?.box || { x: 0, y: 0, width: 0, height: 0 };
        return {
          text: String(item?.text || "").trim(),
          confidence: typeof item?.confidence === "number" ? item.confidence : 0.85,
          box,
          cx: box.x + box.width / 2,
          cy: box.y + box.height / 2,
          right: box.x + box.width,
        };
      })
      .filter((t) => t.text.length > 0);

    if (tokens.length === 0) continue;

    const lineText = tokens.map((t) => t.text).join(" ");
    lineStrings.push(lineText);
    allTokens.push(...tokens);

    if (PAST_HISTORY_LINE_RX.test(lineText)) {
      pastHistoryRows.push(tokens.map((t) => t.text));
    }
  }

  // 1. Spatial 2D Key-Value Pairing (handles handwriting slightly above/below label baseline)
  const labelTokens = allTokens.filter((t) => KNOWN_LABELS_RX.test(t.text));
  const valueCandidates = allTokens.filter((t) => !KNOWN_LABELS_RX.test(t.text));

  for (const labelTok of labelTokens) {
    // Check if value is already inline inside the same box (e.g., "Age: 24")
    const inlineMatch = labelTok.text.match(/^([^:-]+)\s*[:-]\s*(.+)$/);
    if (inlineMatch && inlineMatch[2].trim()) {
      keyValuePairs.push({
        key: inlineMatch[1].trim(),
        value: inlineMatch[2].replace(/^_+|_+$/g, "").trim(),
        confidence: labelTok.confidence,
      });
      continue;
    }

    const cleanKey = labelTok.text.match(KNOWN_LABELS_RX)?.[1]?.trim() || labelTok.text;
    const yTolerance = Math.max(22, labelTok.box.height * 1.4);

    // Find tokens to the right of this label on roughly the same horizontal band,
    // stopping before the next label on that same band
    const nextLabelOnSameRow = labelTokens
      .filter(
        (other) =>
          other !== labelTok &&
          other.box.x > labelTok.right &&
          Math.abs(other.cy - labelTok.cy) <= yTolerance
      )
      .sort((a, b) => a.box.x - b.box.x)[0];

    const maxRightX = nextLabelOnSameRow ? nextLabelOnSameRow.box.x : Infinity;

    const matchedValues = valueCandidates
      .filter(
        (cand) =>
          cand.box.x >= labelTok.right - 12 &&
          cand.cx < maxRightX &&
          Math.abs(cand.cy - labelTok.cy) <= yTolerance
      )
      .sort((a, b) => a.box.x - b.box.x);

    if (matchedValues.length > 0) {
      const joinedVal = matchedValues
        .map((v) => v.text.replace(/^_+|_+$/g, "").trim())
        .filter(Boolean)
        .join(" ");

      if (joinedVal) {
        keyValuePairs.push({
          key: cleanKey,
          value: joinedVal,
          confidence: matchedValues[0].confidence,
        });
      }
    }
  }

  // 2. Page 2: Extract numbered Tentative Diagnosis & Recommended Treatment Plan items
  if (pageNumber === 2) {
    const diagHeader = allTokens.find((t) => /Tentative\s*Diagnosis/i.test(t.text));
    const planHeader = allTokens.find((t) => /Recommended\s*Treatment\s*Plan/i.test(t.text));

    if (diagHeader) {
      const diagItems = valueCandidates
        .filter(
          (t) =>
            t.cy > diagHeader.cy &&
            t.cy < diagHeader.cy + 260 &&
            (!planHeader || t.cx < planHeader.box.x - 10)
        )
        .sort((a, b) => a.cy - b.cy)
        .slice(0, 6);

      diagItems.forEach((item, idx) => {
        const cleaned = item.text.replace(/^[1-6][.)]\s*/, "").trim();
        if (cleaned) fields[`TentativeDiagnosis${idx + 1}`] = { value: cleaned };
      });
    }

    if (planHeader) {
      const planItems = valueCandidates
        .filter(
          (t) =>
            t.cy > planHeader.cy &&
            t.cy < planHeader.cy + 260 &&
            t.box.x >= planHeader.box.x - 20
        )
        .sort((a, b) => a.cy - b.cy)
        .slice(0, 6);

      planItems.forEach((item, idx) => {
        const cleaned = item.text.replace(/^[1-6][.)]\s*/, "").trim();
        if (cleaned) fields[`RecommendedTreatmentPlan${idx + 1}`] = { value: cleaned };
      });
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
    fields,
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
