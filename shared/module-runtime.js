/**
 * Runtime por itinerario.
 *
 * REGLA DE INDEPENDENCIA:
 * - Cada itinerario tiene SU propio runtime (Cemento no comparte estado con Cerro Verde).
 * - Cada módulo se monta/desmonta de forma aislada.
 * - Los módulos SOLO se comunican entre sí a través de:
 *     runtime.bus.emit / runtime.bus.on
 *     runtime.state.get / runtime.state.set
 * - Un módulo NUNCA importa el código interno de otro módulo.
 * - Modificar un módulo de Cemento no toca archivos de Cerro Verde (y viceversa).
 */

/**
 * @param {string} itineraryId  ej. "cemento" | "cerro-verde"
 * @param {object} [options]
 * @param {object} [options.api]  endpoints / helpers específicos del itinerario
 * @param {object} [options.auth] referencia a Firebase auth
 */
export function createItineraryRuntime(itineraryId, options = {}) {
  if (!itineraryId) throw new Error("createItineraryRuntime: falta itineraryId");

  const listeners = new Map(); // event -> Set<fn>
  const state = Object.create(null);
  let currentModuleId = null;

  const bus = {
    on(event, fn) {
      if (typeof fn !== "function") return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => bus.off(event, fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[${itineraryId}] bus handler error on "${event}":`, err);
        }
      }
    },
    /** Elimina todos los listeners (útil al destruir el runtime). */
    clear() {
      listeners.clear();
    },
  };

  const stateApi = {
    get(key) {
      return state[key];
    },
    set(key, value) {
      const prev = state[key];
      state[key] = value;
      bus.emit(`state:${key}`, { key, value, prev });
      bus.emit("state:change", { key, value, prev });
      return value;
    },
    /** Devuelve una copia superficial del estado (solo lectura). */
    snapshot() {
      return { ...state };
    },
    /** Borra una clave. */
    delete(key) {
      if (!(key in state)) return;
      const prev = state[key];
      delete state[key];
      bus.emit(`state:${key}`, { key, value: undefined, prev });
      bus.emit("state:change", { key, value: undefined, prev });
    },
  };

  return {
    itineraryId,
    auth: options.auth ?? null,
    api: options.api ?? {},
    bus,
    state: stateApi,

    get currentModule() {
      return currentModuleId;
    },
    _setCurrentModule(id) {
      currentModuleId = id;
    },
  };
}

/**
 * Carga y monta un módulo de forma aislada.
 * Si había otro módulo montado, lo desmonta primero.
 *
 * @param {object} runtime
 * @param {HTMLElement} container  #content
 * @param {object} registry  { [id]: () => Promise<Module> }
 * @param {string} moduleId
 */
export async function loadModule(runtime, container, registry, moduleId) {
  const loader = registry[moduleId];
  if (!loader) {
    throw new Error(
      `[${runtime.itineraryId}] Módulo desconocido: "${moduleId}". ` +
        `Agrégalo solo en el registry de este itinerario.`,
    );
  }

  // Desmontar el módulo actual (si existe y expone unmount)
  const prevId = runtime.currentModule;
  if (prevId && runtime._currentUnmount) {
    try {
      await runtime._currentUnmount();
    } catch (err) {
      console.error(`[${runtime.itineraryId}] error al desmontar "${prevId}":`, err);
    }
    runtime._currentUnmount = null;
  }

  // Limpiar el contenedor para que el nuevo módulo empiece limpio
  container.innerHTML = "";
  runtime._setCurrentModule(moduleId);

  const mod = await loader();
  if (typeof mod.mount !== "function") {
    throw new Error(
      `[${runtime.itineraryId}] El módulo "${moduleId}" debe exportar async function mount(container, runtime)`,
    );
  }

  await mod.mount(container, runtime);

  if (typeof mod.unmount === "function") {
    runtime._currentUnmount = () => mod.unmount();
  }

  runtime.bus.emit("module:mounted", { moduleId });
  return mod;
}
