"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { getLastUsedFolderId, setLastUsedFolderId } from "@/lib/local-storage";
import {
  analyzeCapturedReceipt,
  fetchFolders,
  fetchReceiptDetail,
  saveReceipt,
  triggerReceiptProcessing,
  updateReceiptFields,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type {
  FolderRow,
  ReceiptDetail,
  ReceiptDetectionResult,
  ReceiptEditableFields,
} from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";
const LIVE_DETECTION_INTERVAL_MS = 1800;
const PROCESSING_POLL_MS = 1150;
const FIELD_REVEAL_MS = 320;
const POST_REVEAL_PAUSE_MS = 1300;
const DEFAULT_CAMERA_ZOOM = 1.3;

type CaptureMode = "single" | "multiple" | "two-sided";
type CaptureStage = "camera" | "processing" | "review" | "batch-complete";
type ProcessingFieldKey = "merchant" | "amount" | "currency" | "date" | "time";
type ProcessingFields = Record<ProcessingFieldKey, string>;

type CapturedFrame = {
  blob: Blob;
  previewUrl: string;
};

type ZoomCapableMediaTrackCapabilities = MediaTrackCapabilities & {
  zoom?: {
    max: number;
    min: number;
  };
};

const emptyProcessingFields: ProcessingFields = {
  amount: "Scanning...",
  currency: "Scanning...",
  date: "Scanning...",
  merchant: "Scanning...",
  time: "Scanning...",
};

const emptyEditValues = {
  category: "",
  currency: "",
  folder_id: "",
  merchant_name: "",
  receipt_date: "",
  total_amount: "",
  vat_amount: "",
};

export function CameraCapture() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveDetectionBusyRef = useRef(false);
  const multipleFramesRef = useRef<CapturedFrame[]>([]);
  const twoSidedFramesRef = useRef<{ back: CapturedFrame | null; front: CapturedFrame | null }>({
    back: null,
    front: null,
  });
  const reviewPreviewUrlRef = useRef<string | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(UNSORTED_FOLDER_ID);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>("single");
  const [stage, setStage] = useState<CaptureStage>("camera");
  const [liveDetection, setLiveDetection] = useState<ReceiptDetectionResult | null>(null);
  const [processingFields, setProcessingFields] = useState<ProcessingFields>(emptyProcessingFields);
  const [processingLabel, setProcessingLabel] = useState("Preparing scan");
  const [processingSubLabel, setProcessingSubLabel] = useState<string | null>(null);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [batchCompletedCount, setBatchCompletedCount] = useState(0);
  const [multipleFrames, setMultipleFrames] = useState<CapturedFrame[]>([]);
  const [twoSidedFrames, setTwoSidedFrames] = useState<{
    back: CapturedFrame | null;
    front: CapturedFrame | null;
  }>({ back: null, front: null });
  const [editValues, setEditValues] = useState(emptyEditValues);
  const [useCssZoomFallback, setUseCssZoomFallback] = useState(false);
  const [cameraGuidance, setCameraGuidance] = useState("Fill the frame");

  const hasSupabase = useMemo(() => !supabaseEnvError, []);
  const focusedDetectionBox = useMemo(() => {
    const [first] = liveDetection?.boxes ?? [];
    if (!first || first.width >= 0.98 || first.height >= 0.98) {
      return null;
    }
    return first;
  }, [liveDetection]);
  const videoScale = useCssZoomFallback ? DEFAULT_CAMERA_ZOOM : 1;

  useEffect(() => {
    multipleFramesRef.current = multipleFrames;
  }, [multipleFrames]);

  useEffect(() => {
    twoSidedFramesRef.current = twoSidedFrames;
  }, [twoSidedFrames]);

  useEffect(() => {
    reviewPreviewUrlRef.current = reviewPreviewUrl;
  }, [reviewPreviewUrl]);

  useEffect(() => {
    if (!hasSupabase) {
      setErrorMessage(supabaseEnvError);
      return;
    }

    void loadFolders();
  }, [hasSupabase]);

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

  const applyPreferredCameraZoom = useCallback(async (stream: MediaStream) => {
    const [track] = stream.getVideoTracks();
    if (!track) {
      setUseCssZoomFallback(true);
      return;
    }

    const capabilities = track.getCapabilities?.() as ZoomCapableMediaTrackCapabilities | undefined;
    const zoomCapability = capabilities?.zoom;
    if (!zoomCapability || typeof zoomCapability.min !== "number" || typeof zoomCapability.max !== "number") {
      setUseCssZoomFallback(true);
      return;
    }

    const safeZoom = Math.min(
      Math.max(DEFAULT_CAMERA_ZOOM, zoomCapability.min, 1),
      zoomCapability.max,
    );

    try {
      await track.applyConstraints({
        advanced: [{ zoom: safeZoom } as MediaTrackConstraintSet],
      });
    } catch {
      setUseCssZoomFallback(true);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2160 },
          height: { ideal: 3840 },
        },
      });

      streamRef.current = stream;
      setUseCssZoomFallback(false);
      await applyPreferredCameraZoom(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setErrorMessage(null);
      setIsCameraReady(true);
    } catch {
      setErrorMessage(
        "Camera access was blocked. Allow camera permission on your phone to capture receipts.",
      );
    }
  }, [applyPreferredCameraZoom]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
      revokeFrameUrls(multipleFramesRef.current);
      revokeFrameUrls([twoSidedFramesRef.current.front, twoSidedFramesRef.current.back]);
      if (reviewPreviewUrlRef.current) {
        URL.revokeObjectURL(reviewPreviewUrlRef.current);
      }
    };
  }, [startCamera]);

  function revokeFrameUrls(frames: Array<CapturedFrame | null | undefined>) {
    for (const frame of frames) {
      if (frame?.previewUrl) {
        URL.revokeObjectURL(frame.previewUrl);
      }
    }
  }

  function resetTransientState(nextMode?: CaptureMode) {
    revokeFrameUrls(multipleFrames);
    revokeFrameUrls([twoSidedFrames.front, twoSidedFrames.back]);
    if (reviewPreviewUrl) {
      URL.revokeObjectURL(reviewPreviewUrl);
    }

    setMultipleFrames([]);
    setTwoSidedFrames({ back: null, front: null });
    setReviewPreviewUrl(null);
    setReceipt(null);
    setProcessingFields(emptyProcessingFields);
    setProcessingLabel("Preparing scan");
    setProcessingSubLabel(null);
    setEditValues(emptyEditValues);
    setBatchCompletedCount(0);
    setLiveDetection(null);
    setErrorMessage(null);
    setStage("camera");
    if (nextMode) {
      setMode(nextMode);
    }
  }

  const captureFrameBlob = useCallback(async (quality = 0.9, maxDimension?: number) => {
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

    const scale = maxDimension ? Math.min(1, maxDimension / Math.max(width, height)) : 1;
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

  useEffect(() => {
    if (stage !== "camera" || mode !== "single") {
      setCameraGuidance(mode === "two-sided" ? "Move closer for readable text" : "Capture when ready");
      return;
    }

    if (!focusedDetectionBox) {
      setCameraGuidance("Fill the frame");
      return;
    }

    if (focusedDetectionBox.width < 0.52 || focusedDetectionBox.height < 0.52) {
      setCameraGuidance("Move closer");
      return;
    }

    if (focusedDetectionBox.width > 0.9 || focusedDetectionBox.height > 0.9) {
      setCameraGuidance("Hold steady");
      return;
    }

    setCameraGuidance("Fill the frame");
  }, [focusedDetectionBox, mode, stage]);

  function applyReceipt(nextReceipt: ReceiptDetail, previewUrl: string | null) {
    setReceipt(nextReceipt);
    setReviewPreviewUrl(previewUrl);
    setEditValues({
      category: nextReceipt.category ?? "",
      currency: nextReceipt.currency ?? "",
      folder_id: nextReceipt.folder_id ?? "",
      merchant_name: nextReceipt.merchant_name ?? "",
      receipt_date: nextReceipt.receipt_date ?? "",
      total_amount: nextReceipt.total_amount != null ? String(nextReceipt.total_amount) : "",
      vat_amount: nextReceipt.vat_amount != null ? String(nextReceipt.vat_amount) : "",
    });
  }

  async function handleCapture() {
    const blob = await captureFrameBlob();
    if (!blob) {
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    const frame = { blob, previewUrl };
    setErrorMessage(null);
    setLiveDetection(null);

    if (mode === "single") {
      await processSingleFlow(frame);
      return;
    }

    if (mode === "multiple") {
      setMultipleFrames((current) => [...current, frame]);
      return;
    }

    setTwoSidedFrames((current) => {
      if (!current.front) {
        return { ...current, front: frame };
      }
      return { ...current, back: frame };
    });
  }

  async function processSingleFlow(frame: CapturedFrame) {
    setStage("processing");
    setReceipt(null);
    setReviewPreviewUrl(frame.previewUrl);
    await processReceiptBlob(frame.blob, {
      previewUrl: frame.previewUrl,
      processingTitle: "Scanning receipt",
      processingProgress: null,
    });
  }

  const processTwoSidedFlow = useEffectEvent(async (front: CapturedFrame, back: CapturedFrame) => {
    setStage("processing");
    setReceipt(null);

    try {
      setProcessingLabel("Combining both sides");
      setProcessingSubLabel("Scanning front and back as one receipt");
      const combinedBlob = await combineFramesVertically(front.blob, back.blob);
      const combinedPreviewUrl = URL.createObjectURL(combinedBlob);
      setReviewPreviewUrl(combinedPreviewUrl);
      await processReceiptBlob(combinedBlob, {
        previewUrl: combinedPreviewUrl,
        processingTitle: "Scanning 2-sided receipt",
        processingProgress: "Front and back captured",
      });
    } finally {
      revokeFrameUrls([front, back]);
      setTwoSidedFrames({ back: null, front: null });
    }
  });

  useEffect(() => {
    if (mode !== "two-sided" || !twoSidedFrames.front || !twoSidedFrames.back) {
      return;
    }

    void processTwoSidedFlow(twoSidedFrames.front, twoSidedFrames.back);
  }, [mode, twoSidedFrames.back, twoSidedFrames.front]);

  async function handleFinishMultiple() {
    if (multipleFrames.length === 0) {
      return;
    }

    setStage("processing");
    setBatchCompletedCount(0);

    try {
      for (let index = 0; index < multipleFrames.length; index += 1) {
        const frame = multipleFrames[index];
        if (!frame) {
          continue;
        }

        setReviewPreviewUrl(frame.previewUrl);
        await processReceiptBlob(frame.blob, {
          previewUrl: frame.previewUrl,
          processingTitle: `Processing ${index + 1} of ${multipleFrames.length}`,
          processingProgress: `${index + 1} / ${multipleFrames.length} receipts`,
          skipReview: true,
        });
        setBatchCompletedCount(index + 1);
      }

      setStage("batch-complete");
      setProcessingLabel("All receipts processed");
      setProcessingSubLabel(`${multipleFrames.length} receipts are ready in your gallery`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setStage("camera");
    } finally {
      revokeFrameUrls(multipleFrames);
      setMultipleFrames([]);
    }
  }

  async function processReceiptBlob(
    blob: Blob,
    options: {
      previewUrl: string;
      processingProgress: string | null;
      processingTitle: string;
      skipReview?: boolean;
    },
  ) {
    if (!hasSupabase) {
      throw new Error(supabaseEnvError ?? "Supabase environment variables are missing.");
    }

    const user = await ensureBrowserSession();
    if (!user) {
      throw new Error("You need to sign in before saving receipts.");
    }

    let folderId: string | null = null;
    if (selectedFolderId !== UNSORTED_FOLDER_ID) {
      folderId = selectedFolderId;
      setLastUsedFolderId(selectedFolderId);
    }

    setProcessingFields(emptyProcessingFields);
    setProcessingLabel("Saving receipt");
    setProcessingSubLabel(options.processingProgress);

    const saveResult = await saveReceipt({
      blob,
      folderId,
      userId: user.id,
    });
    if (!saveResult.ok) {
      throw new Error(saveResult.error);
    }

    const receiptId = saveResult.data.id;
    setProcessingLabel(options.processingTitle);

    const processResult = await triggerReceiptProcessing(receiptId);
    if (!processResult.ok) {
      throw new Error(processResult.error);
    }

    const processedReceipt = await pollForProcessedReceipt(
      receiptId,
      user.id,
      options.processingProgress,
    );
    setProcessingLabel("Populating fields");
    await animateProcessingFields(processedReceipt);
    setProcessingLabel("Review ready");
    await wait(POST_REVEAL_PAUSE_MS);

    if (options.skipReview) {
      return;
    }

    applyReceipt(processedReceipt, options.previewUrl);
    setStage("review");
  }

  async function pollForProcessedReceipt(
    receiptId: string,
    userId: string,
    progressLabel: string | null,
  ) {
    while (true) {
      const detail = await fetchReceiptDetail(receiptId, userId);
      if (!detail.ok) {
        throw new Error(detail.error);
      }

      if (detail.data.status !== "processing") {
        return detail.data;
      }

      setProcessingLabel("Extracting receipt data");
      setProcessingSubLabel(progressLabel);
      await wait(PROCESSING_POLL_MS);
    }
  }

  async function animateProcessingFields(nextReceipt: ReceiptDetail) {
    const nextFields = buildProcessingFields(nextReceipt);
    const order: ProcessingFieldKey[] = ["merchant", "amount", "currency", "date", "time"];

    for (const key of order) {
      await wait(FIELD_REVEAL_MS);
      setProcessingFields((current) => ({ ...current, [key]: nextFields[key] }));
    }
  }

  function updateEditField(field: keyof typeof editValues, value: string) {
    setEditValues((current) => ({ ...current, [field]: value }));
  }

  async function handleDone() {
    if (!receipt) {
      router.replace("/receipts");
      router.refresh();
      return;
    }

    const isDirty = !matchesReceiptEditValues(receipt, editValues);
    if (isDirty) {
      setIsSavingEdits(true);
      const payload: ReceiptEditableFields = {
        category: editValues.category.trim() || null,
        currency: editValues.currency.trim().toUpperCase() || null,
        folder_id: editValues.folder_id || null,
        merchant_name: editValues.merchant_name.trim() || null,
        notes: null,
        receipt_date: editValues.receipt_date || null,
        total_amount: editValues.total_amount ? Number(editValues.total_amount) : null,
        vat_amount: editValues.vat_amount ? Number(editValues.vat_amount) : null,
      };

      const result = await updateReceiptFields(receipt.id, payload);
      setIsSavingEdits(false);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
    }

    router.replace("/receipts");
    router.refresh();
  }

  const isDirty = useMemo(() => {
    if (!receipt) {
      return false;
    }
    return !matchesReceiptEditValues(receipt, editValues);
  }, [editValues, receipt]);

  const multipleCount = multipleFrames.length;
  const twoSidedPrompt = !twoSidedFrames.front ? "Capture front" : "Capture back";

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-black text-white">
      <section className="relative h-full w-full overflow-hidden">
        {reviewPreviewUrl && stage !== "camera" ? (
          <img
            src={reviewPreviewUrl}
            alt="Receipt preview"
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{
              transform: `scale(${videoScale})`,
              transformOrigin: "center center",
            }}
          />
        )}

        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,var(--camera-top-fade),transparent_22%,transparent_68%,var(--camera-bottom-fade))]" />

        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+16px)] left-4 z-20">
          <button
            type="button"
            onClick={() => router.push("/receipts")}
            className="flex items-center gap-2 rounded-full border border-white/14 bg-black/28 px-4 py-2 text-sm font-medium text-white shadow-[0_10px_28px_rgba(0,0,0,0.24)] backdrop-blur-md transition hover:bg-black/40"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ←
            </span>
            Receipts
          </button>
        </div>

        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+14px)] left-1/2 z-20 w-[min(92vw,23rem)] -translate-x-1/2">
          <ModeSelector
            activeMode={mode}
            onChangeMode={(nextMode) => {
              if (nextMode === mode) {
                return;
              }
              resetTransientState(nextMode);
            }}
          />
        </div>

        {stage === "camera" && mode === "single" && focusedDetectionBox ? (
          <ReceiptGuide box={focusedDetectionBox} />
        ) : null}

        {stage === "camera" && mode === "single" && focusedDetectionBox ? (
          <div className="absolute top-[calc(env(safe-area-inset-top,0px)+74px)] left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#5ff0a7]/30 bg-[rgba(6,18,14,0.62)] px-4 py-2 text-xs font-medium tracking-[0.08em] text-[#8ff7d0] backdrop-blur-md">
            Receipt detected
          </div>
        ) : null}

        {stage === "camera" ? (
          <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+138px)] z-20 flex justify-center px-6">
            <div className="rounded-full border border-white/12 bg-black/26 px-4 py-2 text-sm font-medium text-white/84 backdrop-blur-md">
              {cameraGuidance}
            </div>
          </div>
        ) : null}

        {stage === "processing" ? (
          <ProcessingOverlay
            fields={processingFields}
            imageUrl={reviewPreviewUrl}
            label={processingLabel}
            progress={processingSubLabel}
          />
        ) : null}

        {stage === "review" && receipt ? (
          <InlineReviewPanel
            editValues={editValues}
            errorMessage={errorMessage}
            folders={folders}
            isDirty={isDirty}
            isSavingEdits={isSavingEdits}
            notes={receipt.notes}
            onChangeField={updateEditField}
            onDone={() => void handleDone()}
            onRetake={() => resetTransientState()}
            previewUrl={reviewPreviewUrl}
          />
        ) : null}

        {stage === "batch-complete" ? (
          <BatchCompleteOverlay
            count={batchCompletedCount}
            onDone={() => {
              router.replace("/receipts");
              router.refresh();
            }}
          />
        ) : null}

        {errorMessage && stage !== "review" ? (
          <div className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+124px)] left-4 z-30">
            <StatusBanner tone="error" message={errorMessage} />
          </div>
        ) : null}

        {stage === "camera" ? (
          <CameraControls
            mode={mode}
            multipleCount={multipleCount}
            onCapture={() => void handleCapture()}
            onFinishMultiple={() => void handleFinishMultiple()}
            onRemoveLast={() => {
              setMultipleFrames((current) => {
                const last = current[current.length - 1];
                if (last?.previewUrl) {
                  URL.revokeObjectURL(last.previewUrl);
                }
                return current.slice(0, -1);
              });
            }}
            shutterLabel={mode === "two-sided" ? twoSidedPrompt : null}
            twoSidedCount={(twoSidedFrames.front ? 1 : 0) + (twoSidedFrames.back ? 1 : 0)}
            disabled={!isCameraReady}
          />
        ) : null}
      </section>

      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}

function ModeSelector({
  activeMode,
  onChangeMode,
}: {
  activeMode: CaptureMode;
  onChangeMode: (mode: CaptureMode) => void;
}) {
  const modes: Array<{ label: string; value: CaptureMode }> = [
    { label: "Single", value: "single" },
    { label: "Multiple", value: "multiple" },
    { label: "2-sided", value: "two-sided" },
  ];

  return (
    <div className="rounded-full border border-white/14 bg-black/28 p-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.2)] backdrop-blur-md">
      <div className="grid grid-cols-3 gap-1">
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => onChangeMode(mode.value)}
            className={`rounded-full px-3 py-2 text-sm font-medium transition ${
              activeMode === mode.value
                ? "bg-white text-black"
                : "text-white/74 hover:bg-white/10"
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CameraControls({
  disabled,
  mode,
  multipleCount,
  onCapture,
  onFinishMultiple,
  onRemoveLast,
  shutterLabel,
  twoSidedCount,
}: {
  disabled: boolean;
  mode: CaptureMode;
  multipleCount: number;
  onCapture: () => void;
  onFinishMultiple: () => void;
  onRemoveLast: () => void;
  shutterLabel: string | null;
  twoSidedCount: number;
}) {
  const showMultipleControls = mode === "multiple";
  const showTwoSidedHint = mode === "two-sided";
  const canRemoveLast = multipleCount > 0;
  const canFinishMultiple = multipleCount > 0;

  return (
    <>
      {showTwoSidedHint ? (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+132px)] z-20 flex justify-center px-5">
          <div className="rounded-full border border-white/14 bg-black/28 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
            {shutterLabel} {twoSidedCount > 0 ? `(${twoSidedCount}/2)` : ""}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-[calc(env(safe-area-inset-bottom,0px)+28px)]">
        <div className={`pointer-events-auto mx-auto flex max-w-md items-center ${showMultipleControls ? "justify-between" : "justify-center"}`}>
          {showMultipleControls ? (
            <button
              type="button"
              onClick={onRemoveLast}
              disabled={!canRemoveLast}
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-black/30 text-2xl text-white backdrop-blur-md disabled:opacity-30"
            >
              ×
            </button>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              aria-label="Capture receipt"
              onClick={onCapture}
              disabled={disabled}
              className="flex h-[5.9rem] w-[5.9rem] items-center justify-center rounded-full border border-white/34 bg-white/10 p-[0.42rem] shadow-[0_22px_52px_rgba(0,0,0,0.36)] backdrop-blur-md transition active:scale-[0.98] disabled:opacity-40"
            >
              <span className="capture-ring flex h-full w-full items-center justify-center rounded-full bg-white shadow-[0_0_32px_rgba(255,255,255,0.36)]">
                <span className="h-[4.3rem] w-[4.3rem] rounded-full border border-[#d9dee7] bg-white" />
              </span>
            </button>
            {showMultipleControls ? (
              <div className="rounded-full bg-black/34 px-3 py-1 text-sm font-medium text-white backdrop-blur-md">
                {multipleCount}
              </div>
            ) : (
              <div className="h-5 w-24 rounded-full bg-white/6 backdrop-blur-sm" />
            )}
          </div>

          {showMultipleControls ? (
            <button
              type="button"
              onClick={onFinishMultiple}
              disabled={!canFinishMultiple}
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-black/30 text-xl text-white backdrop-blur-md disabled:opacity-30"
            >
              ✓
            </button>
          ) : null}
        </div>
      </div>
    </>
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
    />
  );
}

function ProcessingOverlay({
  fields,
  imageUrl,
  label,
  progress,
}: {
  fields: ProcessingFields;
  imageUrl: string | null;
  label: string;
  progress: string | null;
}) {
  return (
    <div className="absolute inset-0 z-30 bg-[rgba(3,8,16,0.42)]">
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

        <div className="rounded-[30px] border border-white/12 bg-[rgba(4,10,18,0.8)] p-5 backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.18em] text-[#5ff0a7]">Scanning</p>
          <p className="mt-2 text-lg font-semibold text-white">{label}</p>
          {progress ? <p className="mt-1 text-sm text-white/64">{progress}</p> : null}
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

function InlineReviewPanel({
  editValues,
  errorMessage,
  folders,
  isDirty,
  isSavingEdits,
  notes,
  onChangeField,
  onDone,
  onRetake,
  previewUrl,
}: {
  editValues: typeof emptyEditValues;
  errorMessage: string | null;
  folders: FolderRow[];
  isDirty: boolean;
  isSavingEdits: boolean;
  notes: string | null;
  onChangeField: (field: keyof typeof emptyEditValues, value: string) => void;
  onDone: () => void;
  onRetake: () => void;
  previewUrl: string | null;
}) {
  return (
    <div className="absolute inset-0 z-30 bg-[rgba(3,8,16,0.24)]">
      {previewUrl ? (
        <div className="absolute inset-x-5 top-[calc(env(safe-area-inset-top,0px)+86px)] z-10 overflow-hidden rounded-[28px] border border-white/10 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
          <img src={previewUrl} alt="Captured receipt" className="h-40 w-full object-cover" />
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 rounded-t-[34px] border-t border-white/12 bg-[rgba(4,10,18,0.84)] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] backdrop-blur-xl">
        <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/18" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#5ff0a7]">Scan Complete</p>
            <p className="mt-2 text-xl font-semibold text-white">Check and finish</p>
          </div>
          <button
            type="button"
            onClick={onRetake}
            className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-medium text-white"
          >
            Retake
          </button>
        </div>

        {errorMessage ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={errorMessage} />
          </div>
        ) : null}

        <div className="mt-4 max-h-[48dvh] space-y-3 overflow-y-auto pr-1 thin-scrollbar">
          <InlineField
            label="Merchant"
            value={editValues.merchant_name}
            onChange={(value) => onChangeField("merchant_name", value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <InlineField
              label="Date"
              type="date"
              value={editValues.receipt_date}
              onChange={(value) => onChangeField("receipt_date", value)}
            />
            <InlineField
              label="Currency"
              value={editValues.currency}
              onChange={(value) => onChangeField("currency", value.toUpperCase().slice(0, 3))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InlineField
              label="Total"
              type="number"
              step="0.01"
              value={editValues.total_amount}
              onChange={(value) => onChangeField("total_amount", value)}
            />
            <InlineField
              label="VAT"
              type="number"
              step="0.01"
              value={editValues.vat_amount}
              onChange={(value) => onChangeField("vat_amount", value)}
            />
          </div>
          <InlineField
            label="Category"
            value={editValues.category}
            onChange={(value) => onChangeField("category", value)}
          />
          <label className="block">
            <span className="mb-2 block text-sm text-white/74">Folder</span>
            <select
              value={editValues.folder_id}
              onChange={(event) => onChangeField("folder_id", event.target.value)}
              className="w-full rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">Unsorted</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          {notes ? (
            <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/56">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/78">{notes}</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onDone}
          disabled={isSavingEdits}
          className="mt-5 w-full rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {isSavingEdits ? "Saving..." : isDirty ? "Save and done" : "Done"}
        </button>
      </div>
    </div>
  );
}

function BatchCompleteOverlay({
  count,
  onDone,
}: {
  count: number;
  onDone: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(3,8,16,0.54)] px-5">
      <div className="w-full max-w-sm rounded-[32px] border border-white/12 bg-[rgba(4,10,18,0.84)] p-6 text-center backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.18em] text-[#5ff0a7]">Finished</p>
        <p className="mt-3 text-2xl font-semibold text-white">{count} receipts scanned</p>
        <p className="mt-2 text-sm leading-6 text-white/68">
          Everything was saved to your gallery. You can review or edit any receipt there.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-5 w-full rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold text-[var(--text-on-accent)]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function InlineField({
  label,
  onChange,
  step,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/74">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-sm text-white outline-none"
      />
    </label>
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

function matchesReceiptEditValues(
  receipt: ReceiptDetail,
  editValues: typeof emptyEditValues,
) {
  return (
    (receipt.category ?? "") === editValues.category &&
    (receipt.currency ?? "") === editValues.currency &&
    (receipt.folder_id ?? "") === editValues.folder_id &&
    (receipt.merchant_name ?? "") === editValues.merchant_name &&
    (receipt.receipt_date ?? "") === editValues.receipt_date &&
    (receipt.total_amount != null ? String(receipt.total_amount) : "") === editValues.total_amount &&
    (receipt.vat_amount != null ? String(receipt.vat_amount) : "") === editValues.vat_amount
  );
}

async function combineFramesVertically(front: Blob, back: Blob) {
  const [frontImage, backImage] = await Promise.all([
    loadImageFromBlob(front),
    loadImageFromBlob(back),
  ]);
  const width = Math.max(frontImage.width, backImage.width);
  const scaleFront = width / frontImage.width;
  const scaleBack = width / backImage.width;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(frontImage.height * scaleFront + backImage.height * scaleBack);
  const context = canvas.getContext("2d");
  if (!context) {
    return front;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(frontImage, 0, 0, width, Math.round(frontImage.height * scaleFront));
  context.drawImage(
    backImage,
    0,
    Math.round(frontImage.height * scaleFront),
    width,
    Math.round(backImage.height * scaleBack),
  );

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((combined) => resolve(combined ?? front), "image/jpeg", 0.92);
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
