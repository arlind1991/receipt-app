"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { getLastUsedFolderId, setLastUsedFolderId } from "@/lib/local-storage";
import {
  analyzeCapturedReceipt,
  fetchFolders,
  fetchReceiptDetail,
  saveReceipt,
  triggerReceiptProcessing,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type {
  ReceiptDetail,
  ReceiptDetectionResult,
} from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";
const LIVE_DETECTION_INTERVAL_MS = 1800;
const PROCESSING_POLL_MS = 1150;

type CaptureStage = "camera" | "detecting" | "choose" | "processing";
type ProcessingFieldKey = "merchant" | "amount" | "currency" | "date" | "time";
type ProcessingFields = Record<ProcessingFieldKey, string>;

const emptyProcessingFields: ProcessingFields = {
  amount: "Scanning...",
  currency: "Scanning...",
  date: "Scanning...",
  merchant: "Scanning...",
  time: "Scanning...",
};

export function CameraCapture() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const liveDetectionBusyRef = useRef(false);
  const processingTimeoutRef = useRef<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState(UNSORTED_FOLDER_ID);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stage, setStage] = useState<CaptureStage>("camera");
  const [detection, setDetection] = useState<ReceiptDetectionResult | null>(null);
  const [liveDetection, setLiveDetection] = useState<ReceiptDetectionResult | null>(null);
  const [processingFields, setProcessingFields] = useState<ProcessingFields>(emptyProcessingFields);
  const [processingLabel, setProcessingLabel] = useState("Preparing scan");

  const hasSupabase = useMemo(() => !supabaseEnvError, []);
  const focusedDetectionBox = useMemo(() => {
    const source = stage === "camera" ? liveDetection : detection;
    const [first] = source?.boxes ?? [];

    if (!first) {
      return null;
    }

    if (stage === "camera" && first.width >= 0.98 && first.height >= 0.98) {
      return null;
    }

    return first;
  }, [detection, liveDetection, stage]);

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
      revokePreviewUrl();
      if (processingTimeoutRef.current) {
        window.clearTimeout(processingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasSupabase) {
      setErrorMessage(supabaseEnvError);
      return;
    }

    void loadFolders();
  }, [hasSupabase]);

  function revokePreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }

  function setNextPreviewUrl(nextUrl: string | null) {
    revokePreviewUrl();
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  }

  async function loadFolders() {
    const user = await ensureBrowserSession();
    if (!user) {
      return;
    }

    const result = await fetchFolders(user.id);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    const lastUsedFolderId = getLastUsedFolderId();
    setSelectedFolderId(
      lastUsedFolderId && result.data.some((folder) => folder.id === lastUsedFolderId)
        ? lastUsedFolderId
        : UNSORTED_FOLDER_ID,
    );
    setErrorMessage(null);
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1440 },
          height: { ideal: 1920 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setErrorMessage(null);
      setIsCameraReady(true);
      setStage("camera");
    } catch {
      setErrorMessage(
        "Camera access was blocked. Allow camera permission on your phone to capture receipts.",
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  const captureFrameBlob = useCallback(async (quality = 0.82, maxDimension = 1280) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return null;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return null;
    }

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }, []);

  const detectLiveReceipt = useCallback(async () => {
    if (liveDetectionBusyRef.current || stage !== "camera") {
      return;
    }

    liveDetectionBusyRef.current = true;

    try {
      const blob = await captureFrameBlob(0.62, 960);
      if (!blob) {
        return;
      }

      const detectionResult = await analyzeCapturedReceipt(blob);
      if (detectionResult.ok) {
        setLiveDetection(detectionResult.data);
      }
    } finally {
      liveDetectionBusyRef.current = false;
    }
  }, [captureFrameBlob, stage]);

  useEffect(() => {
    if (stage !== "camera" || !isCameraReady) {
      return;
    }

    void detectLiveReceipt();

    const intervalId = window.setInterval(() => {
      void detectLiveReceipt();
    }, LIVE_DETECTION_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [detectLiveReceipt, isCameraReady, stage]);

  async function handleCapture() {
    const blob = await captureFrameBlob(0.92, 1600);
    if (!blob) {
      return;
    }

    stopCamera();
    setCapturedBlob(blob);
    setDetection(null);
    setLiveDetection(null);
    setErrorMessage(null);
    setStage("detecting");
    setNextPreviewUrl(URL.createObjectURL(blob));

    const detectionResult = await analyzeCapturedReceipt(blob);
    setDetection(detectionResult.ok ? detectionResult.data : null);

    if (
      detectionResult.ok &&
      detectionResult.data.detectedMultiple &&
      detectionResult.data.receiptCount > 1
    ) {
      setStage("choose");
      return;
    }

    const primaryBox = detectionResult.ok ? detectionResult.data.boxes[0] : null;
    const singleBlob = primaryBox ? await cropReceiptBlob(blob, primaryBox) : blob;
    await startProcessingFlow([singleBlob], { batchCount: 1 });
  }

  async function startProcessingFlow(blobs: Blob[], options: { batchCount: number }) {
    if (!hasSupabase) {
      setErrorMessage(supabaseEnvError);
      setStage("camera");
      return;
    }

    if (options.batchCount > 1) {
      await saveAndOpenReview(blobs, options.batchCount);
      return;
    }

    const [primaryBlob] = blobs;
    if (!primaryBlob) {
      return;
    }

    setNextPreviewUrl(URL.createObjectURL(primaryBlob));
    setProcessingFields(emptyProcessingFields);
    setProcessingLabel("Preparing scan");
    setStage("processing");

    try {
      const user = await ensureBrowserSession();
      if (!user) {
        throw new Error("You need to sign in before saving receipts.");
      }

      let folderId: string | null = null;
      if (selectedFolderId !== UNSORTED_FOLDER_ID) {
        folderId = selectedFolderId;
        setLastUsedFolderId(selectedFolderId);
      }

      setProcessingLabel("Uploading secure copy");
      const saveResult = await saveReceipt({
        blob: primaryBlob,
        folderId,
        userId: user.id,
      });
      if (!saveResult.ok) {
        throw new Error(saveResult.error);
      }

      const receiptId = saveResult.data.id;
      setProcessingLabel("Reading receipt");
      const processResult = await triggerReceiptProcessing(receiptId);
      if (!processResult.ok) {
        throw new Error(processResult.error);
      }

      const receipt = await pollForProcessedReceipt(receiptId, user.id);
      setProcessingLabel("Filling fields");
      await animateProcessingFields(receipt);
      setProcessingLabel("Ready to review");
      await wait(260);
      router.push(`/receipts/${receiptId}?fromScan=1`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      await resetCaptureFlow();
    }
  }

  async function pollForProcessedReceipt(receiptId: string, userId: string) {
    while (true) {
      const detail = await fetchReceiptDetail(receiptId, userId);
      if (!detail.ok) {
        throw new Error(detail.error);
      }

      if (detail.data.status !== "processing") {
        return detail.data;
      }

      setProcessingLabel("Extracting receipt data");
      await wait(PROCESSING_POLL_MS);
    }
  }

  async function saveAndOpenReview(blobs: Blob[], batchCount: number) {
    setProcessingLabel("Saving receipts");
    setStage("processing");
    setProcessingFields(emptyProcessingFields);

    try {
      const user = await ensureBrowserSession();
      if (!user) {
        throw new Error("You need to sign in before saving receipts.");
      }

      let folderId: string | null = null;
      if (selectedFolderId !== UNSORTED_FOLDER_ID) {
        folderId = selectedFolderId;
        setLastUsedFolderId(selectedFolderId);
      }

      const receiptIds: string[] = [];
      for (const blob of blobs) {
        const saveResult = await saveReceipt({ blob, folderId, userId: user.id });
        if (!saveResult.ok) {
          throw new Error(saveResult.error);
        }

        receiptIds.push(saveResult.data.id);
        await triggerReceiptProcessing(saveResult.data.id);
      }

      const firstReceiptId = receiptIds[0];
      if (!firstReceiptId) {
        throw new Error("No receipt was created.");
      }

      router.push(`/receipts/${firstReceiptId}?fromScan=1&batch=${batchCount}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      await resetCaptureFlow();
    }
  }

  async function handleSelectDetectedReceipt(index: number) {
    if (!capturedBlob || !detection?.boxes[index]) {
      return;
    }

    const croppedBlob = await cropReceiptBlob(capturedBlob, detection.boxes[index]);
    await startProcessingFlow([croppedBlob], { batchCount: 1 });
  }

  async function handleScanAllDetectedReceipts() {
    if (!capturedBlob || !detection) {
      return;
    }

    const blobs = await Promise.all(
      detection.boxes.map((box) => cropReceiptBlob(capturedBlob, box)),
    );
    await startProcessingFlow(blobs, { batchCount: blobs.length });
  }

  async function resetCaptureFlow() {
    if (processingTimeoutRef.current) {
      window.clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }

    revokePreviewUrl();
    setNextPreviewUrl(null);
    setCapturedBlob(null);
    setDetection(null);
    setLiveDetection(null);
    setProcessingFields(emptyProcessingFields);
    setProcessingLabel("Preparing scan");
    setIsCameraReady(false);
    setStage("camera");
    await startCamera();
  }

  async function animateProcessingFields(receipt: ReceiptDetail) {
    const nextFields = buildProcessingFields(receipt);
    const order: ProcessingFieldKey[] = ["merchant", "amount", "currency", "date", "time"];

    for (const key of order) {
      await wait(190);
      setProcessingFields((current) => ({ ...current, [key]: nextFields[key] }));
    }
  }

  const showProcessing = stage === "processing";
  const showCameraControls = stage === "camera";
  const showDetectionStatus =
    stage === "camera" && focusedDetectionBox && liveDetection && !liveDetection.detectedMultiple;

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-black text-white">
      <section className="relative h-full w-full overflow-hidden">
        {previewUrl ? (
          <img src={previewUrl} alt="Receipt preview" className="h-full w-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}

        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,var(--camera-top-fade),transparent_24%,transparent_68%,var(--camera-bottom-fade))]" />

        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+16px)] left-4 z-20">
          <button
            type="button"
            onClick={() => router.push("/receipts")}
            className="flex items-center gap-2 rounded-full border border-white/14 bg-black/26 px-4 py-2 text-sm font-medium text-white shadow-[0_10px_28px_rgba(0,0,0,0.24)] backdrop-blur-md transition hover:bg-black/40"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ←
            </span>
            Gallery
          </button>
        </div>

        {showDetectionStatus ? (
          <div className="absolute top-[calc(env(safe-area-inset-top,0px)+18px)] left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#5ff0a7]/30 bg-[rgba(6,18,14,0.62)] px-4 py-2 text-xs font-medium tracking-[0.08em] text-[#8ff7d0] backdrop-blur-md">
            Receipt detected
          </div>
        ) : null}

        {focusedDetectionBox ? <ReceiptGuide box={focusedDetectionBox} /> : null}

        {stage === "detecting" ? <DetectingOverlay /> : null}
        {showProcessing ? (
          <ProcessingOverlay
            fields={processingFields}
            imageUrl={previewUrl}
            label={processingLabel}
          />
        ) : null}

        {stage === "choose" && detection ? (
          <div className="absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+28px)] z-30 rounded-[30px] border border-white/14 bg-[rgba(4,10,18,0.76)] p-5 shadow-[0_26px_70px_rgba(0,0,0,0.34)] backdrop-blur-xl">
            <p className="text-lg font-semibold text-white">
              {detection.receiptCount} receipts found
            </p>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Choose one receipt, or split them into separate scans.
            </p>
            <div className="mt-4 grid gap-3">
              {detection.boxes.slice(0, 4).map((box, index) => (
                <button
                  key={`${box.index}-${index}`}
                  type="button"
                  onClick={() => void handleSelectDetectedReceipt(index)}
                  className="w-full rounded-full border border-white/16 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16"
                >
                  Scan receipt {index + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void handleScanAllDetectedReceipts()}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)]"
              >
                Scan all separately
              </button>
              <button
                type="button"
                onClick={() => void resetCaptureFlow()}
                className="w-full rounded-full border border-white/16 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16"
              >
                Retake photo
              </button>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+120px)] left-4 z-30">
            <StatusBanner tone="error" message={errorMessage} />
          </div>
        ) : null}

        {showCameraControls ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-[calc(env(safe-area-inset-bottom,0px)+28px)]">
            <div className="pointer-events-auto flex flex-col items-center gap-4">
              <button
                type="button"
                aria-label="Capture receipt"
                onClick={() => void handleCapture()}
                disabled={!isCameraReady}
                className="flex h-[5.9rem] w-[5.9rem] items-center justify-center rounded-full border border-white/34 bg-white/10 p-[0.42rem] shadow-[0_22px_52px_rgba(0,0,0,0.36)] backdrop-blur-md transition active:scale-[0.98] disabled:opacity-40"
              >
                <span className="capture-ring flex h-full w-full items-center justify-center rounded-full bg-white shadow-[0_0_32px_rgba(255,255,255,0.36)]">
                  <span className="h-[4.3rem] w-[4.3rem] rounded-full border border-[#d9dee7] bg-white" />
                </span>
              </button>
              <div className="h-5 w-24 rounded-full bg-white/6 backdrop-blur-sm" />
            </div>
          </div>
        ) : null}
      </section>

      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}

function ReceiptGuide({
  box,
}: {
  box: { height: number; width: number; x: number; y: number };
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-[28px] border-2 border-[#5ff0a7] bg-[rgba(95,240,167,0.08)] shadow-[0_0_0_1px_rgba(95,240,167,0.28),0_0_28px_rgba(95,240,167,0.18)]"
      style={{
        height: `${box.height * 100}%`,
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
      }}
    >
      <div className="absolute top-3 left-3 h-8 w-8 rounded-tl-[18px] border-t-[3px] border-l-[3px] border-[#9ff9d7]" />
      <div className="absolute top-3 right-3 h-8 w-8 rounded-tr-[18px] border-t-[3px] border-r-[3px] border-[#9ff9d7]" />
      <div className="absolute bottom-3 left-3 h-8 w-8 rounded-bl-[18px] border-b-[3px] border-l-[3px] border-[#9ff9d7]" />
      <div className="absolute right-3 bottom-3 h-8 w-8 rounded-br-[18px] border-r-[3px] border-b-[3px] border-[#9ff9d7]" />
    </div>
  );
}

function DetectingOverlay() {
  return (
    <div className="absolute inset-0 z-30 bg-[rgba(3,8,16,0.34)]">
      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-[32px] border border-white/12 bg-[rgba(4,10,18,0.7)] p-6 text-center backdrop-blur-xl">
        <div className="scan-spinner mx-auto h-11 w-11 rounded-full border-2 border-white/14 border-t-[#5ff0a7]" />
        <p className="mt-4 text-lg font-semibold text-white">Finding receipt edges</p>
        <p className="mt-2 text-sm text-white/68">Isolating the receipt for a cleaner scan.</p>
      </div>
    </div>
  );
}

function ProcessingOverlay({
  fields,
  imageUrl,
  label,
}: {
  fields: ProcessingFields;
  imageUrl: string | null;
  label: string;
}) {
  return (
    <div className="absolute inset-0 z-30 bg-[rgba(3,8,16,0.4)]">
      <div className="absolute inset-x-5 top-[calc(env(safe-area-inset-top,0px)+74px)] bottom-[calc(env(safe-area-inset-bottom,0px)+30px)] flex flex-col justify-center gap-5">
        <div className="relative overflow-hidden rounded-[34px] border border-[#5ff0a7]/24 bg-[rgba(4,10,18,0.8)] shadow-[0_26px_70px_rgba(0,0,0,0.34)]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Captured receipt"
              className="aspect-[4/5] w-full object-contain bg-[rgba(8,16,28,0.95)]"
            />
          ) : (
            <div className="aspect-[4/5] w-full bg-[rgba(8,16,28,0.95)]" />
          )}
          <div className="scan-sweep absolute inset-4 rounded-[26px] border border-[#5ff0a7]/30" />
        </div>

        <div className="rounded-[30px] border border-white/12 bg-[rgba(4,10,18,0.78)] p-5 backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.18em] text-[#5ff0a7]">Processing</p>
          <p className="mt-2 text-lg font-semibold text-white">{label}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ProcessingField label="Merchant" value={fields.merchant} />
            <ProcessingField label="Amount" value={fields.amount} />
            <ProcessingField label="Currency" value={fields.currency} />
            <ProcessingField label="Date" value={fields.date} />
            <ProcessingField label="Time" value={fields.time} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessingField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/6 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/52">{label}</p>
      <p className="mt-2 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function buildProcessingFields(receipt: ReceiptDetail): ProcessingFields {
  const receiptTime = parseReceiptTime(receipt.parsed_ocr_json);

  return {
    amount: receipt.total_amount != null ? `${receipt.total_amount.toFixed(2)}` : "Not found",
    currency: receipt.currency ?? "Not found",
    date: receipt.receipt_date ?? "Not found",
    merchant: receipt.merchant_name ?? "Not found",
    time: receiptTime ?? "Not found",
  };
}

function parseReceiptTime(parsedJson: string | null) {
  if (!parsedJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(parsedJson) as {
      heuristic_debug?: { receipt_time?: string | null };
    };
    return parsed.heuristic_debug?.receipt_time ?? null;
  } catch {
    return null;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function cropReceiptBlob(
  blob: Blob,
  box: { height: number; width: number; x: number; y: number },
) {
  const image = await loadImageFromBlob(blob);
  const canvas = document.createElement("canvas");
  const padding = 0.02;
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const width = Math.min(1 - x, box.width + padding * 2);
  const height = Math.min(1 - y, box.height + padding * 2);

  const sourceX = Math.round(image.width * x);
  const sourceY = Math.round(image.height * y);
  const sourceWidth = Math.max(1, Math.round(image.width * width));
  const sourceHeight = Math.max(1, Math.round(image.height * height));

  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return blob;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((croppedBlob) => resolve(croppedBlob ?? blob), "image/jpeg", 0.92);
  });
}

function loadImageFromBlob(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not load captured receipt image."));
    };
    image.src = objectUrl;
  });
}
