import { DateTime } from "luxon";
import type { AppConfig, ResolvedInterval, Trigger } from "./types.js";

export function resolveTriggerInterval(
  trigger: Trigger,
  config: Pick<AppConfig, "defaultTimezone">,
  now: DateTime<boolean> = DateTime.now(),
): ResolvedInterval {
  const timezone = config.defaultTimezone;
  const zonedNow = now.setZone(timezone);

  if (trigger.type === "schedule") {
    const preset = trigger.cadence === "weekly" ? "previous-week" : "previous-day";
    return resolveTriggerInterval({ type: "manual", preset }, config, zonedNow);
  }

  if ("preset" in trigger) {
    if (trigger.preset === "previous-week") {
      const start = zonedNow.minus({ weeks: 1 }).startOf("week");
      const end = start.plus({ weeks: 1 });
      return toInterval(start, end, timezone, "previous-week");
    }

    const start = zonedNow.minus({ days: 1 }).startOf("day");
    const end = start.plus({ days: 1 });
    return toInterval(start, end, timezone, "previous-day");
  }

  const start = parseBoundary(trigger.start, timezone, "start");
  const end = parseBoundary(trigger.end, timezone, "end");
  if (end <= start) {
    throw new Error(`Interval end must be after start: ${trigger.start} -> ${trigger.end}`);
  }
  return {
    startIso: toUtcIso(start),
    endIso: toUtcIso(end),
    timezone,
    label: `manual_${formatForLabel(start)}_to_${formatForLabel(end)}`,
  };
}

function parseBoundary(value: string, timezone: string, role: "start" | "end"): DateTime<boolean> {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly
    ? DateTime.fromISO(value, { zone: timezone })
    : DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) {
    throw new Error(`Invalid ${role} time "${value}": ${parsed.invalidExplanation}`);
  }
  return dateOnly ? parsed.startOf("day") : parsed;
}

function toInterval(
  start: DateTime<boolean>,
  end: DateTime<boolean>,
  timezone: string,
  labelPrefix: string,
): ResolvedInterval {
  const label = `${labelPrefix}_${start.toFormat("yyyy-LL-dd")}_to_${end.toFormat("yyyy-LL-dd")}`;
  return {
    startIso: toUtcIso(start),
    endIso: toUtcIso(end),
    timezone,
    label,
  };
}

function toUtcIso(value: DateTime<boolean>): string {
  return value.toUTC().toISO({ suppressMilliseconds: true }) ?? value.toUTC().toISO()!;
}

function formatForLabel(value: DateTime<boolean>): string {
  return value.toFormat("yyyy-LL-dd'T'HHmmss");
}
