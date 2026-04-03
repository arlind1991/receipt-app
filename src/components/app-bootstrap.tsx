"use client";

import { useEffect, useState } from "react";
import { initializeSession } from "@/lib/supabase/session";
import { StatusBanner } from "@/components/status-banner";

function isLocalDevHost() {
  if (typeof window === "undefined") {
    return false;
  }

  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}

export function AppBootstrap() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (isLocalDevHost()) {
      void unregisterLocalServiceWorkers();
      return;
    }

    let hasReloadedForController = false;

    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
        setShowUpdateBanner(true);
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) {
          return;
        }

        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            setWaitingWorker(worker);
            setShowUpdateBanner(true);
          }
        });
      });

      void registration.update();
    });

    const controllerChangeHandler = () => {
      if (hasReloadedForController) {
        return;
      }

      hasReloadedForController = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", controllerChangeHandler);

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChangeHandler,
      );
    };
  }, []);

  useEffect(() => {
    void initializeSession();
  }, []);

  async function handleApplyUpdate() {
    if (!waitingWorker) {
      window.location.reload();
      return;
    }

    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <>
      {showUpdateBanner ? (
        <div className="fixed top-3 right-3 left-3 z-50 md:left-1/2 md:w-[420px] md:-translate-x-1/2">
          <StatusBanner
            message="New version available. Refresh to update the app."
            actionLabel="Refresh"
            onAction={() => void handleApplyUpdate()}
          />
        </div>
      ) : null}
    </>
  );
}

async function unregisterLocalServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const keys = await window.caches.keys();
    await Promise.all(keys.map((key) => window.caches.delete(key)));
  }
}
