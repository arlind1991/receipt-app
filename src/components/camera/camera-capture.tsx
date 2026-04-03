"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { getLastUsedFolderId, setLastUsedFolderId } from "@/lib/local-storage";
import {
  createFolder,
  fetchFolders,
  saveReceipt,
  triggerReceiptProcessing,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type { FolderRow } from "@/lib/types";

const UNSORTED_FOLDER_ID = "__unsorted__";

type CaptureState = "live" | "preview";

export function CameraCapture() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState>("live");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(UNSORTED_FOLDER_ID);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasSupabase = useMemo(() => !supabaseEnvError, []);

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setCapturedBlob(blob);
    setPreviewUrl(URL.createObjectURL(blob));
    setCaptureState("preview");
    setErrorMessage(null);
  }

  async function handleRetake() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setCapturedBlob(null);
    setPreviewUrl(null);
    setCaptureState("live");
    setErrorMessage(null);
    setIsCameraReady(false);
    await startCamera();
  }

  async function handleSave() {
    if (!capturedBlob) {
      return;
    }

    if (!hasSupabase) {
      setErrorMessage(supabaseEnvError);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const user = await ensureBrowserSession();
      if (!user) {
        throw new Error("You need to sign in before saving receipts.");
      }

      let folderId: string | null = null;

      if (showNewFolderInput && newFolderName.trim()) {
        const createResult = await createFolder(user.id, newFolderName.trim());

        if (!createResult.ok) {
          throw new Error(createResult.error);
        }

        folderId = createResult.data.id;
        setFolders((current) => [createResult.data, ...current]);
        setLastUsedFolderId(createResult.data.id);
      } else if (selectedFolderId !== UNSORTED_FOLDER_ID) {
        folderId = selectedFolderId;
        setLastUsedFolderId(selectedFolderId);
      }

      const saveResult = await saveReceipt({
        blob: capturedBlob,
        folderId,
        userId: user.id,
      });

      if (!saveResult.ok) {
        throw new Error(saveResult.error);
      }

      void triggerReceiptProcessing(saveResult.data.id);
      router.push(`/receipts/${saveResult.data.id}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Receipt upload failed. Please try again.",
      );
      setIsSaving(false);
    }
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
            {captureState === "live" ? (
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
              previewUrl && (
                <img
                  src={previewUrl}
                  alt="Receipt preview"
                  className="h-full min-h-[62dvh] w-full object-cover"
                />
              )
            )}
          </div>

          {errorMessage ? (
            <div className="absolute right-3 bottom-3 left-3">
              <StatusBanner tone="error" message={errorMessage} />
            </div>
          ) : null}
        </div>

        {captureState === "preview" ? (
          <section className="glass-panel mt-4 rounded-[28px] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Save</p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  Folder is optional. Leaving it as Unsorted keeps capture fast.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewFolderInput((value) => !value)}
                className="rounded-full border border-white/12 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
              >
                {showNewFolderInput ? "Cancel folder" : "New folder"}
              </button>
            </div>

            {showNewFolderInput ? (
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Create a folder"
                className="mt-4 w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
              />
            ) : (
              <label className="mt-4 block">
                <span className="mb-2 block text-sm text-[var(--text-secondary)]">Folder</span>
                <select
                  value={selectedFolderId}
                  onChange={(event) => setSelectedFolderId(event.target.value)}
                  className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none focus:border-[var(--border-strong)]"
                >
                  <option value={UNSORTED_FOLDER_ID}>Unsorted</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleRetake()}
                className="rounded-full border border-white/12 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/7"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save receipt"}
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-4 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={!isCameraReady}
              className="capture-ring flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-full border border-white/24 bg-white/6 p-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="h-16 w-16 rounded-full bg-[var(--accent)] shadow-[0_0_40px_rgba(143,247,208,0.55)]" />
            </button>
            <p className="text-sm text-[var(--text-secondary)]">
              Frame the receipt and tap once to capture.
            </p>
          </section>
        )}
      </section>

      <canvas ref={canvasRef} className="hidden" />
      <AppNav />
    </main>
  );
}
