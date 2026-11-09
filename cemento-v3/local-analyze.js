/**
 * Análisis de ruta GPS en el navegador (Cemento V3).
 * Usa geocercas del bootstrap local — no reenvía puntos al servidor.
 * Misma regla operativa de CEMENTO: permanencia ≥ 20 min = visita confirmada.
 */

export function pointInRing(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0] ?? ring[i].lng ?? ring[i].lon);
    const yi = Number(ring[i][1] ?? ring[i].lat);
    const xj = Number(ring[j][0] ?? ring[j].lng ?? ring[j].lon);
    const yj = Number(ring[j][1] ?? ring[j].lat);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function fenceRing(f) {
  const g = f?.geometry || f?.geojson?.geometry || f;
  if (!g) return null;
  if (g.type === "Polygon" && Array.isArray(g.coordinates?.[0])) return g.coordinates[0];
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates?.[0]?.[0]))
    return g.coordinates[0][0];
  if (Array.isArray(f.ring)) return f.ring;
  if (Array.isArray(f.coordinates?.[0]) && typeof f.coordinates[0][0] === "number")
    return f.coordinates[0];
  return null;
}

export function normalizeFences(list) {
  const out = [];
  for (const f of list || []) {
    if (!f) continue;
    const kind = String(f.kind || "geocerca");
    if (kind && kind !== "geocerca" && kind !== "geocerca_tramo") continue;
    const ring = fenceRing(f);
    if (!ring?.length) continue;
    const name = String(f.name || f.nombre || f.originalName || f.id || "").trim();
    if (!name) continue;
    out.push({
      id: f.id || f.maestro_id || name,
      name,
      ring,
      kind,
    });
  }
  return out;
}

function zoneAt(lat, lng, fences) {
  for (const f of fences) {
    if (pointInRing(lat, lng, f.ring)) return f;
  }
  return null;
}

function timeMs(fecha) {
  const s = String(fecha || "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @param {Array<{lat:number,lng:number,fecha?:string}>} points
 * @param {any[]} geocercasRaw  del bootstrap (session.geocercas)
 * @param {number} [minMin=20]
 */
export function analyzeRouteLocal(points, geocercasRaw, minMin = 20) {
  const fences = normalizeFences(geocercasRaw);
  const ordered = (points || [])
    .map((p) => ({
      lat: Number(p.lat ?? p.latitude),
      lng: Number(p.lng ?? p.lon ?? p.longitude),
      fecha: p.fecha || p.fecha_hora || "",
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (!ordered.length) {
    return {
      puntos_evaluados: 0,
      permanencia_minima_minutos: minMin,
      visitas_confirmadas: [],
      visitas_no_confirmadas: [],
      estado_final: "SIN_PUNTOS",
      ultima_geocerca: "",
      geocercas_disponibles: fences.length,
      origen_analisis: "CEMENTO-local",
    };
  }

  const labels = ordered.map((p) => zoneAt(p.lat, p.lng, fences)?.name || "");
  const blocks = [];
  for (let start = 0; start < labels.length; ) {
    let end = start;
    while (end + 1 < labels.length && labels[end + 1] === labels[start]) end++;
    if (labels[start]) {
      const fence = fences.find((x) => x.name === labels[start]);
      const t0 = timeMs(ordered[start].fecha);
      const t1 = timeMs(ordered[end].fecha);
      const minutes =
        Number.isFinite(t0) && Number.isFinite(t1)
          ? Math.max(0, (t1 - t0) / 60000)
          : 0;
      blocks.push({
        geocerca_id: fence?.id || "",
        geocerca: labels[start],
        ingreso: ordered[start].fecha,
        ultimo_punto_dentro: ordered[end].fecha,
        salida: end < ordered.length - 1 ? ordered[end].fecha : null,
        permanencia_minutos: Math.round(minutes * 10) / 10,
        puntos_dentro: end - start + 1,
        confirmada: minutes >= minMin,
      });
    }
    start = end + 1;
  }

  const visits = blocks.filter((x) => x.confirmada);
  const last = ordered[ordered.length - 1];
  const lastZone = zoneAt(last.lat, last.lng, fences);

  return {
    puntos_evaluados: ordered.length,
    permanencia_minima_minutos: minMin,
    visitas_confirmadas: visits,
    visitas_no_confirmadas: blocks.filter((x) => !x.confirmada),
    estado_final:
      visits.length && labels.at(-1) === visits.at(-1)?.geocerca
        ? "EN GEOCERCA"
        : lastZone
          ? "EN GEOCERCA"
          : "TRÁNSITO",
    ultima_geocerca: visits.at(-1)?.geocerca || lastZone?.name || "",
    ultima_geocerca_id: visits.at(-1)?.geocerca_id || lastZone?.id || "",
    ubicacion_red: lastZone?.name || "",
    ubicacion_tramo: lastZone?.name || "",
    origen_analisis: "LOCAL_CEMENTO_V2",
    geocercas_disponibles: fences.length,
  };
}

/** Siempre reanaliza con las geocercas actuales de sesión (CEMENTO).
 *  No reutiliza visitas cacheadas de una corrida anterior (podrían ser de otro set).
 */
export function enrichGpsWithLocalAnalysis(gps, geocercasRaw) {
  if (!gps) return gps;
  const pts = gps.puntos_gps || gps.puntos || [];
  const points = Array.isArray(pts) ? pts : [];
  const fencesOk = Array.isArray(geocercasRaw) && geocercasRaw.length > 0;
  if (!points.length) {
    return {
      ...gps,
      analisis: {
        ...(gps.analisis || {}),
        visitas_confirmadas: [],
        visitas_no_confirmadas: [],
        geocercas_disponibles: fencesOk ? geocercasRaw.length : 0,
        origen_analisis: "CEMENTO-local",
        estado_final: "SIN_PUNTOS",
      },
    };
  }
  if (!fencesOk) {
    return {
      ...gps,
      analisis: {
        ...(gps.analisis || {}),
        geocercas_disponibles: 0,
        origen_analisis: "SIN-CARTOGRAFIA-CEMENTO",
        mensaje: "Sin geocercas CEMENTO en sesión. Use INICIAR SEGUIMIENTO.",
      },
    };
  }
  const local = analyzeRouteLocal(points, geocercasRaw, 20);
  return {
    ...gps,
    analisis: {
      ...local,
      origen_analisis: "CEMENTO-local",
      geocercas_disponibles: local.geocercas_disponibles,
    },
  };
}
