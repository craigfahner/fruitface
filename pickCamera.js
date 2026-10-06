// Picks a camera by its name, so each page can use a different camera even though they share
// a hostname (Chrome's camera setting is per-site, so choosing one in the address bar would
// switch both pages).
//
// `preferences` is a list of tests on the camera's label, in priority order. Returns the
// deviceId of the first camera that passes a test, or null to fall back to Chrome's default.
async function findCameraId(preferences) {
  // Chrome only reveals camera labels once permission is granted, so open (and immediately
  // close) a stream on the default camera first.
  const probe = await navigator.mediaDevices.getUserMedia({ video: true });
  probe.getTracks().forEach((track) => track.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === "videoinput");
  console.log("cameras found:", cameras.map((c) => c.label));

  for (const test of preferences) {
    const camera = cameras.find((c) => test(c.label));
    if (camera) {
      console.log("using camera:", camera.label);
      return camera.deviceId;
    }
  }
  console.warn("no preferred camera found, using Chrome's default");
  return null;
}

// createCapture() constraints for a 640x480 stream from a specific camera (or the default)
function cameraConstraints(deviceId) {
  const video = { width: 640, height: 480 };
  if (deviceId) video.deviceId = { exact: deviceId };
  return { video, audio: false };
}
