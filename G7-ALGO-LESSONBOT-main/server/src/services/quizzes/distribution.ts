/**
 * Assessment topic distribution.
 *
 * Pure functions, no I/O: the distribution is decided here so it can be
 * tested exactly, and so the generator never has to guess how many questions
 * a topic owes the assessment.
 *
 * The default scope is the WHOLE canonical catalog. The caller passes the
 * topic list it resolved from the catalog; this module never hardcodes topic
 * ids or assumes a particular catalog size.
 */

export interface TopicQuota {
  topicId: string;
  count: number;
}

export interface DistributionPlan {
  quotas: TopicQuota[];
  /**
   * Topics that received no question this run because the requested length
   * was shorter than the catalog. Coverage rotates across runs so repeated
   * short assessments still touch every topic over time.
   */
  omitted: string[];
  /** True when the plan could not cover every supplied topic. */
  partial: boolean;
}

/**
 * Split `count` questions across `topicIds` as evenly as the numbers allow.
 *
 * Every topic gets either floor(count/n) or ceil(count/n) questions — the
 * remainder is spread across the FIRST topics in catalog order, never piled
 * onto one. When count < topicCount the plan rotates by `offset` so the
 * topics that miss out differ between runs; the caller passes an increasing
 * offset (e.g. a counter or the minute of the hour).
 *
 * An empty topic list is a programming error, not a user error: there is no
 * meaningful assessment without a scope, so it throws rather than returning a
 * plan that silently answers nothing.
 */
export function planDistribution(count: number, topicIds: string[], offset = 0): DistributionPlan {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`assessment count must be a positive integer (got ${count})`);
  }
  if (topicIds.length === 0) {
    throw new Error("assessment distribution needs at least one topic");
  }

  const base = Math.floor(count / topicIds.length);
  const remainder = count % topicIds.length;

  if (base === 0) {
    // Fewer questions than topics: rotate which topics are represented so the
    // same first topics are not always the only ones assessed.
    const start = ((offset % topicIds.length) + topicIds.length) % topicIds.length;
    const rotated = [...topicIds.slice(start), ...topicIds.slice(0, start)];
    const chosen = rotated.slice(0, count);
    const omitted = topicIds.filter((id) => !chosen.includes(id));
    return {
      quotas: chosen.map((topicId) => ({ topicId, count: 1 })),
      omitted,
      partial: true,
    };
  }

  const quotas = topicIds.map((topicId, i) => ({
    topicId,
    count: base + (i < remainder ? 1 : 0),
  }));
  return { quotas, omitted: [], partial: false };
}

/**
 * Interleave questions from the quota groups so a combined assessment reads
 * as a mixed paper rather than five single-topic blocks. Round-robin over the
 * groups, in the order they are given, cycling until each is exhausted.
 */
export function interleave<T>(groups: T[][]): T[] {
  const cursors = groups.map(() => 0);
  const out: T[] = [];
  let remaining = groups.reduce((n, g) => n + g.length, 0);
  while (remaining > 0) {
    for (let i = 0; i < groups.length; i++) {
      const cursor = cursors[i];
      if (cursor < groups[i].length) {
        out.push(groups[i][cursor]);
        cursors[i] = cursor + 1;
        remaining -= 1;
      }
    }
  }
  return out;
}
