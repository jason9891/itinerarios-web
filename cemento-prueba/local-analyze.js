/**
 * Análisis GPS en el navegador (sin reenviar puntos al principal).
 * Geocercas: se cargan una vez desde la cuenta operador.
 */

/** Ray-casting point in polygon. ring = [[lng,lat], ...] o [{lat,lng}] */
export function pointInRing(lat, lng, ring) {
  if (!ring?.length) return false;
  const pts = ring.map((p) =>
    Array.isArray(p) ? { lng: +p[0], lat: +p[1] } : { lat: +p.lat, lng: +p.lng },
  );
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng, yi = pts[i].lat;
    const xj = pts[j].lng, yj = pts[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function normalizeFence(f) {
  const name = f.name || f.nombre || f.originalName || "SIN NOMBRE";
  let ring = [];
  const g = f.geometry || f.geom || f;
  if (g?.type === "Polygon" && Array.isArray(g.coordinates?.[0])) ring = g.coordinates[0];
  else if (Array.isArray(f.coordinates?.[0])) ring = f.coordinates[0];
  else if (Array.isArray(f.poly)) ring = f.poly;
  return { name, ring, role: f.role || f.rol || "" };
}

export function zoneAt(lat, lng, fences) {
  for (const f of fences) {
    if (f.ring?.length && pointInRing(lat, lng, f.ring)) return f;
  }
  return null;
}

/**
 * Análisis local mínimo por unidad.
 * @param {Array<{lat:number,lng:number,fecha?:string}>} points
 * @param {ReturnType<normalizeFence>[]} fences
 */
export function analyzeLocal(points, fences) {
  const ordered = (points || [])
    .map((p) => ({ lat: +p.lat, lng: +p.lng, fecha: p.fecha || "" }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!ordered.length) {
    return {
      puntos: 0,
      estado_final: "SIN_PUNTOS",
      ultima_geocerca: "",
      monitoreo_sugerido: "",
      paradas_estimadas: 0,
    };
  }
  const last = ordered[ordered.length - 1];
  const z = zoneAt(last.lat, last.lng, fences);

  // Paradas simples: agrupación por distancia/tiempo
  let paradas = 0;
  let cluster = [ordered[0]];
  const dist = (a, b) => {
    const R = 6371000;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };
  for (let i = 1; i < ordered.length; i++) {
    const prev = cluster[cluster.length - 1];
    if (dist(prev, ordered[i]) <= 120) cluster.push(ordered[i]);
    else {
      if (cluster.length >= 3) paradas++;
      cluster = [ordered[i]];
    }
  }
  if (cluster.length >= 3) paradas++;

  return {
    puntos: ordered.length,
    estado_final: z ? "EN GEOCERCA" : "TRÁNSITO",
    ultima_geocerca: z?.name || "",
    monitoreo_sugerido: z?.name || "",
    paradas_estimadas: paradas,
    punto_fin: { lat: last.lat, lng: last.lng, fecha: last.fecha },
    punto_inicio: {
      lat: ordered[0].lat,
      lng: ordered[0].lng,
      fecha: ordered[0].fecha,
    },
  };
}

/** Resumen texto listo para mensaje al principal (sin puntos GPS). */
export function buildPrincipalMessage(meta, rows) {
  const lines = [
    `ANÁLISIS LOCAL · ${meta.itinerario || "CEMENTO PRUEBA"}`,
    `Usuario: ${meta.usuario || "—"}`,
    `Operador ref: ${meta.operador_ref || "—"}`,
    `Rango: ${meta.desde || "—"} → ${meta.hasta || "—"}`,
    `Unidades: ${rows.length}`,
    `Geocercas cargadas: ${meta.geocercas_n || 0}`,
    `Generado: ${meta.generado || new Date().toISOString()}`,
    "---",
  ];
  for (const r of rows) {
    lines.push(
      `${r.placa} | pts=${r.puntos} | ${r.estado_final}` +
        (r.ultima_geocerca ? ` | geo=${r.ultima_geocerca}` : "") +
        (r.error ? ` | ERR=${r.error}` : ""),
    );
  }
  return lines.join("\n");
}
