"use client";

import { useEffect, useState } from "react";

/**
 * Tells people the device is offline before they tap something that cannot work.
 * navigator.onLine only proves the device has *a* link, so this is a hint, not a
 * guarantee — requests still fail with their own message when the link is dead.
 */
export function NetworkBanner() {
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const goOffline = () => {
      setOffline(true);
      setRestored(false);
    };
    const goOnline = () => {
      setOffline(false);
      setRestored(true);
    };

    setOffline(!navigator.onLine);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    if (!restored) {
      return;
    }
    const timer = window.setTimeout(() => setRestored(false), 4000);
    return () => window.clearTimeout(timer);
  }, [restored]);

  if (!offline && !restored) {
    return null;
  }

  return (
    <div
      className={`net-banner ${offline ? "net-banner--offline" : "net-banner--online"}`}
      role="status"
      aria-live="polite"
    >
      <span className="net-banner__dot" aria-hidden="true" />
      {offline
        ? "Đang mất kết nối mạng. Thao tác cần máy chủ sẽ tạm thời không thực hiện được."
        : "Đã có mạng trở lại."}
    </div>
  );
}
