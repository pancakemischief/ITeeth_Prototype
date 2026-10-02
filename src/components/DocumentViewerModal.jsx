import { useState, useRef } from "react";
import { generateCeuOdfPage1Svg, generateCeuOdfPage2Svg, svgToDataUri } from "../lib/ceuFormRenderer";
import { uploadOdfImageToStorage, to8DigitId } from "../lib/dentalService";

export default function DocumentViewerModal({
  record,
  patient,
  onClose = () => {},
  onSaveDocumentScan = null,
}) {
  const [activeTab, setActiveTab] = useState("page1"); // "page1" | "page2" | "odontogram" | "consent"
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef(null);

  const eightDigitId = to8DigitId(patient?.id || patient?.eightDigitId || record?.patientId || record?.id);
  const odfDetails = record?.odfDetails || patient?.odfData || {};

  // Formulate data object for renderer
  const docData = {
    name: patient?.name || record?.name || odfDetails?.name || "Patient Record",
    eightDigitId,
    birthDate: patient?.dateOfBirth || odfDetails?.birthDate || "",
    age: patient?.age || odfDetails?.age || "",
    sex: patient?.gender || odfDetails?.sex || "Male",
    homeAddress: patient?.homeAddress || odfDetails?.homeAddress || "Makati City",
    cellPhone: patient?.phone || odfDetails?.cellPhone || "",
    bloodPressure: odfDetails?.bloodPressure || "120/80",
    pulseRate: odfDetails?.pulseRate || "72 bpm",
    respiratoryRate: odfDetails?.respiratoryRate || "16 cpm",
    temperature: odfDetails?.temperature || "36.5 °C",
    chiefComplaints: odfDetails?.chiefComplaints || [record?.procedure || "Dental Examination"],
    historyOfPresentIllness: odfDetails?.historyOfPresentIllness || record?.notes || "",
    tentativeDiagnosis: odfDetails?.tentativeDiagnosis || [record?.procedure || "Dental Caries"],
    recommendedTreatmentPlan: odfDetails?.recommendedTreatmentPlan || ["Restorative Procedure", "Prophylaxis"],
    clinician: record?.clinician || patient?.clinician || "Student Clinician",
    examDate: record?.date || patient?.lastVisit || "10/01/2026",
  };

  // Resolve image URLs:
  // 1. If user uploaded a physical photo for Page 1, use it. Otherwise use the authentic CEU SVG.
  const customPage1Image =
    record?.rawScanUrl ||
    record?.page1ScanUrl ||
    odfDetails?.rawScanUrl ||
    odfDetails?.page1ScanUrl ||
    patient?.odfData?.rawScanUrl ||
    patient?.latestOdfScanUrl ||
    null;

  const defaultPage1Image = svgToDataUri(generateCeuOdfPage1Svg(docData));
  const page1Image = customPage1Image || defaultPage1Image;

  // 2. Page 2 image
  const customPage2Image =
    record?.rawScanPage2Url ||
    record?.page2ScanUrl ||
    odfDetails?.rawScanPage2Url ||
    odfDetails?.page2ScanUrl ||
    patient?.odfData?.rawScanPage2Url ||
    patient?.latestOdfPage2Url ||
    null;

  const defaultPage2Image = svgToDataUri(generateCeuOdfPage2Svg(docData));
  const page2Image = customPage2Image || defaultPage2Image;

  // 3. Cropped Odontogram ROI
  const odontogramImage =
    record?.odontogramCropUrl ||
    odfDetails?.odontogramCropUrl ||
    patient?.odfData?.odontogramCropUrl ||
    null;

  // 4. Cropped Consent ROI
  const consentImage =
    record?.consentCropUrl ||
    odfDetails?.consentCropUrl ||
    patient?.odfData?.consentCropUrl ||
    null;

  // Active image to display
  let currentImageSrc = page1Image;
  let isCustomUpload = !!customPage1Image;
  let currentTitle = "Oral Diagnosis Form & Odontogram (Page 1)";

  if (activeTab === "page2") {
    currentImageSrc = page2Image;
    isCustomUpload = !!customPage2Image;
    currentTitle = "Diagnostic Tests, Treatment Plan & Consent Form (Page 2)";
  } else if (activeTab === "odontogram") {
    currentImageSrc = odontogramImage || page1Image;
    isCustomUpload = !!odontogramImage;
    currentTitle = "Section C: Odontogram (Mouth Examination)";
  } else if (activeTab === "consent") {
    currentImageSrc = consentImage || page2Image;
    isCustomUpload = !!consentImage;
    currentTitle = "Dental Procedure Consent Form & Data Privacy Statement";
  }

  // Handle Upload / Replace of physical photo scan
  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage("Uploading document scan to Supabase storage...");

    try {
      const fileName = `doc_${activeTab}_${eightDigitId}_${Date.now()}.jpg`;
      const uploadedUrl = await uploadOdfImageToStorage(file, fileName);

      if (onSaveDocumentScan) {
        onSaveDocumentScan({
          recordId: record?.id,
          patientId: eightDigitId,
          type: activeTab,
          url: uploadedUrl,
        });
      }

      setUploadMessage("✓ Scanned document attached successfully!");
      setTimeout(() => setUploadMessage(""), 3000);
    } catch (err) {
      console.error("Document upload failed:", err);
      setUploadMessage("Upload error: Could not attach document.");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePrint = () => {
    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("Please allow popups to print documents.");
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>CEU Oral Diagnosis Form - Patient #${eightDigitId}</title>
          <style>
            body { margin: 0; padding: 20px; text-align: center; font-family: sans-serif; background: #fff; }
            img { max-width: 100%; height: auto; page-break-after: always; }
          </style>
        </head>
        <body>
          <h2>Centro Escolar University • School of Dentistry</h2>
          <h3>Oral Diagnosis Form - Patient #${eightDigitId} (${docData.name})</h3>
          <img src="${page1Image}" alt="ODF Page 1" />
          <img src="${page2Image}" alt="ODF Page 2" />
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1020px",
          height: "94vh",
          background: "#ffffff",
          borderRadius: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1.5px solid #cbd5e1",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar */}
        <div
          style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            padding: "16px 22px",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            borderBottom: "1px solid #334155",
          }}
        >
          {/* Title & Patient Tag */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #e91e77 0%, #ec206f 100%)",
                display: "grid",
                placeItems: "center",
                fontSize: "18px",
              }}
            >
              📄
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", letterSpacing: "-0.2px" }}>
                  Official Scanned Document
                </h3>
                <span
                  style={{
                    background: "rgba(233, 30, 119, 0.25)",
                    border: "1px solid #e91e77",
                    color: "#f472b6",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontFamily: "monospace",
                    fontSize: "11.5px",
                    fontWeight: "700",
                  }}
                >
                  ID: {eightDigitId}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                {docData.name} • {docData.examDate} • {docData.clinician}
              </p>
            </div>
          </div>

          {/* Action Tools: Zoom, Rotate, Print, Upload */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {/* Zoom Controls */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                padding: "2px 4px",
              }}
            >
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
                title="Zoom Out"
              >
                −
              </button>
              <span style={{ fontSize: "11.5px", color: "#cbd5e1", padding: "0 6px", minWidth: "42px", textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
                title="Zoom In"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                style={{
                  background: "transparent",
                  color: "#94a3b8",
                  border: "none",
                  padding: "4px 6px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
                title="Reset Zoom"
              >
                Reset
              </button>
            </div>

            {/* Rotate Button */}
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "8px",
                padding: "6px 10px",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              title="Rotate 90 degrees"
            >
              <span>↻ Rotate</span>
            </button>

            {/* Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
              title="Print Document"
            >
              <span>🖨️ Print</span>
            </button>

            {/* Upload/Replace Button */}
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isUploading}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
              }}
              title="Upload scanned photo from your device"
            >
              <span>{isUploading ? "Uploading..." : "📷 Upload Scan"}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                color: "#fff",
                fontSize: "15px",
                fontWeight: "700",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
              title="Close Viewer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Selection Bar */}
        <div
          style={{
            background: "#f8fafc",
            borderBottom: "1.5px solid #e2e8f0",
            padding: "8px 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setActiveTab("page1");
                setRotation(0);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "1.5px solid",
                borderColor: activeTab === "page1" ? "#e91e77" : "#cbd5e1",
                background: activeTab === "page1" ? "#fdf2f8" : "#ffffff",
                color: activeTab === "page1" ? "#e91e77" : "#475569",
                fontWeight: activeTab === "page1" ? "800" : "600",
                fontSize: "12.5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>📄 Page 1: ODF & Odontogram</span>
              {customPage1Image && <span style={{ fontSize: "10px", background: "#ecfdf5", color: "#059669", padding: "1px 5px", borderRadius: "4px" }}>PHOTO</span>}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("page2");
                setRotation(0);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "1.5px solid",
                borderColor: activeTab === "page2" ? "#e91e77" : "#cbd5e1",
                background: activeTab === "page2" ? "#fdf2f8" : "#ffffff",
                color: activeTab === "page2" ? "#e91e77" : "#475569",
                fontWeight: activeTab === "page2" ? "800" : "600",
                fontSize: "12.5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>📄 Page 2: Diagnostic & Consent</span>
              {customPage2Image && <span style={{ fontSize: "10px", background: "#ecfdf5", color: "#059669", padding: "1px 5px", borderRadius: "4px" }}>PHOTO</span>}
            </button>

            {odontogramImage && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("odontogram");
                  setRotation(0);
                }}
                style={{
                  padding: "7px 14px",
                  borderRadius: "8px",
                  border: "1.5px solid",
                  borderColor: activeTab === "odontogram" ? "#0284c7" : "#cbd5e1",
                  background: activeTab === "odontogram" ? "#f0f9ff" : "#ffffff",
                  color: activeTab === "odontogram" ? "#0284c7" : "#475569",
                  fontWeight: activeTab === "odontogram" ? "800" : "600",
                  fontSize: "12.5px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>🦷 Odontogram ROI</span>
              </button>
            )}

            {consentImage && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("consent");
                  setRotation(0);
                }}
                style={{
                  padding: "7px 14px",
                  borderRadius: "8px",
                  border: "1.5px solid",
                  borderColor: activeTab === "consent" ? "#059669" : "#cbd5e1",
                  background: activeTab === "consent" ? "#ecfdf5" : "#ffffff",
                  color: activeTab === "consent" ? "#059669" : "#475569",
                  fontWeight: activeTab === "consent" ? "800" : "600",
                  fontSize: "12.5px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>✍️ Signed Consent ROI</span>
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
            {uploadMessage ? (
              <span style={{ color: "#059669", fontWeight: "700" }}>{uploadMessage}</span>
            ) : isCustomUpload ? (
              <span style={{ color: "#0284c7", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px" }}>
                <span>📷 Uploaded Photographic Document</span>
              </span>
            ) : (
              <span style={{ color: "#64748b", display: "flex", alignItems: "center", gap: "4px" }}>
                <span>🏛️ Official CEU School of Dentistry Archive Form</span>
              </span>
            )}
          </div>
        </div>

        {/* Document Display Canvas */}
        <div
          style={{
            flex: 1,
            backgroundColor: "#475569",
            overflow: "auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px",
            position: "relative",
          }}
        >
          <div
            style={{
              transition: "transform 0.15s ease",
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: "top center",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.45)",
              borderRadius: "8px",
              overflow: "hidden",
              backgroundColor: "#ffffff",
              maxWidth: "100%",
            }}
          >
            <img
              src={currentImageSrc}
              alt={currentTitle}
              style={{
                display: "block",
                maxWidth: "760px",
                width: "100%",
                height: "auto",
                background: "#ffffff",
              }}
            />
          </div>
        </div>

        {/* Modal Bottom Status Footer */}
        <div
          style={{
            padding: "12px 24px",
            background: "#ffffff",
            borderTop: "1.5px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12.5px",
            color: "#475569",
          }}
        >
          <div>
            <strong>Document Target:</strong> {currentTitle} • CEU Dentistry Infirmary
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleUploadClick}
              style={{
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                color: "#1e293b",
              }}
            >
              📷 Attach New Image Scan
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "#0f172a",
                color: "#ffffff",
                border: "none",
                padding: "6px 18px",
                borderRadius: "8px",
                fontSize: "12.5px",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              Close Viewer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
