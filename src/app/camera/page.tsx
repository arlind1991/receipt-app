import { SessionGate } from "@/components/auth/session-gate";
import { CameraCapture } from "@/components/camera/camera-capture";

export default function CameraPage() {
  return (
    <SessionGate requireAuth>
      <CameraCapture />
    </SessionGate>
  );
}
