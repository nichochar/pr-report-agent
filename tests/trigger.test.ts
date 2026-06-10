import { describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import { resolveTriggerInterval } from "../src/trigger.js";

describe("trigger intervals", () => {
  test("resolves previous day in Pacific time with UTC output", () => {
    const interval = resolveTriggerInterval(
      { type: "manual", preset: "previous-day" },
      { defaultTimezone: "America/Los_Angeles" },
      DateTime.fromISO("2026-06-09T12:00:00", { zone: "America/Los_Angeles" }),
    );

    expect(interval.startIso).toBe("2026-06-08T07:00:00Z");
    expect(interval.endIso).toBe("2026-06-09T07:00:00Z");
  });

  test("resolves explicit date boundaries as end-exclusive days", () => {
    const interval = resolveTriggerInterval(
      { type: "manual", start: "2026-06-08", end: "2026-06-09" },
      { defaultTimezone: "America/Los_Angeles" },
      DateTime.fromISO("2026-06-09T12:00:00", { zone: "America/Los_Angeles" }),
    );

    expect(interval.startIso).toBe("2026-06-08T07:00:00Z");
    expect(interval.endIso).toBe("2026-06-09T07:00:00Z");
  });

  test("schedule trigger maps to the same manual path", () => {
    const scheduled = resolveTriggerInterval(
      { type: "schedule", cadence: "daily" },
      { defaultTimezone: "America/Los_Angeles" },
      DateTime.fromISO("2026-06-09T12:00:00", { zone: "America/Los_Angeles" }),
    );

    expect(scheduled.label).toStartWith("previous-day_");
  });
});
