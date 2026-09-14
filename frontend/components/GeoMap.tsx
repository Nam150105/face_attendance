"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";

import type { GeoPoint } from "../lib/map";
import { MAP_FALLBACK, MAP_STYLE_URL, circlePolygon, zoomForRadius } from "../lib/map";

type MapLibre = typeof import("maplibre-gl");

/** Enough tilt to see building heights, not so much that the fence flattens. */
const MAP_PITCH = 48;
const MAP_BEARING = -12;

type MapInstance = import("maplibre-gl").Map;
type MarkerInstance = import("maplibre-gl").Marker;

export interface MapCircle {
  center: GeoPoint;
  radiusMeters: number;
  /** A CSS colour; tokens do not reach the canvas, so pass the hex. */
  color: string;
  dashed?: boolean;
}

export interface MapMarker {
  point: GeoPoint;
  /** "site" is a workplace pin ("site-off" when switched off); "in"/"out" are where a person stood. */
  kind: "site" | "site-off" | "in" | "out";
  label?: string;
  draggable?: boolean;
  /** Handed back by onMarkerClick. */
  id?: string;
  /** Drawn larger, on top: the pin the page is talking about. */
  active?: boolean;
}

interface GeoMapProps {
  circles: MapCircle[];
  markers: MapMarker[];
  /** Fired by a click on the map or a drag of the draggable marker. */
  onPick?: (point: GeoPoint) => void;
  /** Fired by a click on a pin that carries an id. */
  onMarkerClick?: (id: string) => void;
  height?: number;
  /** Zoom so every marker and circle is in view, instead of centring on the first marker. */
  fit?: boolean;
  /** Fly here whenever it changes; the page's way of saying "this one". */
  focus?: GeoPoint | null;
}

/**
 * One MapLibre map, told what to draw and nothing else.
 *
 * The editor and the record viewer used to be two copies of the same Leaflet
 * setup. Now both hand this component a list of circles and pins; the
 * geofence polygons live in one GeoJSON source and are replaced wholesale
 * whenever the props change, which is cheaper to reason about than nudging
 * individual layers.
 */
export function GeoMap({ circles, markers, onPick, onMarkerClick, height = 260, fit = false, focus = null }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markerRefs = useRef<MarkerInstance[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const markerClickRef = useRef(onMarkerClick);
  markerClickRef.current = onMarkerClick;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const primary = markers[0]?.point ?? circles[0]?.center ?? MAP_FALLBACK;
  // Parents hand over fresh arrays on every render; redrawing pins because a
  // name field changed would yank the map back under the user's finger. The
  // effects below key off what is actually in the arrays.
  const circleKey = JSON.stringify(circles);
  const markerKey = JSON.stringify(markers);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }
      libRef.current = maplibre;
      // The worker files are copied into /public/maplibre by the Dockerfile.
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const startZoom = circles[0] ? zoomForRadius(circles[0].radiusMeters, primary.latitude) : 15;
      // Tilted a little so the style's extruded buildings read as blocks
      // rather than outlines; the fence stays a circle on the ground.
      const map = new maplibre.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [primary.longitude, primary.latitude],
        zoom: startZoom,
        pitch: MAP_PITCH,
        bearing: MAP_BEARING,
        maxPitch: 65,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", (event) => {
        // A tile that fails is not a map that failed; only the style is fatal.
        // Either way the reason goes to the console, where a listener would
        // otherwise have swallowed it.
        console.warn("map:", event.error?.message ?? event);
        if (String(event.error?.message ?? "").includes("style")) {
          setFailed(true);
        }
      });
      map.on("load", () => {
        map.addSource("fences", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "fence-fill",
          type: "fill",
          source: "fences",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 },
        });
        map.addLayer({
          id: "fence-line",
          type: "line",
          source: "fences",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-dasharray": ["case", ["get", "dashed"], ["literal", [2, 2]], ["literal", [1, 0]]],
          },
        });
        setReady(true);
      });
      map.on("click", (event) => {
        pickRef.current?.({
          latitude: Number(event.lngLat.lat.toFixed(7)),
          longitude: Number(event.lngLat.lng.toFixed(7)),
        });
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The map is created once; everything after is done through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geofences: replace the whole collection.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) {
      return;
    }
    const source = map.getSource("fences") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: circles.map((circle) => {
        const feature = circlePolygon(circle.center, circle.radiusMeters);
        feature.properties = { color: circle.color, dashed: Boolean(circle.dashed) };
        return feature;
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, circleKey]);

  // Pins: rebuilt from scratch, they are few.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = libRef.current;
    if (!ready || !map || !maplibre) {
      return;
    }
    for (const marker of markerRefs.current) {
      marker.remove();
    }
    markerRefs.current = markers.map((item) => {
      const element = document.createElement(item.id ? "button" : "span");
      element.className = `map-pin map-pin--${item.kind}${item.active ? " is-active" : ""}`;
      if (item.label) {
        element.title = item.label;
        element.setAttribute("aria-label", item.label);
      }
      if (item.id) {
        const id = item.id;
        element.setAttribute("type", "button");
        element.addEventListener("click", (event) => {
          // The map's own click would otherwise fire too and "pick" the spot.
          event.stopPropagation();
          markerClickRef.current?.(id);
        });
      }
      const marker = new maplibre.Marker({ element, draggable: Boolean(item.draggable), anchor: "bottom" })
        .setLngLat([item.point.longitude, item.point.latitude])
        .addTo(map);
      if (item.draggable) {
        marker.on("dragend", () => {
          const at = marker.getLngLat();
          pickRef.current?.({ latitude: Number(at.lat.toFixed(7)), longitude: Number(at.lng.toFixed(7)) });
        });
      }
      return marker;
    });

    if (fit && (markers.length > 1 || circles.length > 0) && maplibre) {
      const bounds = new maplibre.LngLatBounds();
      for (const item of markers) {
        bounds.extend([item.point.longitude, item.point.latitude]);
      }
      for (const circle of circles) {
        for (const [lng, lat] of circlePolygon(circle.center, circle.radiusMeters, 16).geometry.coordinates[0]) {
          bounds.extend([lng, lat]);
        }
      }
      map.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 0, pitch: MAP_PITCH, bearing: MAP_BEARING });
    } else if (!fit && markers[0]) {
      const current = map.getCenter();
      const target = markers[0].point;
      if (Math.abs(current.lat - target.latitude) > 1e-6 || Math.abs(current.lng - target.longitude) > 1e-6) {
        map.easeTo({ center: [target.longitude, target.latitude], duration: 300 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markerKey, circleKey, fit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) {
      return;
    }
    map.flyTo({ center: [focus.longitude, focus.latitude], zoom: Math.max(map.getZoom(), 16), duration: 600 });
  }, [ready, focus]);

  return (
    <div className="geo-map" style={{ height }}>
      <div ref={containerRef} className="geo-map__canvas" />
      {failed ? <p className="geo-map__notice">Không tải được nền bản đồ. Kiểm tra kết nối mạng.</p> : null}
    </div>
  );
}
