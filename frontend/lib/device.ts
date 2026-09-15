/**
 * What the browser has already let us use.
 *
 * Chrome and Edge remember a camera or location grant for the origin, so
 * getUserMedia and getCurrentPosition simply succeed the next time. Safari
 * on iPhone asks again per session unless the person picked "Allow" for the
 * site in Settings, and that is outside a web page's reach. What a page can
 * do is remember that it *was* granted and stop asking the person to press
 * "Mở camera" first — the camera opens as the screen does.
 */
export type DevicePermission = "camera" | "location";

const KEYS: Record<DevicePermission, string> = { camera: "fa.perm.camera", location: "fa.perm.location" };

export function rememberGranted(kind: DevicePermission): void {
  try {
    localStorage.setItem(KEYS[kind], "granted");
  } catch {
    // Private mode or blocked storage: the next visit asks again, no harm.
  }
}

export function forgetGranted(kind: DevicePermission): void {
  try {
    localStorage.removeItem(KEYS[kind]);
  } catch {
    // ignore
  }
}

function remembered(kind: DevicePermission): boolean {
  try {
    return localStorage.getItem(KEYS[kind]) === "granted";
  } catch {
    return false;
  }
}

/**
 * "granted" when the browser or our own note says so, "denied" when the
 * browser remembers a refusal (no prompt will ever appear again), otherwise
 * "prompt". The Permissions API is asked first; it is the truth where it
 * exists, and it does not exist for the camera on Safari.
 */
export async function permissionState(kind: DevicePermission): Promise<"granted" | "denied" | "prompt"> {
  const name = kind === "camera" ? "camera" : "geolocation";
  try {
    const status = await navigator.permissions?.query({ name: name as PermissionName });
    if (status?.state === "granted" || status?.state === "denied") {
      return status.state;
    }
  } catch {
    // No descriptor for this permission in this browser.
  }
  return remembered(kind) ? "granted" : "prompt";
}

/** Ask for the camera once, release it at once; the grant is what we wanted. */
export async function requestCameraOnce(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    rememberGranted("camera");
    return true;
  } catch {
    return false;
  }
}

/** Ask for the location once; the fix itself is discarded. */
export function requestLocationOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        rememberGranted("location");
        resolve(true);
      },
      () => resolve(false),
      { timeout: 15000, maximumAge: 60000 },
    );
  });
}
