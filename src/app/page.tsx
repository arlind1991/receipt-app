import { SessionGate } from "@/components/auth/session-gate";

export default function HomePage() {
  return <SessionGate redirectTo="/camera" />;
}
