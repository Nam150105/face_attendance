"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PermissionHelp } from "./PermissionHelp";
import { Alert, Button, playChime } from "./ui";
import { api } from "../lib/api";
import { permissionState, rememberGranted } from "../lib/device";
import type { FaceGuide } from "../lib/types";

export interface CapturedImage {
  blob: Blob;
  previewUrl: string;
}

export type CapturePhase = "idle" | "working" | "done" | "failed";

/** What the status chip over the picture says while the page is busy. */
export interface PhaseLabels {
  working: string;
}

interface CameraCaptureProps {
  captureLabel: string;
  labels: PhaseLabels;
  onCaptured: (image: CapturedImage | null) => void;
  phase?: CapturePhase;
  disabled?: boolean;
  /** Open the camera as soon as the screen appears when the browser already allows it. */
  autoStart?: boolean;
}

const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.92;

// Live guidance: a small frame every so often, judged by the same OpenCV
// measurements and the same detector the final photo goes through. Small
// because the answer is "move closer", not "who is this".
const GUIDE_WIDTH = 400;
const GUIDE_INTERVAL_MS = 700;
// Once every check passes there is nothing left to fix; a slower beat only
// confirms nobody walked into the frame. Each frame is ~170 ms of the
// server's CPU, and a phone left on this screen used to send them forever.
const GUIDE_IDLE_INTERVAL_MS = 2000;
// After this many failed guide calls in a row the shutter is unlocked anyway:
// a slow network must not lock somebody out of clocking in.
const GUIDE_FAILURES_BEFORE_FALLBACK = 3;

const PERMISSION_MESSAGES: Record<string, string> = {
  NotAllowedError: "Quyền truy cập camera đã bị từ chối. Vui lòng cho phép camera trong cài đặt trình duyệt.",
  NotFoundError: "Không tìm thấy camera trên thiết bị này.",
  NotReadableError: "Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.",
  OverconstrainedError: "Camera không đáp ứng được độ phân giải yêu cầu.",
};

type CheckState = "pending" | "ok" | "fail";

interface CheckRow {
  key: "face" | "single" | "light" | "sharp";
  label: string;
  state: CheckState;
  /** What to do about it, only when it is not ok. */
  fix: string | null;
}

/**
 * Four things, and only four, before the shutter: is there a face, is it the
 * only one, is there enough light, is it sharp. Nothing here says whether the
 * face is the right person — that is the server's answer, after the photo.
 */
function checklist(guide: FaceGuide | null): CheckRow[] {
  const checks = guide?.checks ?? null;
  const count = guide?.face_count ?? 0;
  const hint = guide?.hint;
  if (!guide || !checks) {
    return [
      { key: "face", label: "Khuôn mặt", state: "pending", fix: null },
      { key: "single", label: "Một người", state: "pending", fix: null },
      { key: "light", label: "Ánh sáng", state: "pending", fix: null },
      { key: "sharp", label: "Độ nét", state: "pending", fix: null },
    ];
  }
  const faceFix = !checks.face
    ? "Nhìn thẳng vào camera"
    : hint === "TOO_FAR"
      ? "Đưa máy lại gần hơn"
      : hint === "TOO_CLOSE"
        ? "Lùi ra một chút"
        : hint === "OFF_CENTRE"
          ? "Đưa khuôn mặt vào giữa khung"
          : null;
  return [
    { key: "face", label: "Khuôn mặt", state: checks.face && checks.framed ? "ok" : "fail", fix: faceFix },
    {
      key: "single",
      label: "Một người",
      state: !checks.face ? "pending" : checks.single ? "ok" : "fail",
      fix: checks.face && !checks.single ? `Có ${count} người trong khung — chỉ một người thôi` : null,
    },
    {
      key: "light",
      label: "Ánh sáng",
      state: checks.light ? "ok" : "fail",
      fix: hint === "TOO_DARK" ? "Hơi tối — ra chỗ sáng hơn" : hint === "TOO_BRIGHT" ? "Quá chói — quay lưng lại nguồn sáng" : null,
    },
    {
      key: "sharp",
      label: "Độ nét",
      state: !checks.single ? "pending" : checks.sharp ? "ok" : "fail",
      fix: checks.single && !checks.sharp ? "Bị nhoè — giữ yên máy" : null,
    },
  ];
}

export function CameraCapture({ captureLabel, labels, onCaptured, phase = "idle", disabled, autoStart = true }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [guide, setGuide] = useState<FaceGuide | null>(null);
  const [guideDown, setGuideDown] = useState(false);
  const guideBusy = useRef(false);
  const guideFailures = useRef(0);
  const latestGuide = useRef<FaceGuide | null>(null);
  const hiddenWhileLive = useRef(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const start = useCallback(async () => {
    setError(null);
    setDenied(false);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Trình duyệt cần kết nối HTTPS để mở camera.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Trình duyệt của bạn không hỗ trợ camera.");
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
      rememberGranted("camera");
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setDenied(name === "NotAllowedError" || name === "SecurityError");
      setError(PERMISSION_MESSAGES[name] ?? "Không mở được camera. Vui lòng kiểm tra quyền truy cập thiết bị.");
    } finally {
      setStarting(false);
    }
  }, []);

  // Already allowed: open at once, no "Mở camera" to press. Denied: the
  // browser will not prompt again, so the instructions are the only way out.
  useEffect(() => {
    let cancelled = false;
    void permissionState("camera").then((state) => {
      if (cancelled) return;
      if (state === "denied") {
        setDenied(true);
        setError(PERMISSION_MESSAGES.NotAllowedError);
      } else if (state === "granted" && autoStart && !disabled) {
        void start();
      }
    });
    return () => {
      cancelled = true;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!streaming || preview) {
      setGuide(null);
      latestGuide.current = null;
      setGuideDown(false);
      guideFailures.current = 0;
      return;
    }
    let cancelled = false;
    const canvas = document.createElement("canvas");

    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || guideBusy.current || !video || !video.videoWidth) {
        return;
      }
      guideBusy.current = true;
      try {
        const scale = GUIDE_WIDTH / video.videoWidth;
        canvas.width = GUIDE_WIDTH;
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
        if (!blob || cancelled) {
          return;
        }
        const result = await api.guideFace(blob);
        if (!cancelled) {
          latestGuide.current = result;
          setGuide(result);
          setGuideDown(false);
          guideFailures.current = 0;
        }
      } catch {
        guideFailures.current += 1;
        if (!cancelled && guideFailures.current >= GUIDE_FAILURES_BEFORE_FALLBACK) {
          setGuideDown(true);
        }
      } finally {
        guideBusy.current = false;
      }
    };

    let timer: number | null = null;
    const schedule = () => {
      const ready = latestGuide.current?.ready ?? false;
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await tick();
        }
        if (!cancelled) schedule();
      }, ready ? GUIDE_IDLE_INTERVAL_MS : GUIDE_INTERVAL_MS);
    };
    void tick().then(() => {
      if (!cancelled) schedule();
    });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [streaming, preview]);

  // A tab in the background keeps the camera light on and the guide loop
  // running for nobody. Release the camera; it reopens when the person is back.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden" && streamRef.current && !preview) {
        stopStream();
        hiddenWhileLive.current = true;
      } else if (document.visibilityState === "visible" && hiddenWhileLive.current) {
        hiddenWhileLive.current = false;
        void start();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [preview, start, stopStream]);

  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng. Vui lòng đợi một chút rồi thử lại.");
      return;
    }
    setFlashing(true);
    playChime("shutter");
    setTimeout(() => setFlashing(false), 300);

    const scale = CAPTURE_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Không xử lý được hình ảnh.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Không tạo được tệp ảnh.");
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        setPreview(previewUrl);
        stopStream();
        onCaptured({ blob, previewUrl });
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }, [onCaptured, stopStream]);

  function retake() {
    setPreview(null);
    onCaptured(null);
    void start();
  }

  const live = streaming && !preview;
  const rows = checklist(guide);
  const allOk = rows.every((row) => row.state === "ok");
  // The shutter waits for four ticks, unless the guide itself is unreachable.
  const ready = live && (guideDown || allOk);
  const busy = phase === "working";

  return (
    <div className="cam">
      <div className={`cam__box${live ? " is-live" : ""}${preview ? " has-preview" : ""}`}>
        {preview ? (
          <img src={preview} alt="Ảnh vừa chụp" className="cam__media" />
        ) : (
          <video ref={videoRef} className="cam__media" playsInline muted autoPlay aria-label="Hình ảnh trực tiếp từ camera" />
        )}
        <div className={`shutter-flash ${flashing ? "shutter-flash--active" : ""}`} />

        {/* The oval: where the face should sit. Green once every check passes. */}
        {live ? (
          <div className={`cam__oval${ready ? " is-ready" : ""}`} aria-hidden="true">
            {guide?.box ? (
              <div
                className={`cam__face${ready ? " is-ready" : ""}`}
                // The preview is mirrored like a selfie; the detector's box is not.
                style={{
                  left: `${(1 - guide.box.x - guide.box.w) * 100}%`,
                  top: `${guide.box.y * 100}%`,
                  width: `${guide.box.w * 100}%`,
                  height: `${guide.box.h * 100}%`,
                }}
              />
            ) : null}
          </div>
        ) : null}

        {!streaming && !preview ? (
          <div className="cam__idle">
            <p>{starting ? "Đang mở camera…" : "Camera chưa mở"}</p>
          </div>
        ) : null}

        {busy ? (
          <div className="cam__working" role="status" aria-live="polite">
            <span className="spinner" /> {labels.working}
          </div>
        ) : null}
      </div>

      {/* Before the photo: the four checks, nothing else. */}
      {live ? (
        guideDown ? (
          <p className="cam__note">Không kiểm tra trước được khung hình — bạn vẫn chụp được.</p>
        ) : (
          <ul className="checklist" aria-label="Kiểm tra trước khi chụp">
            {rows.map((row) => (
              <li key={row.key} className={`checklist__item is-${row.state}`}>
                <span className="checklist__mark" aria-hidden="true">
                  {row.state === "ok" ? "✓" : row.state === "fail" ? "!" : "·"}
                </span>
                <span className="checklist__label">{row.label}</span>
                <span className="checklist__fix">
                  {row.state === "ok" ? "Đạt" : row.state === "pending" ? (guide ? "—" : "Đang kiểm tra…") : row.fix}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {error ? (
        <div className="stack stack--tight">
          <Alert tone="danger">{error}</Alert>
          {denied ? <PermissionHelp kind="camera" /> : null}
        </div>
      ) : null}

      <div className="cam__actions">
        {preview ? (
          !busy && phase !== "done" ? (
            <Button variant="secondary" onClick={retake} disabled={disabled} block>
              Chụp lại
            </Button>
          ) : null
        ) : !streaming ? (
          <Button onClick={() => void start()} loading={starting} disabled={disabled} size="lg" block>
            Mở camera
          </Button>
        ) : (
          <button
            type="button"
            className={`shutter${ready ? " is-ready" : ""}`}
            onClick={grabFrame}
            disabled={disabled || !ready}
            aria-label={captureLabel}
          >
            <span className="shutter__ring" />
            <span className="shutter__text">{ready ? captureLabel : "Chờ đủ 4 mục"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
