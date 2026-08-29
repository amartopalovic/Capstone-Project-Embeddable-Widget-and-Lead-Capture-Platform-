import type { Db, Filter, ObjectId, WithId } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import type {
  DailyAnalyticsRecord,
  InteractionEventRecord,
  InteractionEventType,
} from '../records/index.js';
import { WorkspaceScopedRepository } from './base-repository.js';
import type { WorkspaceScope } from './workspace-scope.js';

/** Raw funnel events (blueprint 9.2, 13.2 step 2). */
export class InteractionEventRepository extends WorkspaceScopedRepository<InteractionEventRecord> {
  protected readonly collectionName = COLLECTIONS.interactionEvents;

  constructor(db: Db) {
    super(db);
  }

  /** How many events this workspace has recorded since a month boundary. */
  async countSince(scope: WorkspaceScope, since: Date): Promise<number> {
    return this.count(scope, { occurredAt: { $gte: since } });
  }

  /**
   * One workspace-day's events, grouped for aggregation.
   *
   * Grouped in the database rather than streamed into memory: a busy day is
   * tens of thousands of documents, and the aggregate is a handful of rows.
   *
   * `visitors` is a distinct count of the rotating pseudonym. It is computed
   * here and only the COUNT is kept, so the aggregate that outlives the raw
   * events cannot be used to re-identify anybody.
   */
  async aggregateDay(
    scope: WorkspaceScope,
    localDay: string,
  ): Promise<
    {
      readonly widgetId: ObjectId;
      readonly dimension: string;
      readonly dimensionValue: string | null;
      readonly counts: Partial<Record<InteractionEventType, number>>;
      readonly visitors: number;
    }[]
  > {
    /**
     * One pass over the day, fanned out into the dimension slices.
     *
     * `$facet` would run the collection scan once per slice; unwinding a
     * synthetic array of `{dimension, value}` pairs instead means the events
     * are read once and every slice falls out of the same group stage.
     */
    return this.collection
      .aggregate<{
        widgetId: ObjectId;
        dimension: string;
        dimensionValue: string | null;
        counts: Partial<Record<InteractionEventType, number>>;
        visitors: number;
      }>([
        { $match: this.scopedFilter(scope, { localDay } as Filter<InteractionEventRecord>) },
        {
          $project: {
            widgetId: 1,
            type: 1,
            visitorPseudonym: 1,
            slices: {
              $concatArrays: [
                [{ dimension: 'total', value: null }],
                {
                  $cond: [
                    { $ifNull: ['$source.domain', false] },
                    [{ dimension: 'domain', value: '$source.domain' }],
                    [],
                  ],
                },
                {
                  $cond: [
                    { $ifNull: ['$source.pageUrl', false] },
                    [{ dimension: 'page', value: '$source.pageUrl' }],
                    [],
                  ],
                },
                {
                  $cond: [
                    { $ifNull: ['$geo.countryCode', false] },
                    [{ dimension: 'country', value: '$geo.countryCode' }],
                    [],
                  ],
                },
                {
                  $cond: [
                    { $ifNull: ['$geo.city', false] },
                    [{ dimension: 'city', value: '$geo.city' }],
                    [],
                  ],
                },
              ],
            },
          },
        },
        { $unwind: '$slices' },
        {
          $group: {
            _id: {
              widgetId: '$widgetId',
              dimension: '$slices.dimension',
              dimensionValue: '$slices.value',
              type: '$type',
            },
            n: { $sum: 1 },
            visitors: { $addToSet: '$visitorPseudonym' },
          },
        },
        {
          $group: {
            _id: {
              widgetId: '$_id.widgetId',
              dimension: '$_id.dimension',
              dimensionValue: '$_id.dimensionValue',
            },
            counts: { $push: { k: '$_id.type', v: '$n' } },
            visitors: { $addToSet: '$visitors' },
          },
        },
        {
          $project: {
            _id: 0,
            widgetId: '$_id.widgetId',
            dimension: '$_id.dimension',
            dimensionValue: '$_id.dimensionValue',
            counts: { $arrayToObject: '$counts' },
            visitors: {
              $size: {
                $reduce: {
                  input: '$visitors',
                  initialValue: [],
                  in: { $setUnion: ['$$value', '$$this'] },
                },
              },
            },
          },
        },
      ])
      .toArray();
  }

  /** Which workspace-days have raw events older than a cutoff. */
  async staleDays(
    before: Date,
    limit = 50,
  ): Promise<{ readonly workspaceId: ObjectId; readonly localDay: string }[]> {
    return this.collection
      .aggregate<{ workspaceId: ObjectId; localDay: string }>([
        { $match: { occurredAt: { $lt: before } } },
        { $group: { _id: { workspaceId: '$workspaceId', localDay: '$localDay' } } },
        { $limit: limit },
        { $project: { _id: 0, workspaceId: '$_id.workspaceId', localDay: '$_id.localDay' } },
      ])
      .toArray();
  }

  /** Delete one workspace-day's raw events. Callers must check the aggregate. */
  async deleteDay(scope: WorkspaceScope, localDay: string): Promise<number> {
    const result = await this.collection.deleteMany(
      this.scopedFilter(scope, { localDay } as Filter<InteractionEventRecord>),
    );
    return result.deletedCount;
  }
}

/** Durable daily counters (blueprint 9.2, 13.2 step 3). */
export class DailyAnalyticsRepository extends WorkspaceScopedRepository<DailyAnalyticsRecord> {
  protected readonly collectionName = COLLECTIONS.dailyAnalytics;

  constructor(db: Db) {
    super(db);
  }

  /**
   * Write one slice, replacing any previous value for the same key.
   *
   * An upsert on the unique key rather than an insert or an increment, and that
   * choice is what makes the aggregation job idempotent: re-running a day
   * recomputes the counters from the raw events and overwrites, so running it
   * twice produces the same numbers rather than double them.
   */
  async upsertSlice(
    scope: WorkspaceScope,
    slice: Omit<DailyAnalyticsRecord, '_id' | 'workspaceId'>,
  ): Promise<void> {
    await this.collection.updateOne(
      this.scopedFilter(scope, {
        day: slice.day,
        widgetId: slice.widgetId,
        dimension: slice.dimension,
        dimensionValue: slice.dimensionValue,
      } as Filter<DailyAnalyticsRecord>),
      { $set: { ...slice, workspaceId: scope.workspaceId } as never },
      { upsert: true },
    );
  }

  async findForDay(scope: WorkspaceScope, day: string): Promise<WithId<DailyAnalyticsRecord>[]> {
    return this.findMany(scope, { day } as Filter<DailyAnalyticsRecord>);
  }

  /** Whether a day has been aggregated at all - the expiry precondition. */
  async hasAggregateFor(scope: WorkspaceScope, day: string): Promise<boolean> {
    return (await this.count(scope, { day } as Filter<DailyAnalyticsRecord>)) > 0;
  }

  async listRange(
    scope: WorkspaceScope,
    fromDay: string,
    toDay: string,
    dimension: DailyAnalyticsRecord['dimension'] = 'total',
  ): Promise<WithId<DailyAnalyticsRecord>[]> {
    return this.findMany(
      scope,
      { day: { $gte: fromDay, $lte: toDay }, dimension } as Filter<DailyAnalyticsRecord>,
      { sort: { day: 1 } },
    );
  }
}
