"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import {
  enqueueReceiptProcessingItems,
  getLastUsedFolderId,
  setLastUsedFolderId,
} from "@/lib/local-storage";
import { GardenWowPicker } from "@/components/receipts/gardenwow-panel";
import { acquireCameraStream, pauseCameraStream } from "@/lib/camera-stream";
import { getCaptureTarget, isGardenWowEnabled, setCaptureTarget } from "@/lib/gardenwow/client";
import { fetchFolders, saveReceipt } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type { ReceiptProcessingQueueItem } from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";
// The reader downsizes to this edge anyway (see receipt-ocr-claude), so a full
// 4K frame only makes the upload slower.
const CAPTURE_MAX_EDGE = 2576;
const CAPTURE_JPEG_QUALITY = 0.85;

type CaptureMode = "single" | "multiple" | "two-sided";

type CapturedFrame = {
  blob: Blob;
  previewUrl: string;
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
  const [isGardenWowOn, setIsGardenWowOn] = useState(false);
  const [gardenWowClient, setGardenWowClient] = useState<{
    clientId: string;
    clientName: string;
  } | null>(null);
  const [isGardenWowPickerOpen, setIsGardenWowPickerOpen] = useState(false);
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
  const [savingPreviewUrl, setSavingPreviewUrl] = useState<string | null>(null);

  const hasSupabase = useMemo(() => !supabaseEnvError, []);

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

    void isGardenWowEnabled(user.id).then((enabled) => {
      setIsGardenWowOn(enabled);
      if (enabled) {
        setGardenWowClient(getCaptureTarget());
      }
    });

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
        const stream = await acquireCameraStream({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2160 },
            height: { ideal: 3840 },
          },
        });

        streamRef.current = stream;
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
  }, [readCameraPermissionState]);

  // Pauses rather than stops the shared stream so iOS doesn't ask for camera
  // permission again next time (see lib/camera-stream).
  function stopCamera() {
    pauseCameraStream();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
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

  // The shared stream is stopped when the app goes to the background; restart
  // it when the user comes back to this screen.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const stream = streamRef.current;
      if (!stream || stream.getVideoTracks().every((track) => track.readyState === "ended")) {
        streamRef.current = null;
        void startCamera();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  const captureFrameBlob = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return null;
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) {
      return null;
    }

    // The preview fills the screen (object-cover), so keep only the part of
    // the frame that's on screen: the photo matches what the user framed.
    const coverScale = Math.max(
      (video.clientWidth || videoWidth) / videoWidth,
      (video.clientHeight || videoHeight) / videoHeight,
    );
    const sourceWidth = Math.min(videoWidth, (video.clientWidth || videoWidth) / coverScale);
    const sourceHeight = Math.min(videoHeight, (video.clientHeight || videoHeight) / coverScale);
    const sourceX = (videoWidth - sourceWidth) / 2;
    const sourceY = (videoHeight - sourceHeight) / 2;

    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", CAPTURE_JPEG_QUALITY));
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
    setSavingPreviewUrl(frame.previewUrl);

    try {
      await enqueueCapturedReceipts([frame.blob], [frame.previewUrl]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setIsSubmitting(false);
      setSubmissionLabel(null);
      setSavingPreviewUrl(null);
      return;
    }

    URL.revokeObjectURL(frame.previewUrl);
  }

  async function finalizeTwoSided(front: CapturedFrame, back: CapturedFrame) {
    setIsSubmitting(true);
    setSubmissionLabel("Saving 2-sided receipt");
    setSavingPreviewUrl(back.previewUrl);

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
      setSavingPreviewUrl(null);
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
          gardenwowClient: isGardenWowOn ? gardenWowClient : null,
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
    <main
      className="relative h-[100dvh] overflow-hidden bg-black text-white"
      style={{ "--camera-strip": "calc(env(safe-area-inset-bottom, 0px) + 88px)" } as CSSProperties}
    >
      <section className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-x-0 top-0 bottom-[var(--camera-strip)] overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {savingPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={savingPreviewUrl}
              alt=""
              className="absolute inset-0 z-[5] h-full w-full bg-black object-cover"
            />
          ) : null}

          <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,var(--camera-top-fade),transparent_22%,transparent_100%)]" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 h-[var(--camera-strip)] bg-black" />

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
          {isGardenWowOn ? (
            <button
              type="button"
              onClick={() => setIsGardenWowPickerOpen(true)}
              disabled={isSubmitting}
              className="absolute top-0 right-4 inline-flex min-h-10 max-w-[60%] items-center rounded-full bg-black/32 px-3 text-sm font-medium text-white/92 backdrop-blur-md transition hover:text-white disabled:opacity-60"
            >
              <span className="truncate">
                GardenWow: {gardenWowClient?.clientName ?? "Unassigned"}
              </span>
              <span aria-hidden="true" className="ml-1 text-xs">▾</span>
            </button>
          ) : null}
        </div>

        {isGardenWowPickerOpen ? (
          <GardenWowPicker
            title="Save new receipts to"
            withVisits={false}
            onClose={() => setIsGardenWowPickerOpen(false)}
            onChoose={(choice) => {
              const next =
                choice.clientId && choice.clientName
                  ? { clientId: choice.clientId, clientName: choice.clientName }
                  : null;
              setGardenWowClient(next);
              setCaptureTarget(next);
              setIsGardenWowPickerOpen(false);
            }}
          />
        ) : null}

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
          <div className="absolute inset-x-0 bottom-[calc(var(--camera-strip)+64px)] z-20 flex justify-center px-6">
            <div className="rounded-full bg-black/32 px-4 py-2 text-sm font-medium text-white/86 backdrop-blur-md">
              {submissionLabel}
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="absolute right-4 bottom-[calc(var(--camera-strip)+64px)] left-4 z-30">
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
        <div className="absolute inset-x-0 bottom-[calc(var(--camera-strip)+64px)] z-20 flex justify-center px-5">
          <div className="rounded-full border border-white/14 bg-black/28 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
            {shutterLabel} {twoSidedCount > 0 ? `(${twoSidedCount}/2)` : ""}
          </div>
        </div>
      ) : null}

      {/* Shutter sits on the top edge of the bottom strip, half in and half out. */}
      <div className="absolute inset-x-0 bottom-[calc(var(--camera-strip)-2.95rem)] z-20 flex justify-center">
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
      </div>

      {showMultipleControls ? (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-20 flex justify-between px-8">
          <button
            type="button"
            aria-label="Remove last photo"
            onClick={onRemoveLast}
            disabled={!canRemoveLast || disabled}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-white/8 text-2xl text-white disabled:opacity-30"
          >
            ×
          </button>
          <button
            type="button"
            aria-label="Finish and save photos"
            onClick={onFinishMultiple}
            disabled={!canFinishMultiple || disabled}
            className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-white/8 text-xl text-white disabled:opacity-30"
          >
            ✓
            {multipleCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold text-black">
                {multipleCount}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}
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
