import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "./registry.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "./runtime.js";

describe("setActivePluginRegistry httpRoutes carry-forward", () => {
  // Each test starts from a clean baseline by setting an empty registry
  // as the "current" state, then immediately replacing it so the
  // carry-forward from this baseline contributes zero routes.
  beforeEach(() => {
    const baseline = createEmptyPluginRegistry();
    // Use internal Symbol to wipe state directly so carry-forward
    // doesn't leak routes between tests.
    const sym = Symbol.for("openclaw.pluginRegistryState");
    const gs = globalThis as Record<symbol, { registry: unknown; key: unknown; version: number }>;
    if (gs[sym]) {
      gs[sym].registry = baseline;
      gs[sym].key = "test-reset";
    }
  });

  it("carries forward httpRoutes from previous registry to new one", () => {
    const oldRegistry = createEmptyPluginRegistry();
    const handler = vi.fn();
    oldRegistry.httpRoutes = [
      {
        path: "/googlechat",
        handler,
        auth: "plugin",
        match: "exact",
        pluginId: "googlechat",
      },
    ];
    setActivePluginRegistry(oldRegistry, "old-key");

    const newRegistry = createEmptyPluginRegistry();
    expect(newRegistry.httpRoutes).toHaveLength(0);

    setActivePluginRegistry(newRegistry, "new-key");

    const active = getActivePluginRegistry();
    expect(active).toBe(newRegistry);
    expect(active?.httpRoutes).toHaveLength(1);
    expect(active?.httpRoutes[0]?.path).toBe("/googlechat");
    expect(active?.httpRoutes[0]?.handler).toBe(handler);
  });

  it("does not duplicate routes that already exist on the new registry", () => {
    const oldRegistry = createEmptyPluginRegistry();
    const oldHandler = vi.fn();
    oldRegistry.httpRoutes = [
      {
        path: "/line",
        handler: oldHandler,
        auth: "plugin",
        match: "exact",
        pluginId: "line",
      },
    ];
    setActivePluginRegistry(oldRegistry, "old");

    const newRegistry = createEmptyPluginRegistry();
    const newHandler = vi.fn();
    newRegistry.httpRoutes = [
      {
        path: "/line",
        handler: newHandler,
        auth: "plugin",
        match: "exact",
        pluginId: "line",
      },
    ];

    setActivePluginRegistry(newRegistry, "new");

    const active = getActivePluginRegistry();
    expect(active?.httpRoutes).toHaveLength(1);
    expect(active?.httpRoutes[0]?.handler).toBe(newHandler);
  });

  it("carries multiple routes from old registry", () => {
    const oldRegistry = createEmptyPluginRegistry();
    oldRegistry.httpRoutes = [
      {
        path: "/googlechat",
        handler: vi.fn(),
        auth: "plugin",
        match: "exact",
        pluginId: "googlechat",
      },
      {
        path: "/bluebubbles",
        handler: vi.fn(),
        auth: "plugin",
        match: "prefix",
        pluginId: "bluebubbles",
      },
    ];
    setActivePluginRegistry(oldRegistry, "old");

    const newRegistry = createEmptyPluginRegistry();
    setActivePluginRegistry(newRegistry, "new");

    expect(getActivePluginRegistry()?.httpRoutes).toHaveLength(2);
  });

  it("does not carry forward when swapping same registry object", () => {
    const registry = createEmptyPluginRegistry();
    registry.httpRoutes = [
      {
        path: "/test",
        handler: vi.fn(),
        auth: "plugin",
        match: "exact",
      },
    ];
    setActivePluginRegistry(registry, "same");
    setActivePluginRegistry(registry, "same-again");

    expect(getActivePluginRegistry()?.httpRoutes).toHaveLength(1);
  });
});
