"use client";

import { useEffect } from "react";
import { initializeSession } from "@/lib/supabase/session";

export function AppBootstrap() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  useEffect(() => {
    void initializeSession();
  }, []);

  return null;
}
