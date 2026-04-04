"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import {
  enqueueReceiptProcessingItems,
  getLastUsedFolderId,
  setLastUsedFolderId,
} from "@/lib/local-storage";
import { fetchFolders, saveReceipt } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type { ReceiptProcessingQueueItem } from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";
const DEFAULT_CAMERA_ZOOM = 1.08;

type CaptureMode = "single" | "multiple" | "two-sided";

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

export function CameraCapture() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraPermissionRef = useRef<PermissionStatus | null>(null);
  const startCameraPromiseRef = useRef<Promise<void> | null>(null);
  const multipleFramesRef = useRef<CapturedFrame[]>([]);
  const twoSidedFramesRef = useRef<{ back: CapturedFrame | null; front: CapturedFrame | null }>({
    back: null,
    front: null,
  });
  const [selectedFolderId, setSelectedFolderId] = useState(UNSORTED_FOLDER_ID);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionLabel, setSubmissionLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>("single");
  const [multipleFrames, setMultipleFrames] = useState<CapturedFrame[]>([]);
  const [twoSidedFrames, setTwoSidedFrames] = useState<{
    back: CapturedFrame | null;
    front: CapturedFrame | null;
  }>({ back: null, front: null });
  const [useCssZoomFallback, setUseCssZoomFallback] = useState(false);

  const hasSupabase = useMemo(() => !supabaseEnvError, []);
  const videoScale = useCssZoomFallback ? DEFAULT_CAMERA_ZOOM : 1;

  useEffect(() => {
    multipleFramesRef.current = multipleFrames;
  }, [multipleFrames]);

  useEffect(() => {
    twoSidedFramesRef.current = twoSidedFrames;
  }, [twoSidedFrames]);

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
    if (
      !zoomCapability ||
      typeof zoomCapability.min !== "number" ||
      typeof zoomCapability.max !== "number"
    ) {
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

  const readCameraPermissionState = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !("permissions" in navigator) ||
      typeof navigator.permissions.query !== "function"
    ) {
      return null;
    }

    try {
      const permissionStatus = await navigator.permissions.query({
        name: "camera" as PermissionName,
      });
      cameraPermissionRef.current = permissionStatus;
      return permissionStatus.state;
    } catch {
      return null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      setIsCameraReady(true);
      return;
    }

    if (startCameraPromiseRef.current) {
      await startCameraPromiseRef.current;
      return;
    }

    const startPromise = (async () => {
      const permissionState = await readCameraPermissionState();
      if (permissionState === "denied") {
        setErrorMessage(
          "Camera access is blocked. Allow camera permission for this site in your browser settings.",
        );
        setIsCameraReady(false);
        return;
      }

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
          "Camera access was blocked. Open the app over HTTPS and allow camera permission to capture receipts.",
        );
        setIsCameraReady(false);
      }
    })();

    startCameraPromiseRef.current = startPromise;
    await startPromise.finally(() => {
      startCameraPromiseRef.current = null;
    });
  }, [applyPreferredCameraZoom, readCameraPermissionState]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraReady(false);
  }

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
      revokeFrameUrls(multipleFramesRef.current);
      revokeFrameUrls([twoSidedFramesRef.current.front, twoSidedFramesRef.current.back]);
    };
  }, [startCamera]);

  function revokeFrameUrls(frames: Array<CapturedFrame | null | undefined>) {
    for (const frame of frames) {
      if (frame?.previewUrl) {
        URL.revokeObjectURL(frame.previewUrl);
      }
    }
  }

  function resetCapturedState(nextMode?: CaptureMode) {
    revokeFrameUrls(multipleFramesRef.current);
    revokeFrameUrls([twoSidedFramesRef.current.front, twoSidedFramesRef.current.back]);
    setMultipleFrames([]);
    setTwoSidedFrames({ back: null, front: null });
    setSubmissionLabel(null);
    setErrorMessage(null);
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

  async function handleCapture() {
    if (isSubmitting) {
      return;
    }

    const blob = await captureFrameBlob();
    if (!blob) {
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    const frame = { blob, previewUrl };
    setErrorMessage(null);

    if (mode === "single") {
      await finalizeSingle(frame);
      return;
    }

    if (mode === "multiple") {
      setMultipleFrames((current) => [...current, frame]);
      return;
    }

    const nextFrames = !twoSidedFrames.front
      ? { ...twoSidedFrames, front: frame }
      : { ...twoSidedFrames, back: frame };
    setTwoSidedFrames(nextFrames);

    if (nextFrames.front && nextFrames.back) {
      await finalizeTwoSided(nextFrames.front, nextFrames.back);
    }
  }

  async function finalizeSingle(frame: CapturedFrame) {
    setIsSubmitting(true);
    setSubmissionLabel("Saving receipt");

    try {
      await enqueueCapturedReceipts([frame.blob], [frame.previewUrl]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setIsSubmitting(false);
      setSubmissionLabel(null);
      return;
    }

    URL.revokeObjectURL(frame.previewUrl);
  }

  async function finalizeTwoSided(front: CapturedFrame, back: CapturedFrame) {
    setIsSubmitting(true);
    setSubmissionLabel("Saving 2-sided receipt");

    try {
      const combinedBlob = await combineFramesVertically(front.blob, back.blob);
      await enqueueCapturedReceipts([combinedBlob], [front.previewUrl]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setIsSubmitting(false);
      setSubmissionLabel(null);
      return;
    } finally {
      revokeFrameUrls([front, back]);
      setTwoSidedFrames({ back: null, front: null });
    }
  }

  async function handleFinishMultiple() {
    if (multipleFrames.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmissionLabel(`Saving ${multipleFrames.length} receipts`);

    try {
      await enqueueCapturedReceipts(
        multipleFrames.map((frame) => frame.blob),
        multipleFrames.map((frame) => frame.previewUrl),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setIsSubmitting(false);
      setSubmissionLabel(null);
      return;
    } finally {
      revokeFrameUrls(multipleFrames);
      setMultipleFrames([]);
    }
  }

  async function enqueueCapturedReceipts(blobs: Blob[], previewUrls: string[]) {
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

    const saveResults = await Promise.allSettled(
      blobs.map(async (blob, index) => {
        const saveResult = await saveReceipt({
          blob,
          folderId,
          userId: user.id,
        });
        if (!saveResult.ok) {
          throw new Error(saveResult.error);
        }

        const thumbnailDataUrl = await createThumbnailDataUrl(blob, previewUrls[index] ?? null);
        return {
          created_at: new Date().toISOString(),
          receipt_id: saveResult.data.id,
          state: "queued",
          status_text: "Processing",
          thumbnail_data_url: thumbnailDataUrl,
          user_id: user.id,
        } satisfies ReceiptProcessingQueueItem;
      }),
    );

    const queueEntries = saveResults.reduce<ReceiptProcessingQueueItem[]>((accumulator, result) => {
      if (result.status === "fulfilled") {
        accumulator.push(result.value);
      }
      return accumulator;
    }, []);

    if (queueEntries.length === 0) {
      const [firstRejected] = saveResults.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw firstRejected?.reason instanceof Error
        ? firstRejected.reason
        : new Error("Receipt upload failed. Please try again.");
    }

    enqueueReceiptProcessingItems(queueEntries);
    stopCamera();
    router.replace("/receipts?tab=processing");
    router.refresh();
  }

  const multipleCount = multipleFrames.length;
  const twoSidedPrompt = !twoSidedFrames.front ? "Capture front" : "Capture back";

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-black text-white">
      <section className="relative h-full w-full overflow-hidden">
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

        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,var(--camera-top-fade),transparent_22%,transparent_68%,var(--camera-bottom-fade))]" />

        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+14px)] z-30 px-4">
          <button
            type="button"
            aria-label="Back to receipts"
            onClick={() => {
              stopCamera();
              router.replace("/receipts");
              router.refresh();
            }}
            className="inline-flex min-h-10 items-center text-[1rem] font-medium tracking-[-0.01em] text-white/92 transition hover:text-white"
          >
            <span aria-hidden="true" className="mr-1 text-[1.3rem] leading-none">&lsaquo;</span>
            Receipts
          </button>
        </div>

        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+52px)] z-20 flex justify-center px-6">
          <ModeSelector
            activeMode={mode}
            onChangeMode={(nextMode) => {
              if (nextMode === mode || isSubmitting) {
                return;
              }
              resetCapturedState(nextMode);
            }}
          />
        </div>

        {submissionLabel ? (
          <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+138px)] z-20 flex justify-center px-6">
            <div className="rounded-full bg-black/32 px-4 py-2 text-sm font-medium text-white/86 backdrop-blur-md">
              {submissionLabel}
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+124px)] left-4 z-30">
            <StatusBanner tone="error" message={errorMessage} />
          </div>
        ) : null}

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
          disabled={!isCameraReady || isSubmitting}
        />
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
    { label: "2-Sided", value: "two-sided" },
  ];

  return (
    <div className="flex items-center justify-center gap-6">
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          onClick={() => onChangeMode(mode.value)}
          className={`relative pb-1 text-sm tracking-[0.02em] transition ${
            activeMode === mode.value
              ? "font-semibold text-white"
              : "font-medium text-white/48 hover:text-white/72"
          }`}
        >
          {mode.label}
          <span
            aria-hidden="true"
            className={`absolute inset-x-0 -bottom-[1px] mx-auto h-px w-5 bg-white transition ${
              activeMode === mode.value ? "opacity-80" : "opacity-0"
            }`}
          />
        </button>
      ))}
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
        <div
          className={`pointer-events-auto mx-auto flex max-w-md items-center ${
            showMultipleControls ? "justify-between" : "justify-center"
          }`}
        >
          {showMultipleControls ? (
            <button
              type="button"
              onClick={onRemoveLast}
              disabled={!canRemoveLast || disabled}
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
              disabled={!canFinishMultiple || disabled}
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

async function combineFramesVertically(front: Blob, back: Blob) {
  const [frontImage, backImage] = await Promise.all([loadImageFromBlob(front), loadImageFromBlob(back)]);
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

async function createThumbnailDataUrl(blob: Blob, fallbackPreviewUrl: string | null) {
  try {
    const image = await loadImageFromBlob(blob);
    const maxSize = 220;
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      return fallbackPreviewUrl;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return fallbackPreviewUrl;
  }
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
