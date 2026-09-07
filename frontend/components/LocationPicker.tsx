"use client";

import "leaflet/dist/leaflet.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { readPosition } from "../lib/geo";
import { describeError } from "../lib/messages";
import { Alert, Button } from "./ui";

export interface PickedPoint {
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  point: PickedPoint;
  onPointChange: (point: PickedPoint) => void;
  /** Address of the place that was found. The form decides whether to use it —
   *  searching no longer overwrites what the manager typed. */
  onFound?: (label: string) => void;
  allowRadiusMeters: number;
  warningRadiusMeters: number;
}

const FALLBACK: PickedPoint = { latitude: 21.0285, longitude: 105.8048 };

export function LocationPicker({
  point,
  onPointChange,
  onFound,
  allowRadiusMeters,
  warningRadiusMeters,
}: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const allowRef = useRef<import("leaflet").Circle | null>(null);
  const warningRef = useRef<import("leaflet").Circle | null>(null);
  const pointChangeRef = useRef(onPointChange);
  pointChangeRef.current = onPointChange;

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  // Transient: used only to look a place up, never stored on the location.
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const leaflet = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }
      const start: PickedPoint = point.latitude ? point : FALLBACK;
      const map = leaflet.map(containerRef.current, { zoomControl: true });
      map.setView([start.latitude, start.longitude], point.latitude ? 17 : 12);
      
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        })
        .addTo(map);

      warningRef.current = leaflet
        .circle([start.latitude, start.longitude], {
          radius: warningRadiusMeters,
          color: "#f59e0b",
          weight: 1.5,
          fillColor: "#f59e0b",
          fillOpacity: 0.1,
          dashArray: "4, 4",
        })
        .addTo(map);

      allowRef.current = leaflet
        .circle([start.latitude, start.longitude], {
          radius: allowRadiusMeters,
          color: "#10b981",
          weight: 2,
          fillColor: "#10b981",
          fillOpacity: 0.18,
        })
        .addTo(map);

      const marker = leaflet
        .marker([start.latitude, start.longitude], {
          draggable: true,
          icon: leaflet.divIcon({
            className: "",
            html: '<span class="map__pin"><span class="map__pin-dot"></span></span>',
            iconSize: [26, 34],
            iconAnchor: [13, 34],
          }),
        })
        .addTo(map);

      function push(latitude: number, longitude: number) {
        pointChangeRef.current({
          latitude: Number(latitude.toFixed(7)),
          longitude: Number(longitude.toFixed(7)),
        });
      }

      marker.on("dragend", () => {
        const position = marker.getLatLng();
        push(position.lat, position.lng);
      });
      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        marker.setLatLng(event.latlng);
        push(event.latlng.lat, event.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      setReady(true);
      window.setTimeout(() => map.invalidateSize(), 150);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !markerRef.current || !mapRef.current) {
      return;
    }
    const current = markerRef.current.getLatLng();
    allowRef.current?.setLatLng([point.latitude, point.longitude]);
    warningRef.current?.setLatLng([point.latitude, point.longitude]);
    if (Math.abs(current.lat - point.latitude) < 1e-7 && Math.abs(current.lng - point.longitude) < 1e-7) {
      return;
    }
    markerRef.current.setLatLng([point.latitude, point.longitude]);
    mapRef.current.setView([point.latitude, point.longitude], Math.max(mapRef.current.getZoom(), 16));
  }, [ready, point.latitude, point.longitude]);

  useEffect(() => {
    allowRef.current?.setRadius(allowRadiusMeters);
    warningRef.current?.setRadius(warningRadiusMeters);
  }, [allowRadiusMeters, warningRadiusMeters]);

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

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "260px",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          border: "1px solid var(--border-medium)",
          boxShadow: "var(--shadow-panel)",
        }}
      />

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
