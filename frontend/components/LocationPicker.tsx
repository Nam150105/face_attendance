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
  address: string;
  onPointChange: (point: PickedPoint) => void;
  onAddressChange: (address: string) => void;
  allowRadiusMeters: number;
  warningRadiusMeters: number;
}

const FALLBACK: PickedPoint = { latitude: 21.0285, longitude: 105.8048 };

export function LocationPicker({
  point,
  address,
  onPointChange,
  onAddressChange,
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
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);

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
    if (!address.trim()) {
      return;
    }
    setBusy("search");
    setError(null);
    setNotice(null);
    try {
      const result = await api.resolvePlace(address.trim());
      onPointChange({ latitude: result.latitude, longitude: result.longitude });
      if (result.label) {
        onAddressChange(result.label);
      }
      setNotice(result.label ? `Đã tìm thấy: ${result.label}` : "Đã đặt ghim trên bản đồ.");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }, [address, onAddressChange, onPointChange]);

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
          Tìm địa điểm
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            id="location-address-input"
            className="input"
            placeholder="Nhập địa chỉ, toạ độ hoặc dán liên kết Google Maps"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button variant="secondary" onClick={() => void search()} loading={busy === "search"} size="sm">
            Tìm
          </Button>
          <Button variant="ghost" onClick={() => void useGps()} loading={busy === "gps"} size="sm" title="Dùng vị trí hiện tại">
            GPS
          </Button>
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

      <div className="row row--between" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
        <div className="row">
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--color-success)" }} />
          <span>Phạm vi chuẩn {allowRadiusMeters}m</span>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--color-warning)", marginLeft: 8 }} />
          <span>Phạm vi cảnh báo {warningRadiusMeters}m</span>
        </div>
        <button
          type="button"
          onClick={() => setManual(!manual)}
          style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}
        >
          {manual ? "Ẩn toạ độ thủ công" : "Nhập toạ độ thủ công"}
        </button>
      </div>

      {manual ? (
        <div className="row">
          <div style={{ flex: 1 }}>
            <label className="field__label">Vĩ độ (Latitude)</label>
            <input
              type="number"
              step="any"
              className="input mono"
              value={point.latitude}
              onChange={(e) => onPointChange({ ...point, latitude: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field__label">Kinh độ (Longitude)</label>
            <input
              type="number"
              step="any"
              className="input mono"
              value={point.longitude}
              onChange={(e) => onPointChange({ ...point, longitude: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
