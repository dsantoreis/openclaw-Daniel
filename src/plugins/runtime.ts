import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";

const REGISTRY_STATE = Symbol.for("openclaw.pluginRegistryState");

type RegistryState = {
  registry: PluginRegistry | null;
  key: string | null;
  version: number;
};

const state: RegistryState = (() => {
  const globalState = globalThis as typeof globalThis & {
    [REGISTRY_STATE]?: RegistryState;
  };
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      registry: createEmptyPluginRegistry(),
      key: null,
      version: 0,
    };
  }
  return globalState[REGISTRY_STATE];
})();

export function setActivePluginRegistry(registry: PluginRegistry, cacheKey?: string) {
  // Carry forward dynamically registered httpRoutes from the previous registry
  // so that webhook routes registered by channels survive registry swaps.
  // Channels register their routes once during startup and do not re-register
  // when the registry object is replaced by config schema lookups or probes.
  const previous = state.registry;
  if (previous && previous !== registry && previous.httpRoutes && previous.httpRoutes.length > 0) {
    const existingRoutes = registry.httpRoutes ?? [];
    registry.httpRoutes = existingRoutes;
    for (const oldRoute of previous.httpRoutes) {
      const alreadyExists = existingRoutes.some(
        (r) => r.path === oldRoute.path && r.match === oldRoute.match,
      );
      if (!alreadyExists) {
        existingRoutes.push(oldRoute);
      }
    }
  }
  state.registry = registry;
  state.key = cacheKey ?? null;
  state.version += 1;
}

export function getActivePluginRegistry(): PluginRegistry | null {
  return state.registry;
}

export function requireActivePluginRegistry(): PluginRegistry {
  if (!state.registry) {
    state.registry = createEmptyPluginRegistry();
    state.version += 1;
  }
  return state.registry;
}

export function getActivePluginRegistryKey(): string | null {
  return state.key;
}

export function getActivePluginRegistryVersion(): number {
  return state.version;
}
