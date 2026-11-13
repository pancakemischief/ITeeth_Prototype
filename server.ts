import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import type {
  AnalyzeOperationOutput,
  AnalyzeResultOutput,
  DocumentFieldOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import { runAnalyzeWithPaddle, PADDLE_MODEL_ID } from "./src/lib/paddleOdfEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max scan size
  },
});

function isAzureConfigured(): {
  configured: boolean;
  endpoint: string;
  key: string;
  modelId: string;
} {
  const endpoint = (process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT || "").trim();
  const key = (process.env.AZURE_DOC_INTELLIGENCE_KEY || "").trim();
  const modelId = (process.env.AZURE_DOC_INTELLIGENCE_MODEL_ID || "prebuilt-layout").trim();

  const isPlaceholder =
    !endpoint ||
    !key ||
    endpoint.includes("your-resource-name") ||
    key.includes("your_azure_document_intelligence_api_key");

  return {
    configured: !isPlaceholder,
    endpoint,
    key,
    modelId: modelId || "prebuilt-layout",
  };
}

interface SimplifiedField {
  type: string;
  content: string;
  value: unknown;
  confidence: number | null;
}

function simplifyDocumentFields(
  fields: Record<string, DocumentFieldOutput> | undefined
): Record<string, SimplifiedField> {
  if (!fields) return {};
  const result: Record<string, SimplifiedField> = {};

  for (const [name, field] of Object.entries(fields)) {
    let extractedValue: unknown = field.content ?? "";

    if (field.valueString !== undefined) {
      extractedValue = field.valueString;
    } else if (field.valueSelectionMark !== undefined) {
      extractedValue = field.valueSelectionMark;
    } else if (field.valueNumber !== undefined) {
      extractedValue = field.valueNumber;
    } else if (field.valueInteger !== undefined) {
      extractedValue = field.valueInteger;
    } else if (field.valueDate !== undefined) {
      extractedValue = field.valueDate;
    } else if (field.valueArray !== undefined) {
      extractedValue = field.valueArray.map((item) => {
        if (item.valueObject) {
          return simplifyDocumentFields(item.valueObject);
        }
        return item.valueString ?? item.content ?? "";
      });
    } else if (field.valueObject !== undefined) {
      extractedValue = simplifyDocumentFields(field.valueObject);
    }

    result[name] = {
      type: field.type,
      content: field.content ?? "",
      value: extractedValue,
      confidence: field.confidence ?? null,
    };
  }

  return result;
}

interface SimplifiedTable {
  rowCount: number;
  columnCount: number;
  rows: string[][];
}

function simplifyTables(tables: DocumentTableOutput[] | undefined): SimplifiedTable[] {
  if (!tables || tables.length === 0) return [];

  return tables.map((table) => {
    const rowCount = table.rowCount || 0;
    const columnCount = table.columnCount || 0;
    const grid: string[][] = Array.from({ length: rowCount }, () =>
      Array.from({ length: columnCount }, () => "")
    );

    for (const cell of table.cells || []) {
      const r = cell.rowIndex ?? 0;
      const c = cell.columnIndex ?? 0;
      if (r >= 0 && r < rowCount && c >= 0 && c < columnCount) {
        grid[r][c] = (cell.content || "").trim();
      }
    }

    return {
      rowCount,
      columnCount,
      rows: grid,
    };
  });
}

async function runAnalyzeWithAzure(
  endpoint: string,
  key: string,
  modelId: string,
  base64Source: string
): Promise<AnalyzeResultOutput | undefined> {
  const client = DocumentIntelligence(endpoint, { key });

  // Attempt with keyValuePairs add-on feature when using prebuilt-layout.
  // If the Azure resource is on Free Tier (F0) and rejects add-on features, retry cleanly without add-on features.
  const useKeyValueFeature = modelId === "prebuilt-layout";

  let initialResponse = await client
    .path("/documentModels/{modelId}:analyze", modelId)
    .post({
      contentType: "application/json",
      body: { base64Source },
      ...(useKeyValueFeature
        ? {
            queryParameters: {
              features: ["keyValuePairs"],
            },
          }
        : {}),
    });

  if (isUnexpected(initialResponse) && useKeyValueFeature) {
    // Retry standard prebuilt-layout without paid add-on features (supports F0 Free Tier seamlessly)
    initialResponse = await client
      .path("/documentModels/{modelId}:analyze", modelId)
      .post({
        contentType: "application/json",
        body: { base64Source },
      });
  }

  if (isUnexpected(initialResponse)) {
    const errMsg =
      initialResponse.body?.error?.message ||
      `Azure Document Intelligence request failed with status ${initialResponse.status}`;
    throw new Error(errMsg);
  }

  const poller = getLongRunningPoller(client, initialResponse);
  const completed = await poller.pollUntilDone();
  const body = completed.body as AnalyzeOperationOutput;
  return body.analyzeResult;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // Check OCR provider readiness without exposing credentials
  app.get("/api/ocr/status", (_req: Request, res: Response) => {
    const { configured, modelId } = isAzureConfigured();
    res.json({
      provider: configured ? "azure-document-intelligence" : "paddle-ocr-fallback",
      configured,
      azureConfigured: configured,
      fallbackProvider: "paddle-ocr",
      fallbackModelId: PADDLE_MODEL_ID,
      modelId: configured ? modelId : PADDLE_MODEL_ID,
    });
  });

  // Analyze uploaded ODF scan (Page 1, Page 2, or 2-page PDF) via Azure AI Document Intelligence
  app.post(
    "/api/ocr/azure-odf",
    upload.single("document"),
    async (req: Request, res: Response) => {
      const { configured, endpoint, key, modelId } = isAzureConfigured();

      if (!configured) {
        res.status(503).json({
          configured: false,
          error:
            "Azure Document Intelligence is not configured on the server. Set AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY in .env.",
        });
        return;
      }

      if (!req.file || !req.file.buffer) {
        res.status(400).json({
          configured: true,
          error: "No document image or PDF uploaded.",
        });
        return;
      }

      try {
        const pageNumber = Number(req.body?.pageNumber || 1);
        const base64Source = req.file.buffer.toString("base64");
        const analyzeResult = await runAnalyzeWithAzure(
          endpoint,
          key,
          modelId,
          base64Source
        );

        const primaryDoc = analyzeResult?.documents?.[0];
        const fields = simplifyDocumentFields(primaryDoc?.fields);
        const keyValuePairs = (analyzeResult?.keyValuePairs || []).map((kv) => ({
          key: (kv.key?.content || "").trim(),
          value: (kv.value?.content || "").trim(),
          confidence: kv.confidence ?? null,
        }));
        const tables = simplifyTables(analyzeResult?.tables);
        const pages = (analyzeResult?.pages || []).map((p) => ({
          pageNumber: p.pageNumber,
          lines: (p.lines || []).map((l) => l.content),
          selectionMarks: (p.selectionMarks || []).map((sm) => ({
            state: sm.state,
            confidence: sm.confidence,
            polygon: sm.polygon,
          })),
        }));

        res.json({
          configured: true,
          provider: "azure-document-intelligence",
          modelId,
          requestedPage: pageNumber,
          content: analyzeResult?.content || "",
          fields,
          keyValuePairs,
          tables,
          pages,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unexpected error calling Azure Document Intelligence.";
        console.error("[Azure Document Intelligence Error]:", message);
        res.status(500).json({
          configured: true,
          error: message,
        });
      }
    }
  );

  // Fallback OCR via server-side PaddleOCR (PP-OCRv5 English ONNX Runtime)
  app.post(
    "/api/ocr/paddle-odf",
    upload.single("document"),
    async (req: Request, res: Response) => {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({
          provider: "paddle-ocr",
          error: "No document image uploaded.",
        });
        return;
      }

      if (req.file.mimetype === "application/pdf") {
        res.status(415).json({
          provider: "paddle-ocr",
          error: "PaddleOCR fallback processes image scans (JPG/PNG). Configure Azure Document Intelligence for multi-page PDFs.",
        });
        return;
      }

      try {
        const pageNumber = Number(req.body?.pageNumber || 1);
        const paddleResult = await runAnalyzeWithPaddle(req.file.buffer, pageNumber);
        res.json(paddleResult);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unexpected error running PaddleOCR fallback.";
        console.error("[PaddleOCR Fallback Error]:", message);
        res.status(500).json({
          provider: "paddle-ocr",
          error: message,
        });
      }
    }
  );

  // Mount Vite middleware in development, or serve static production build
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*splat}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    const { configured, modelId } = isAzureConfigured();
    console.log(
      `[i-Teeth Server] Running on http://localhost:${PORT} | Azure Document Intelligence: ${
        configured ? `ACTIVE (${modelId})` : `NOT CONFIGURED (using PaddleOCR ${PADDLE_MODEL_ID} fallback)`
      }`
    );
  });
}

startServer();
