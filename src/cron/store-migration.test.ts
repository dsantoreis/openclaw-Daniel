import { describe, expect, it } from "vitest";
import { normalizeStoredCronJobs } from "./store-migration.js";

describe("normalizeStoredCronJobs", () => {
  it("normalizes legacy cron fields and reports migration issues", () => {
    const jobs = [
      {
        jobId: "legacy-job",
        schedule: { kind: "cron", cron: "*/5 * * * *", tz: "UTC" },
        message: "say hi",
        model: "openai/gpt-4.1",
        deliver: true,
        provider: " TeLeGrAm ",
        to: "12345",
      },
    ] as Array<Record<string, unknown>>;

    const result = normalizeStoredCronJobs(jobs);

    expect(result.mutated).toBe(true);
    expect(result.issues).toMatchObject({
      jobId: 1,
      legacyScheduleCron: 1,
      legacyTopLevelPayloadFields: 1,
      legacyTopLevelDeliveryFields: 1,
    });

    const [job] = jobs;
    expect(job?.jobId).toBeUndefined();
    expect(job?.id).toBe("legacy-job");
    expect(job?.schedule).toMatchObject({
      kind: "cron",
      expr: "*/5 * * * *",
      tz: "UTC",
    });
    expect(job?.message).toBeUndefined();
    expect(job?.provider).toBeUndefined();
    expect(job?.delivery).toMatchObject({
      mode: "announce",
      channel: "telegram",
      to: "12345",
    });
    expect(job?.payload).toMatchObject({
      kind: "agentTurn",
      message: "say hi",
      model: "openai/gpt-4.1",
    });
  });

  it("is idempotent on already-normalized jobs", () => {
    const jobs = [
      {
        id: "already-normalized",
        name: "test job",
        enabled: true,
        wakeMode: "now",
        sessionTarget: "isolated",
        schedule: { kind: "cron", expr: "*/5 * * * *" },
        payload: {
          kind: "agentTurn",
          message: "hello",
        },
        delivery: { mode: "announce" },
        state: {},
      },
    ] as Array<Record<string, unknown>>;

    const _first = normalizeStoredCronJobs(jobs);
    // First pass may touch stagger or minor fields
    const snapshot = JSON.parse(JSON.stringify(jobs));

    const second = normalizeStoredCronJobs(snapshot);
    expect(second.issues).toEqual({});
    expect(second.mutated).toBe(false);
  });

  it("does not flag agentTurn/systemEvent as legacy payload kind", () => {
    const jobs = [
      {
        id: "correct-kind",
        name: "already correct",
        enabled: true,
        wakeMode: "now",
        sessionTarget: "isolated",
        schedule: { kind: "every", everyMs: 60_000, anchorMs: 0 },
        payload: { kind: "agentTurn", message: "hi" },
        delivery: { mode: "announce" },
        state: {},
      },
    ] as Array<Record<string, unknown>>;

    const result = normalizeStoredCronJobs(jobs);
    expect(result.issues.legacyPayloadKind).toBeUndefined();
  });

  it("normalizes payload provider alias into channel", () => {
    const jobs = [
      {
        id: "legacy-provider",
        schedule: { kind: "every", everyMs: 60_000 },
        payload: {
          kind: "agentTurn",
          message: "ping",
          provider: " Slack ",
        },
      },
    ] as Array<Record<string, unknown>>;

    const result = normalizeStoredCronJobs(jobs);

    expect(result.mutated).toBe(true);
    expect(result.issues.legacyPayloadProvider).toBe(1);
    expect(jobs[0]?.payload).toMatchObject({
      kind: "agentTurn",
      message: "ping",
    });
    const payload = jobs[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.provider).toBeUndefined();
    expect(jobs[0]?.delivery).toMatchObject({
      mode: "announce",
      channel: "slack",
    });
  });
});
