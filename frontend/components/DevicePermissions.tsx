"use client";

import { useEffect, useState } from "react";

import { Button } from "./ui";
import { permissionState, requestCameraOnce, requestLocationOnce } from "../lib/device";

type State = "granted" | "denied" | "prompt";

/**
 * One card, one tap, both permissions — shown until the browser has both.
 *
 * Without it, the first check-in asked for the camera, then for the
 * location, each with its own prompt in the middle of the thing the person
 * was trying to do. Asked up front, on the home screen, the grants are
 * remembered by Chrome and Edge for good; Safari on iPhone remembers them
 * for the session, or for good once "Allow" is picked in Settings.
 */
export function DevicePermissions() {
  const [camera, setCamera] = useState<State | null>(null);
  const [location, setLocation] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([permissionState("camera"), permissionState("location")]).then(([cam, loc]) => {
      if (live) {
        setCamera(cam);
        setLocation(loc);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (camera === null || location === null || (camera === "granted" && location === "granted")) {
    return null;
  }

  async function grant() {
    setBusy(true);
    if (camera !== "granted") {
      setCamera((await requestCameraOnce()) ? "granted" : "denied");
    }
    if (location !== "granted") {
      setLocation((await requestLocationOnce()) ? "granted" : "denied");
    }
    setBusy(false);
  }

  const denied = camera === "denied" || location === "denied";
  return (
    <section className="perm">
      <div className="perm__text">
        <p className="perm__title">Cấp quyền camera và vị trí một lần</p>
        <p className="perm__body">
          {denied
            ? "Trình duyệt đang chặn một trong hai. Mở cài đặt trang web (biểu tượng ổ khoá cạnh địa chỉ) và cho phép, rồi tải lại."
            : "Chấm công cần ảnh khuôn mặt và vị trí. Cho phép ngay bây giờ để những lần sau camera mở thẳng, không hỏi lại."}
        </p>
        <p className="perm__state">
          <span className={camera === "granted" ? "is-ok" : camera === "denied" ? "is-bad" : undefined}>
            {camera === "granted" ? "✓" : camera === "denied" ? "✕" : "○"} Camera
          </span>
          <span className={location === "granted" ? "is-ok" : location === "denied" ? "is-bad" : undefined}>
            {location === "granted" ? "✓" : location === "denied" ? "✕" : "○"} Vị trí
          </span>
        </p>
      </div>
      {!denied ? (
        <Button onClick={() => void grant()} loading={busy} size="sm">
          Cho phép
        </Button>
      ) : null}
    </section>
  );
}
