"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PermissionHelp } from "./PermissionHelp";
import { Alert, Button, playChime } from "./ui";
import { api } from "../lib/api";
import type { FaceGuide, FaceHint } from "../lib/types";

export interface CapturedImage {
  blob: Blob;
  previewUrl: string;
}

export type CapturePhase = "idle" | "working" | "done" | "failed";

export interface PhaseLabels {
  framing: string;
  holding: string;
  working: string;
  done: string;
  failed: string;
}

interface CameraCaptureProps {
  captureLabel: string;
  labels: PhaseLabels;
  onCaptured: (image: CapturedImage | null) => void;
  phase?: CapturePhase;
  disabled?: boolean;
}

const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.92;
const COUNTDOWN_FROM = 3;

// Live guidance: a small frame every so often, judged by the same OpenCV
// measurements and the same detector the final photo goes through. Small
// because the answer is "move closer", not "who is this".
const GUIDE_WIDTH = 400;
const GUIDE_INTERVAL_MS = 700;
// After this many failed guide calls in a row the shutter is unlocked anyway:
// a slow network must not lock somebody out of clocking in.
const GUIDE_FAILURES_BEFORE_FALLBACK = 3;

const HINT_TEXT: Record<FaceHint, string> = {
  OK: "Sẵn sàng — bấm chụp",
  NO_FACE: "Chưa thấy khuôn mặt. Nhìn thẳng vào camera.",
  MULTIPLE_FACES: "Chỉ một người trong khung hình.",
  TOO_DARK: "Chỗ này hơi tối. Chọn nơi sáng hơn.",
  TOO_BRIGHT: "Quá chói. Quay lưng lại nguồn sáng.",
  TOO_FAR: "Khuôn mặt quá xa. Đưa máy lại gần hơn.",
  TOO_CLOSE: "Quá gần. Lùi ra một chút.",
  OFF_CENTRE: "Đưa khuôn mặt vào giữa khung.",
  BLURRY: "Ảnh bị nhoè. Giữ yên máy.",
};

const PERMISSION_MESSAGES: Record<string, string> = {
  NotAllowedError: "Quyền truy cập camera đã bị từ chối. Vui lòng cho phép camera trong cài đặt trình duyệt.",
  NotFoundError: "Không tìm thấy camera trên thiết bị này.",
  NotReadableError: "Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.",
  OverconstrainedError: "Camera không đáp ứng được độ phân giải yêu cầu.",
};

export function CameraCapture({ captureLabel, labels, onCaptured, phase = "idle", disabled }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [guide, setGuide] = useState<FaceGuide | null>(null);
  const [guideDown, setGuideDown] = useState(false);
  const guideBusy = useRef(false);
  const guideFailures = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      stopStream();
    };
  }, [stopStream]);

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
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setDenied(name === "NotAllowedError" || name === "SecurityError");
      setError(PERMISSION_MESSAGES[name] ?? "Không mở được camera. Vui lòng kiểm tra quyền truy cập thiết bị.");
    } finally {
      setStarting(false);
    }
  }, []);

  // Chrome and Edge remember a denial, so getUserMedia never prompts again and
  // the instructions are the only way forward. Safari has no camera query yet.
  useEffect(() => {
    const permissions = navigator.permissions;
    if (!permissions?.query) {
      return;
    }
    let cancelled = false;
    permissions
      .query({ name: "camera" as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === "denied") {
          setDenied(true);
          setError(PERMISSION_MESSAGES.NotAllowedError);
        }
      })
      .catch(() => {
        // Browsers without a "camera" descriptor simply reject; not an error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!streaming || preview) {
      setGuide(null);
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
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.7),
        );
        if (!blob || cancelled) {
          return;
        }
        const result = await api.guideFace(blob);
        if (!cancelled) {
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

    void tick();
    const timer = window.setInterval(() => void tick(), GUIDE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [streaming, preview]);

  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng. Vui lòng đợi một chút rồi thử lại.");
      return;
    }
    
    // Shutter flash animation & sound
    setFlashing(true);
    playChime("shutter");
    setTimeout(() => setFlashing(false), 350);

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

  const beginCountdown = useCallback(() => {
    setError(null);
    setCountdown(COUNTDOWN_FROM);
    timerRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current === null || current <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          grabFrame();
          return null;
        }
        return current - 1;
      });
    }, 1000);
  }, [grabFrame]);

  function retake() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
    setPreview(null);
    onCaptured(null);
    void start();
  }

  // While the camera is live and nothing is captured, the label is whatever
  // the detector wants fixed; the page's own labels take over afterwards.
  const guiding = streaming && !preview && countdown === null && phase === "idle";
  const currentLabel =
    phase === "working"
      ? labels.working
      : phase === "done"
        ? labels.done
        : phase === "failed"
          ? labels.failed
          : countdown !== null
            ? labels.holding
            : guiding && guideDown
              ? "Không kiểm tra được khung hình, bạn vẫn chụp được."
              : guiding && guide
                ? HINT_TEXT[guide.hint] ?? labels.framing
                : guiding
                  ? "Đang tìm khuôn mặt…"
                  : labels.framing;
  const guideTone: "ok" | "warn" | "none" =
    !guiding || guideDown ? "none" : guide?.ready ? "ok" : guide ? "warn" : "none";
  // The shutter waits for a usable frame, unless the guide itself is unreachable.
  const shutterLocked = guiding && !guideDown && !(guide?.ready ?? false);

  return (
    <div className="stack">
      <div className="camera-box">
        {preview ? (
          <img src={preview} alt="Ảnh vừa chụp" className="camera-preview" />
        ) : (
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            autoPlay
            aria-label="Hình ảnh trực tiếp từ camera"
          />
        )}

        {/* Shutter flash overlay */}
        <div className={`shutter-flash ${flashing ? "shutter-flash--active" : ""}`} />

        {/* Sci-Fi Biometric HUD Overlay */}
        <div className="hud-overlay">
          <div className="hud-header">
            <span className="hud-badge">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: streaming ? "var(--color-success)" : "var(--text-muted)",
                  boxShadow: streaming ? "0 0 8px var(--color-success)" : "none",
                }}
              />
              {streaming ? "Camera đang bật" : preview ? "Đã chụp" : "Camera đang tắt"}
            </span>
            <span
              className={`hud-badge hud-badge--${guideTone}`}
              role="status"
              aria-live="polite"
            >
              {currentLabel}
            </span>
          </div>

          {/* Target Reticle */}
          <div
            className={`hud-target ${
              streaming
                ? guideTone === "ok"
                  ? "hud-target--ready"
                  : guideTone === "warn"
                    ? "hud-target--warn"
                    : "hud-target--scanning"
                : phase === "done"
                  ? "hud-target--done"
                  : phase === "failed"
                    ? "hud-target--failed"
                    : ""
            }`}
          >
            {streaming && countdown === null ? <div className="hud-scan-line" /> : null}
          </div>

          {/* Where the detector saw the face, so the instruction and the
              picture agree about what "too far" refers to. */}
          {guiding && guide?.box ? (
            <div
              className={`hud-face ${guide.ready ? "hud-face--ready" : ""}`}
              style={{
                left: `${guide.box.x * 100}%`,
                top: `${guide.box.y * 100}%`,
                width: `${guide.box.w * 100}%`,
                height: `${guide.box.h * 100}%`,
              }}
              aria-hidden="true"
            />
          ) : null}

          {/* Countdown Indicator */}
          {countdown !== null ? <div className="hud-countdown">{countdown}</div> : null}
        </div>
      </div>

      {error ? (
        <div className="stack stack--tight">
          <Alert tone="danger">{error}</Alert>
          {denied ? <PermissionHelp kind="camera" /> : null}
        </div>
      ) : null}

      <div className="row">
        {preview ? (
          <Button variant="secondary" onClick={retake} disabled={disabled} block>
            Chụp lại
          </Button>
        ) : !streaming ? (
          <Button onClick={() => void start()} loading={starting} disabled={disabled} block>
            Mở camera
          </Button>
        ) : countdown !== null ? (
          <Button
            variant="secondary"
            onClick={() => {
              if (timerRef.current !== null) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
              }
              setCountdown(null);
            }}
            block
          >
            Huỷ đếm ngược
          </Button>
        ) : (
          <Button
            onClick={beginCountdown}
            disabled={disabled || shutterLocked}
            title={shutterLocked && guide ? HINT_TEXT[guide.hint] : undefined}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
            block
          >
            {captureLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
