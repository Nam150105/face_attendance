export interface FixedPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestamp: number;
}

export type GeolocationFailure = "UNSUPPORTED" | "DENIED" | "UNAVAILABLE" | "TIMEOUT";

export class GeolocationUnavailableError extends Error {
  /** Its message was written for the person reading it, so show it as-is. */
  readonly userFacing = true;

  readonly reason: GeolocationFailure;

  constructor(message: string, reason: GeolocationFailure) {
    super(message);
    this.name = "GeolocationUnavailableError";
    this.reason = reason;
  }
}

export function readPosition(timeoutMs = 15000): Promise<FixedPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeolocationUnavailableError("Trình duyệt không hỗ trợ định vị.", "UNSUPPORTED"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestamp: position.timestamp,
        }),
      (error) => {
        const messages: Record<number, string> = {
          1: "Bạn đã từ chối quyền truy cập vị trí. Hãy bật lại rồi thử lại.",
          2: "Không lấy được vị trí. Kiểm tra GPS hoặc kết nối mạng.",
          3: "Quá thời gian chờ khi lấy vị trí. Thử lại ở nơi thoáng hơn.",
        };
        const reasons: Record<number, GeolocationFailure> = {
          1: "DENIED",
          2: "UNAVAILABLE",
          3: "TIMEOUT",
        };
        reject(
          new GeolocationUnavailableError(
            messages[error.code] ?? error.message,
            reasons[error.code] ?? "UNAVAILABLE",
          ),
        );
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function isSecureContextReady(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.isSecureContext;
}

export function newIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${random}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters.toFixed(1)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
