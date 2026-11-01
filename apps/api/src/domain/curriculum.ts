// Placing plan topics on a group's lessons (lesson-plan.md §4.4, §4.6). Pure: no database access.
//
// Every item takes `hours` consecutive lessons, in plan order. An item bound to a period stays inside that period's
// lessons: earlier lessons are skipped, and what does not fit before the period ends is reported, not spilled over.
// Lessons whose topic is already fixed (held or in the past) are not passed in; their hours are taken off the items
// with `consumedHours` first.

export interface PlaceItem {
  id: string;
  topicId: string;
  hours: number;
  periodId: string | null;
}

export interface PlaceSession {
  id: string;
  periodId: string;
}

export type PlacementWarning =
  /** The item (or `hours` of it) found no lesson. */
  | { kind: "NOT_PLACED"; itemId: string; hours: number }
  /** Part of the item did not fit inside its period. */
  | { kind: "PERIOD_OVERFLOW"; itemId: string; hours: number };

export interface Placement {
  /** sessionId → planItemId for every session that gets a topic. */
  bySession: Map<string, string>;
  warnings: PlacementWarning[];
  /** Lessons left without a topic at the end. */
  freeSessions: number;
}

/**
 * Hours already taken per topic by lessons whose topic is fixed: they come off the first items with that topic,
 * so a new plan version (new item ids, same topics) continues where the old one stopped.
 */
export function remainingHours(items: PlaceItem[], consumedByTopic: Map<string, number>): Map<string, number> {
  const left = new Map(consumedByTopic);
  const remaining = new Map<string, number>();
  for (const item of items) {
    const used = Math.min(item.hours, left.get(item.topicId) ?? 0);
    left.set(item.topicId, (left.get(item.topicId) ?? 0) - used);
    remaining.set(item.id, item.hours - used);
  }
  return remaining;
}

/** `sessions` in lesson order (sequenceNo), cancelled ones left out. */
export function placeTopics(
  items: PlaceItem[],
  sessions: PlaceSession[],
  remaining: Map<string, number> = new Map(items.map((i) => [i.id, i.hours])),
): Placement {
  const bySession = new Map<string, string>();
  const warnings: PlacementWarning[] = [];
  let next = 0;
  for (const item of items) {
    let need = remaining.get(item.id) ?? item.hours;
    if (need <= 0) continue;
    if (item.periodId) {
      // Skip to the item's period; lessons of earlier periods stay free.
      let i = next;
      while (i < sessions.length && sessions[i]!.periodId !== item.periodId) i++;
      if (i < sessions.length) next = i;
      while (need > 0 && next < sessions.length && sessions[next]!.periodId === item.periodId) {
        bySession.set(sessions[next]!.id, item.id);
        next++;
        need--;
      }
      if (need > 0) {
        const anyInPeriod = sessions.some((s) => s.periodId === item.periodId);
        warnings.push({ kind: anyInPeriod ? "PERIOD_OVERFLOW" : "NOT_PLACED", itemId: item.id, hours: need });
      }
      continue;
    }
    while (need > 0 && next < sessions.length) {
      bySession.set(sessions[next]!.id, item.id);
      next++;
      need--;
    }
    if (need > 0) warnings.push({ kind: "NOT_PLACED", itemId: item.id, hours: need });
  }
  return { bySession, warnings, freeSessions: sessions.length - bySession.size };
}
