"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PermissionHelp } from "./PermissionHelp";
import { Alert, Button, playChime } from "./ui";

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

  const currentLabel =
    phase === "working"
      ? labels.working
      : phase === "done"
        ? labels.done
        : phase === "failed"
          ? labels.failed
          : countdown !== null
            ? labels.holding
            : labels.framing;

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
            <span className="hud-badge" style={{ color: "var(--color-cyan)" }}>
              {currentLabel}
            </span>
          </div>

          {/* Target Reticle */}
          <div
            className={`hud-target ${
              streaming ? "hud-target--scanning" : phase === "done" ? "hud-target--done" : phase === "failed" ? "hud-target--failed" : ""
            }`}
          >
            {streaming && countdown === null ? <div className="hud-scan-line" /> : null}
          </div>

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
            disabled={disabled}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
            block
          >
            {captureLabel} · đếm ngược {COUNTDOWN_FROM}s
          </Button>
        )}
      </div>
    </div>
  );
}
