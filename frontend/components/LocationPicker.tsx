"use client";

import "leaflet/dist/leaflet.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { readPosition } from "../lib/geo";
import { describeError } from "../lib/messages";
import { Alert, Button, Field } from "./ui";

export interface PickedPoint {
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  value: PickedPoint;
  onChange: (point: PickedPoint) => void;
  onAddressFound?: (address: string) => void;
}

type LeafletModule = typeof import("leaflet");

export function LocationPicker({ value, onChange, onAddressFound }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const leaflet: LeafletModule = (await import("leaflet")).default ?? (await import("leaflet"));
      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }
      const map = leaflet.map(containerRef.current, { zoomControl: true, attributionControl: true });
      map.setView([value.latitude || 21.0285, value.longitude || 105.8048], value.latitude ? 17 : 12);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        })
        .addTo(map);

      const icon = leaflet.divIcon({
        className: "",
        html: '<span class="map__pin"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = leaflet.marker([value.latitude || 21.0285, value.longitude || 105.8048], {
        draggable: true,
        icon,
      }).addTo(map);

      marker.on("dragend", () => {
        const position = marker.getLatLng();
        onChangeRef.current({
          latitude: Number(position.lat.toFixed(7)),
          longitude: Number(position.lng.toFixed(7)),
        });
      });
      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        marker.setLatLng(event.latlng);
        onChangeRef.current({
          latitude: Number(event.latlng.lat.toFixed(7)),
          longitude: Number(event.latlng.lng.toFixed(7)),
        });
      });

      mapRef.current = map;
      markerRef.current = marker;
      setMapReady(true);
      window.setTimeout(() => map.invalidateSize(), 120);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The map is created once; later coordinate changes are pushed in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || !markerRef.current || !mapRef.current) {
      return;
    }
    const current = markerRef.current.getLatLng();
    if (Math.abs(current.lat - value.latitude) < 1e-7 && Math.abs(current.lng - value.longitude) < 1e-7) {
      return;
    }
    markerRef.current.setLatLng([value.latitude, value.longitude]);
    mapRef.current.setView([value.latitude, value.longitude], Math.max(mapRef.current.getZoom(), 16));
  }, [mapReady, value.latitude, value.longitude]);

  const apply = useCallback(
    (point: PickedPoint, label: string | null) => {
      onChangeRef.current(point);
      setError(null);
      setNotice(label ?? `Đã đặt pin tại ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`);
      if (label && onAddressFound) {
        onAddressFound(label);
      }
    },
    [onAddressFound],
  );

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.resolvePlace(query.trim());
      apply({ latitude: result.latitude, longitude: result.longitude }, result.label);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSearching(false);
    }
  }

  async function useMyPosition() {
    setLocating(true);
    setError(null);
    setNotice(null);
    try {
      const fix = await readPosition();
      apply(
        { latitude: Number(fix.latitude.toFixed(7)), longitude: Number(fix.longitude.toFixed(7)) },
        `Vị trí của bạn, sai số ${fix.accuracyMeters.toFixed(0)} m`,
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="stack">
      <form className="field" onSubmit={search}>
        <label className="field__label" htmlFor="place-query">
          Tìm vị trí
        </label>
        <div className="search-row">
          <input
            id="place-query"
            className="input"
            placeholder="Địa chỉ, link Google Maps, hoặc 21.0285, 105.8048"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" loading={searching} disabled={!query.trim()}>
            Tìm
          </Button>
        </div>
        <span className="field__hint">Link rút gọn maps.app.goo.gl cũng dùng được.</span>
      </form>

      <div className="map" ref={containerRef} role="application" aria-label="Bản đồ chọn vị trí" />

      <div className="row">
        <Button variant="secondary" type="button" onClick={() => void useMyPosition()} loading={locating}>
          Vị trí của tôi
        </Button>
        <span className="field__hint" style={{ alignSelf: "center" }}>
          Chạm hoặc kéo pin để chỉnh.
        </span>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="row">
        <div style={{ flex: "1 1 140px" }}>
          <Field
            label="Vĩ độ"
            type="number"
            step="0.0000001"
            min={-90}
            max={90}
            required
            value={value.latitude}
            onChange={(event) => onChange({ ...value, latitude: Number(event.target.value) })}
          />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <Field
            label="Kinh độ"
            type="number"
            step="0.0000001"
            min={-180}
            max={180}
            required
            value={value.longitude}
            onChange={(event) => onChange({ ...value, longitude: Number(event.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
