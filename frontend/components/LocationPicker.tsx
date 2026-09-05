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
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" })
        .addTo(map);

      warningRef.current = leaflet
        .circle([start.latitude, start.longitude], {
          radius: warningRadiusMeters,
          color: "#f59e0b",
          weight: 1,
          fillColor: "#f59e0b",
          fillOpacity: 0.07,
        })
        .addTo(map);
      allowRef.current = leaflet
        .circle([start.latitude, start.longitude], {
          radius: allowRadiusMeters,
          color: "#10b981",
          weight: 1,
          fillColor: "#10b981",
          fillOpacity: 0.12,
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
    // Created once; coordinate updates are pushed by the effects below.
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
      setNotice(result.label ?? "Đã đặt pin theo toạ độ bạn nhập.");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }, [address, onAddressChange, onPointChange]);

  const useMyPosition = useCallback(async () => {
    setBusy("gps");
    setError(null);
    setNotice(null);
    try {
      const fix = await readPosition();
      onPointChange({
        latitude: Number(fix.latitude.toFixed(7)),
        longitude: Number(fix.longitude.toFixed(7)),
      });
      setNotice(`Vị trí của bạn, sai số ${fix.accuracyMeters.toFixed(0)} m`);
      const reverse = await api.reversePlace(fix.latitude, fix.longitude).catch(() => null);
      if (reverse?.label && !address.trim()) {
        onAddressChange(reverse.label);
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }, [address, onAddressChange, onPointChange]);

  return (
    <div className="stack">
      <div className="field">
        <label className="field__label" htmlFor="place-query">
          Địa chỉ
        </label>
        <div className="search-row">
          <input
            id="place-query"
            className="input"
            placeholder="Tên toà nhà, địa chỉ, link Google Maps hoặc 21.0285, 105.8048"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          {/* Not a submit button: this sits inside the location form and must not save it. */}
          <Button type="button" onClick={() => void search()} loading={busy === "search"} disabled={!address.trim()}>
            Tìm
          </Button>
        </div>
      </div>

      <div className="map" ref={containerRef} role="application" aria-label="Bản đồ chọn vị trí" />

      <div className="map-actions">
        <Button variant="secondary" size="sm" type="button" onClick={() => void useMyPosition()} loading={busy === "gps"}>
          Vị trí của tôi
        </Button>
        <button type="button" className="link" onClick={() => setManual((current) => !current)}>
          {manual ? "Ẩn toạ độ" : "Nhập toạ độ tay"}
        </button>
        <span className="coords mono">
          {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
        </span>
      </div>

      {manual ? (
        <div className="row">
          <div style={{ flex: "1 1 140px" }}>
            <label className="field__label" htmlFor="lat-input">
              Vĩ độ
            </label>
            <input
              id="lat-input"
              className="input"
              type="number"
              step="0.0000001"
              min={-90}
              max={90}
              value={point.latitude}
              onChange={(event) => onPointChange({ ...point, latitude: Number(event.target.value) })}
            />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label className="field__label" htmlFor="lng-input">
              Kinh độ
            </label>
            <input
              id="lng-input"
              className="input"
              type="number"
              step="0.0000001"
              min={-180}
              max={180}
              value={point.longitude}
              onChange={(event) => onPointChange({ ...point, longitude: Number(event.target.value) })}
            />
          </div>
        </div>
      ) : null}

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
