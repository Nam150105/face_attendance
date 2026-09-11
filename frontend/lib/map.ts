/**
 * Map plumbing shared by the location editor and the record viewer.
 *
 * Tiles come from OpenFreeMap: vector tiles rendered by MapLibre in the
 * browser, no key, no quota. The style is public and the URL is the whole
 * configuration — swapping providers is changing this one constant.
 */
import type { Feature, Polygon } from "geojson";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Hanoi, for a form that has no point yet. */
export const MAP_FALLBACK: GeoPoint = { latitude: 21.0285, longitude: 105.8048 };

/**
 * A circle of `radiusMeters` around a point, as a polygon the map can draw.
 *
 * A vector map has no notion of metres — a "circle" layer is sized in pixels
 * and grows with zoom — so a geofence is drawn as sixty-four short edges
 * computed on the sphere, which stays the right size at every zoom.
 */
export function circlePolygon(center: GeoPoint, radiusMeters: number, steps = 64): Feature<Polygon> {
  const earth = 6371000;
  const lat = (center.latitude * Math.PI) / 180;
  const lng = (center.longitude * Math.PI) / 180;
  const angular = radiusMeters / earth;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const pointLng =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat),
      );
    ring.push([(pointLng * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** A zoom at which a circle of this radius fills a comfortable share of the view. */
export function zoomForRadius(radiusMeters: number, latitude: number): number {
  // Metres per pixel at zoom z is 156543.03 · cos(lat) / 2^z; aim for the
  // circle's diameter to take about 320 px.
  const metersPerPixel = (2 * radiusMeters) / 320;
  const zoom = Math.log2((156543.03 * Math.cos((latitude * Math.PI) / 180)) / metersPerPixel);
  return Math.min(19, Math.max(3, zoom));
}
