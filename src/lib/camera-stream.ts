// One camera stream shared across page changes while the app is open.
//
// iOS asks for camera permission again every time getUserMedia runs after the
// previous stream was stopped, and for home-screen web apps it doesn't remember
// "Allow". So instead of stopping the stream when the camera screen closes, we
// pause it (tracks disabled) and reuse it next time. It's only really stopped
// when the app goes to the background, which iOS would do anyway.

let sharedStream: MediaStream | null = null;
let pendingStream: Promise<MediaStream> | null = null;
let visibilityListenerAdded = false;

function isLive(stream: MediaStream | null): stream is MediaStream {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
}

function addVisibilityListener() {
  if (visibilityListenerAdded || typeof document === "undefined") {
    return;
  }
  visibilityListenerAdded = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopCameraStream();
    }
  });
}

// Returns the paused stream if there is one, otherwise asks for the camera.
export async function acquireCameraStream(constraints: MediaStreamConstraints) {
  addVisibilityListener();

  if (isLive(sharedStream)) {
    sharedStream.getTracks().forEach((track) => {
      track.enabled = true;
    });
    return sharedStream;
  }

  pendingStream ??= navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      sharedStream = stream;
      return stream;
    })
    .finally(() => {
      pendingStream = null;
    });

  return pendingStream;
}

// Leaving the camera screen: stop sending frames but keep the permission.
export function pauseCameraStream() {
  sharedStream?.getTracks().forEach((track) => {
    track.enabled = false;
  });
}

export function stopCameraStream() {
  sharedStream?.getTracks().forEach((track) => track.stop());
  sharedStream = null;
}
