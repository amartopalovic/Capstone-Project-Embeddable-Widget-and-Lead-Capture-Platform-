import type { ReactNode } from 'react';

/**
 * Chart primitives for the analytics dashboards (blueprint 4.9, 14.1).
 *
 * **No charting library.** Every shape these dashboards need is one of three:
 * a daily series, a funnel, and a ranked list. All three are a handful of
 * divs with a width, and a library would bring 50-150 KB, its own DOM, its own
 * focus and ARIA behaviour, and its own opinions about colour - three of which
 * would fight the design system and the WCAG bar this project already meets.
 * Blueprint 8.3 enforces bundle budgets with tests; spending them here would
 * buy nothing.
 *
 * **The chart IS the table.** The usual way to make a chart accessible is a
 * visually-hidden table beside it, which is a second copy of the data that can
 * drift from the first. Here the bar is drawn as a background on the real
 * table cell that already contains the number. One DOM node carries both, a
 * screen reader reads an ordinary table, and there is nothing to keep in sync.
 */

// ---------------------------------------------------------------------------
// Rate
// ---------------------------------------------------------------------------

/**
 * A rate, or "no data".
 *
 * The single most important correctness rule on this page, in one place so it
 * cannot be got wrong twice. `null` means the denominator was zero - nobody saw
 * the widget, nobody opened the form - and rendering that as "0%" would assert
 * something the data does not support: that people arrived and did not act.
 *
 * The type makes it unavoidable. A caller cannot hand this a plain number that
 * was silently defaulted from null upstream, because the server's own DTO types
 * every rate as `number | null`.
 */
export function Rate({
  value,
  basis,
  reason,
}: {
  readonly value: number | null;
  readonly basis?: string | null;
  /**
   * Why this rate is undefined, when the answer is structural rather than
   * "nothing has happened yet".
   *
   * A dash beside a healthy count reads as a broken page. When the reason is
   * knowable - an always-visible widget has no "opened" step, so its open rate
   * has no denominator at all - saying so turns an apparent defect into an
   * explanation. Nothing is computed here: the caller decides from counts the
   * server already sent.
   */
  readonly reason?: string;
}): React.JSX.Element {
  if (value === null) {
    return (
      <span className="font-mono text-sm text-muted" data-testid="rate-no-data">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No data</span>
        {reason !== undefined && (
          <span className="ml-2 font-sans text-[11px] normal-case tracking-normal text-muted">
            {reason}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="font-mono text-sm text-ink">
      {(value * 100).toFixed(1)}%
      {basis !== undefined && basis !== null && (
        <span className="ml-1 text-[10px] uppercase tracking-[0.14em] text-muted">of {basis}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function Panel({
  title,
  hint,
  children,
  testId,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
  readonly testId?: string;
}): React.JSX.Element {
  const id = `panel-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section
      aria-labelledby={id}
      className="border border-edge bg-panel p-5"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function NoData({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface FunnelStage {
  readonly label: string;
  readonly count: number;
  /** Conversion from the PREVIOUS stage. Null at the first, or with no data. */
  readonly rate: number | null;
  /** Why the rate is undefined, when that has a knowable cause. */
  readonly reason?: string;
}

/**
 * The funnel - the hero of this page.
 *
 * Not a row of KPI cards. This whole product is a five-step path from "somebody
 * saw it" to "somebody submitted", and the useful information is where people
 * fall out, so the drop between stages is drawn rather than left for the reader
 * to compute from four separate numbers.
 *
 * Bars are proportional to the FIRST stage, so the shape of the taper is the
 * shape of the loss. Each row carries the step-down rate beside it.
 *
 * Rendered as a table because that is what it is: labelled rows of numbers. The
 * bar is a background on the count cell.
 */
export function Funnel({ stages }: { readonly stages: readonly FunnelStage[] }): React.JSX.Element {
  const top = stages[0]?.count ?? 0;
  if (top === 0) {
    return <NoData>Nothing has been seen yet, so there is no funnel to draw.</NoData>;
  }

  return (
    <table data-testid="funnel" className="w-full border-collapse text-sm">
      <caption className="sr-only">
        Funnel from first view to submitted, with conversion from each step to the next
      </caption>
      <thead>
        <tr>
          <th
            scope="col"
            className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            Stage
          </th>
          <th
            scope="col"
            className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            People
          </th>
          <th
            scope="col"
            className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            From previous
          </th>
        </tr>
      </thead>
      <tbody>
        {stages.map((stage) => {
          const width = Math.round((stage.count / top) * 100);
          return (
            <tr key={stage.label} className="border-t border-edge">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                {stage.label}
              </th>
              <td className="relative py-2 pr-4 text-right align-middle">
                {/*
                 * The bar and the number share one cell. Absolutely positioned
                 * behind the text so the number stays selectable and readable,
                 * and hidden from assistive technology because the number it
                 * sits behind already says the same thing.
                 */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 left-0 bg-signal/15"
                  style={{ width: `${String(width)}%` }}
                />
                <span className="relative font-mono text-ink">{stage.count.toLocaleString()}</span>
              </td>
              <td className="py-2 text-right">
                <Rate
                  value={stage.rate}
                  {...(stage.reason === undefined ? {} : { reason: stage.reason })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Ranked bar table
// ---------------------------------------------------------------------------

export interface BarRow {
  readonly label: string;
  readonly value: number;
  readonly secondary?: string;
}

/**
 * A ranked list with the magnitude drawn in.
 *
 * Used for countries, cities, domains, and pages - four dashboards with one
 * shape. The value column carries the bar, exactly as the funnel does, so the
 * two read as the same kind of object.
 */
export function BarTable({
  rows,
  valueLabel,
  nameLabel = 'Name',
  emptyMessage,
  testId,
}: {
  readonly rows: readonly BarRow[];
  readonly valueLabel: string;
  /** What the labelled column holds - "Status", "Reason", a site. */
  readonly nameLabel?: string;
  readonly emptyMessage: string;
  readonly testId?: string;
}): React.JSX.Element {
  if (rows.length === 0) return <NoData>{emptyMessage}</NoData>;
  const top = Math.max(...rows.map((row) => row.value), 1);

  return (
    <table
      className="w-full border-collapse text-sm"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <thead>
        <tr>
          <th
            scope="col"
            className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            {nameLabel}
          </th>
          <th
            scope="col"
            className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
          >
            {valueLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-edge">
            <th scope="row" className="max-w-0 truncate py-2 pr-4 text-left font-normal text-ink">
              {row.label}
              {row.secondary !== undefined && (
                <span className="ml-2 font-mono text-[11px] text-muted">{row.secondary}</span>
              )}
            </th>
            <td className="relative w-32 py-2 text-right align-middle">
              <span
                aria-hidden="true"
                className="absolute inset-y-1 right-0 bg-signal/15"
                style={{ width: `${String(Math.round((row.value / top) * 100))}%` }}
              />
              <span className="relative font-mono text-ink">{row.value.toLocaleString()}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------

export interface DayPoint {
  readonly day: string;
  readonly value: number;
}

/**
 * A day-by-day series.
 *
 * Every day in the range is drawn, including the empty ones - a chart that
 * silently skips quiet days lies about shape, because two points a fortnight
 * apart rendered adjacent look like continuous traffic.
 *
 * The visual is a row of bars; the accessible equivalent is a real table behind
 * a `details` disclosure, so somebody who wants the numbers can get all of them
 * without the page carrying a 90-row table by default. The disclosure is a
 * native element, so it is keyboard-operable with nothing added.
 */
export function DaySeries({
  points,
  label,
  testId,
}: {
  readonly points: readonly DayPoint[];
  readonly label: string;
  readonly testId?: string;
}): React.JSX.Element {
  const top = Math.max(...points.map((point) => point.value), 1);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  if (total === 0) {
    return <NoData>No {label.toLowerCase()} in this range yet.</NoData>;
  }

  return (
    <div {...(testId === undefined ? {} : { 'data-testid': testId })}>
      <div
        aria-hidden="true"
        className="flex h-24 items-end gap-px"
        // Decorative: the numbers live in the table below, which is the
        // authoritative version rather than a duplicate of this.
      >
        {points.map((point) => (
          <span
            key={point.day}
            title={`${point.day}: ${String(point.value)}`}
            className="min-w-0 flex-1 bg-signal/25"
            style={{ height: `${String(Math.max(2, Math.round((point.value / top) * 100)))}%` }}
          />
        ))}
      </div>

      <p className="mt-2 flex justify-between font-mono text-[11px] text-muted">
        <span>{points[0]?.day}</span>
        <span>{points[points.length - 1]?.day}</span>
      </p>

      <details className="group mt-3">
        {/*
         * The marker is drawn rather than left to the browser default, which
         * varies between engines and sits outside the text box. Without one the
         * summary reads as a stray caption - it is the only thing telling a
         * reader that the numbers behind the bars can be opened.
         */}
        <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted hover:text-ink">
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ›
          </span>
          {label} day by day
        </summary>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="pb-1 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
              >
                Day
              </th>
              <th
                scope="col"
                className="pb-1 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
              >
                {label}
              </th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((point) => point.value > 0)
              .map((point) => (
                <tr key={point.day} className="border-t border-edge">
                  <th scope="row" className="py-1 text-left font-normal text-ink">
                    <time dateTime={point.day}>{point.day}</time>
                  </th>
                  <td className="py-1 text-right font-mono text-ink">{point.value}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat
// ---------------------------------------------------------------------------

/** One headline number, in the mono/uppercase micro-label house style. */
export function Stat({
  label,
  value,
  tone = 'ink',
  testId,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: 'ink' | 'secure' | 'danger' | 'muted';
  readonly testId?: string;
}): React.JSX.Element {
  const colour = {
    ink: 'text-ink',
    secure: 'text-secure',
    danger: 'text-danger',
    muted: 'text-muted',
  }[tone];

  return (
    <div className="border-r border-edge px-4 py-3 last:border-r-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold ${colour}`}
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
