"use client";

import { useCallback, useMemo, useState } from "react";

import { api } from "../lib/api";
import { readPosition } from "../lib/geo";
import type { GeoPoint } from "../lib/map";
import { MAP_FALLBACK } from "../lib/map";
import { describeError } from "../lib/messages";
import { GeoMap } from "./GeoMap";
import { Alert, Button } from "./ui";

export type PickedPoint = GeoPoint;

interface LocationPickerProps {
  point: PickedPoint;
  onPointChange: (point: PickedPoint) => void;
  /** Address of the place that was found. The form decides whether to use it —
   *  searching no longer overwrites what the manager typed. */
  onFound?: (label: string) => void;
  allowRadiusMeters: number;
  warningRadiusMeters: number;
}

export function LocationPicker({
  point,
  onPointChange,
  onFound,
  allowRadiusMeters,
  warningRadiusMeters,
}: LocationPickerProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  // Transient: used only to look a place up, never stored on the location.
  const [query, setQuery] = useState("");

  const centre = point.latitude ? point : MAP_FALLBACK;
  const circles = useMemo(
    () => [
      { center: centre, radiusMeters: warningRadiusMeters, color: "#b45309", dashed: true },
      { center: centre, radiusMeters: allowRadiusMeters, color: "#0e7a55" },
    ],
    [centre, allowRadiusMeters, warningRadiusMeters],
  );
  const markers = useMemo(() => [{ point: centre, kind: "site" as const, draggable: true }], [centre]);

  const search = useCallback(async () => {
    if (!query.trim()) {
      return;
    }
    setBusy("search");
    setError(null);
    setNotice(null);
    try {
      const result = await api.resolvePlace(query.trim());
      onPointChange({ latitude: result.latitude, longitude: result.longitude });
      if (result.label) {
        onFound?.(result.label);
      }
      setNotice(result.label ? `Đã tìm thấy: ${result.label}` : "Đã đặt ghim trên bản đồ.");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }, [query, onFound, onPointChange]);

  const useGps = useCallback(async () => {
    setBusy("gps");
    setError(null);
    setNotice(null);
    try {
      const pos = await readPosition();
      onPointChange({ latitude: pos.latitude, longitude: pos.longitude });
      setNotice(`Đã lấy vị trí hiện tại của bạn (độ chính xác ±${pos.accuracyMeters.toFixed(0)}m).`);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }, [onPointChange]);

  return (
    <div className="stack">
      <div className="field">
        <label className="field__label" htmlFor="location-address-input">
          Tìm trên bản đồ
        </label>
        <div className="picker-search">
          <input
            id="location-address-input"
            className="input"
            placeholder="Nhập địa chỉ hoặc dán liên kết Google Maps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Enter inside a form would submit it; here it only searches.
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button variant="secondary" onClick={() => void search()} loading={busy === "search"} size="sm">
            Tìm
          </Button>
          <Button variant="ghost" onClick={() => void useGps()} loading={busy === "gps"} size="sm">
            Vị trí của tôi
          </Button>
        </div>
        <div className="picker-tip">
          <p className="picker-tip__text">
            Tìm bằng tên thường không ra đúng chỗ. Cách chắc chắn nhất: mở Google Maps, chạm giữ vào
            đúng vị trí, chọn <strong>Chia sẻ</strong> rồi dán liên kết vào ô trên.
          </p>
          <a
            className="button button--secondary button--sm"
            href={`https://www.google.com/maps/search/${encodeURIComponent(query || "")}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Mở Google Maps
          </a>
        </div>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <GeoMap circles={circles} markers={markers} onPick={onPointChange} height={280} />

      <div className="picker-legend">
        <span className="picker-legend__item">
          <span className="picker-legend__dot" style={{ background: "var(--color-success)" }} />
          Chấm công được trong {allowRadiusMeters}m
        </span>
        <span className="picker-legend__item">
          <span className="picker-legend__dot" style={{ background: "var(--color-warning)" }} />
          Ngoài {warningRadiusMeters}m thì chặn
        </span>
        <span className="picker-legend__coords mono">
          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
        </span>
      </div>

    </div>
  );
}
