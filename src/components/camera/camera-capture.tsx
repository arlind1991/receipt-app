"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { getLastUsedFolderId, setLastUsedFolderId } from "@/lib/local-storage";
import {
  analyzeCapturedReceipt,
  fetchFolders,
  saveReceipt,
  triggerReceiptProcessing,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type { FolderRow, ReceiptDetectionResult } from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";

type CaptureStage = "camera" | "detecting" | "choose" | "saving";

export function CameraCapture() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(UNSORTED_FOLDER_ID);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stage, setStage] = useState<CaptureStage>("camera");
  const [detection, setDetection] = useState<ReceiptDetectionResult | null>(null);

  const hasSupabase = useMemo(() => !supabaseEnvError, []);
  const isOverlayVisible = stage === "detecting" || stage === "saving";

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
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

    setFolders(result.data);
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

  async function handleCapture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );

    if (!blob) {
      setErrorMessage("Could not capture the receipt image. Please try again.");
      return;
    }

    stopCamera();
    setNextPreviewUrl(URL.createObjectURL(blob));
    setCapturedBlob(blob);
    setDetection(null);
    setErrorMessage(null);
    setStage("detecting");

    const detectionResult = await analyzeCapturedReceipt(blob);
    if (
      detectionResult.ok &&
      detectionResult.data.detectedMultiple &&
      detectionResult.data.receiptCount > 1
    ) {
      setDetection(detectionResult.data);
      setStage("choose");
      return;
    }

    await saveAndProcessBlobs([blob]);
  }

  async function saveAndProcessBlobs(blobs: Blob[]) {
    if (!hasSupabase) {
      setErrorMessage(supabaseEnvError);
      setStage("camera");
      return;
    }

    setStage("saving");

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
        const saveResult = await saveReceipt({
          blob,
          folderId,
          userId: user.id,
        });

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

      router.push(
        receiptIds.length > 1
          ? `/receipts/${firstReceiptId}?fromScan=1&batch=${receiptIds.length}`
          : `/receipts/${firstReceiptId}?fromScan=1`,
      );
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
    await saveAndProcessBlobs([croppedBlob]);
  }

  async function handleScanAllDetectedReceipts() {
    if (!capturedBlob || !detection) {
      return;
    }

    const blobs = await Promise.all(
      detection.boxes.map((box) => cropReceiptBlob(capturedBlob, box)),
    );
    await saveAndProcessBlobs(blobs);
  }

  async function resetCaptureFlow() {
    revokePreviewUrl();
    setNextPreviewUrl(null);
    setCapturedBlob(null);
    setDetection(null);
    setIsCameraReady(false);
    setStage("camera");
    await startCamera();
  }

  return (
    <main className="app-shell relative overflow-hidden">
      <section className="relative mx-auto flex min-h-[calc(100dvh-30px)] w-full max-w-md flex-col justify-between">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">Camera First</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Snap a receipt</h1>
          </div>
          <button
            type="button"
            onClick={() => router.push("/receipts")}
            className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
          >
            Library
          </button>
        </div>

        <div className="relative flex-1">
          <div className="camera-grid glass-panel relative h-full min-h-[62dvh] overflow-hidden rounded-[32px]">
            {!previewUrl ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full min-h-[62dvh] w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="pointer-events-none absolute top-4 left-4 rounded-full bg-black/28 px-3 py-2 text-xs text-white/72">
                  {isCameraReady ? "Live camera" : "Starting camera"}
                </div>
              </>
            ) : (
              <>
                <img
                  src={previewUrl}
                  alt="Receipt preview"
                  className="h-full min-h-[62dvh] w-full object-cover"
                />
                {detection?.detectedMultiple ? (
                  <div className="pointer-events-none absolute inset-0">
                    {detection.boxes.map((box, index) => (
                      <div
                        key={`${box.index}-${index}`}
                        className="absolute rounded-[22px] border-2 border-[rgba(143,247,208,0.82)] bg-[rgba(143,247,208,0.08)] shadow-[0_0_0_1px_rgba(4,10,18,0.45)]"
                        style={{
                          height: `${box.height * 100}%`,
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.width * 100}%`,
                        }}
                      >
                        <span className="absolute top-2 left-2 rounded-full bg-[rgba(4,10,18,0.82)] px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-white">
                          Receipt {index + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            {isOverlayVisible ? (
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,9,17,0.12),rgba(4,9,17,0.66))]">
                <div className="scan-sweep absolute inset-x-6 top-8 bottom-8 rounded-[26px] border border-[rgba(143,247,208,0.22)]" />
                <div className="absolute inset-x-8 bottom-8 rounded-[28px] border border-white/10 bg-[rgba(4,10,18,0.66)] p-5 backdrop-blur-xl">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="scan-spinner h-4 w-4 rounded-full border-2 border-[rgba(143,247,208,0.24)] border-t-[var(--accent)]" />
                    <p className="text-base font-semibold text-white">
                      {stage === "detecting" ? "Scanning receipt..." : "Saving and scanning..."}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-[var(--text-secondary)]">
                    {stage === "detecting"
                      ? "Checking whether the photo contains one receipt or multiple separate receipts."
                      : "Uploading the receipt and reading merchant, total, VAT, and receipt date."}
                  </p>
                </div>
              </div>
            ) : null}

            {stage === "choose" && detection ? (
              <div className="absolute inset-x-3 bottom-3 rounded-[28px] border border-white/10 bg-[rgba(4,10,18,0.78)] p-4 backdrop-blur-xl">
                <p className="text-base font-semibold text-white">
                  We found {detection.receiptCount} receipts
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Choose one receipt to scan now, or split and scan each one separately.
                </p>
                <div className="mt-4 grid gap-3">
                  {detection.boxes.slice(0, 3).map((box, index) => (
                    <button
                      key={`${box.index}-${index}`}
                      type="button"
                      onClick={() => void handleSelectDetectedReceipt(index)}
                      className="w-full rounded-full border border-white/12 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8"
                    >
                      Scan receipt {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void handleScanAllDetectedReceipts()}
                    className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)]"
                  >
                    Scan all separately
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetCaptureFlow()}
                    className="w-full rounded-full border border-white/12 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8"
                  >
                    Retake photo
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="absolute right-3 bottom-3 left-3">
              <StatusBanner tone="error" message={errorMessage} />
            </div>
          ) : null}
        </div>

        <section className="mt-4 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => void handleCapture()}
            disabled={!isCameraReady || stage !== "camera"}
            className="capture-ring flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-full border border-white/24 bg-white/6 p-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="h-16 w-16 rounded-full bg-[var(--accent)] shadow-[0_0_40px_rgba(143,247,208,0.55)]" />
          </button>
          <p className="text-center text-sm text-[var(--text-secondary)]">
            {selectedFolderId !== UNSORTED_FOLDER_ID
              ? `Saving into ${folders.find((folder) => folder.id === selectedFolderId)?.name ?? "your last folder"} after capture.`
              : "Frame the receipt and tap once to capture, scan, and open the result."}
          </p>
        </section>
      </section>

      <canvas ref={canvasRef} className="hidden" />
      <AppNav />
    </main>
  );
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
    canvas.toBlob(
      (croppedBlob) => resolve(croppedBlob ?? blob),
      "image/jpeg",
      0.92,
    );
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
