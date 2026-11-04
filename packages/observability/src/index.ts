export type MetricLabels = Record<string, string | number | boolean | null | undefined>;

interface MetricSample {
  labels: Record<string, string>;
  value: number;
}

interface HistogramSample extends MetricSample {
  buckets: number[];
  bucketCounts: number[];
  sum: number;
  count: number;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, MetricSample>>();
  private readonly histograms = new Map<string, Map<string, HistogramSample>>();

  increment(name: string, labels: MetricLabels = {}, value = 1): void {
    if (!Number.isFinite(value) || value < 0) throw new Error('Counter increment must be non-negative');
    const normalized = normalizeLabels(labels);
    const series = this.counters.get(name) ?? new Map<string, MetricSample>();
    const key = labelKey(normalized);
    const sample = series.get(key) ?? { labels: normalized, value: 0 };
    sample.value += value;
    series.set(key, sample);
    this.counters.set(name, series);
  }

  observe(name: string, labels: MetricLabels, value: number, buckets: number[]): void {
    if (!Number.isFinite(value) || value < 0) throw new Error('Histogram observation must be non-negative');
    const sortedBuckets = [...new Set(buckets)].sort((a, b) => a - b);
    if (sortedBuckets.some((bucket) => !Number.isFinite(bucket) || bucket < 0)) {
      throw new Error('Histogram buckets must be non-negative finite numbers');
    }
    const normalized = normalizeLabels(labels);
    const series = this.histograms.get(name) ?? new Map<string, HistogramSample>();
    const key = labelKey(normalized);
    const sample = series.get(key);
    if (sample && sample.buckets.join(',') !== sortedBuckets.join(',')) {
      throw new Error(`Histogram buckets for '${name}' cannot change`);
    }
    const current =
      sample ??
      {
        labels: normalized,
        value: 0,
        buckets: sortedBuckets,
        bucketCounts: sortedBuckets.map(() => 0),
        sum: 0,
        count: 0,
      };
    sortedBuckets.forEach((bucket, index) => {
      if (value <= bucket) current.bucketCounts[index] = (current.bucketCounts[index] ?? 0) + 1;
    });
    current.sum += value;
    current.count += 1;
    series.set(key, current);
    this.histograms.set(name, series);
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      for (const sample of series.values()) lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
    }
    for (const [name, series] of this.histograms) {
      for (const sample of series.values()) {
        sample.buckets.forEach((bucket, index) => {
          lines.push(
            `${name}_bucket${formatLabels({ ...sample.labels, le: String(bucket) })} ${sample.bucketCounts[index]}`,
          );
        });
        lines.push(`${name}_bucket${formatLabels({ ...sample.labels, le: '+Inf' })} ${sample.count}`);
        lines.push(`${name}_sum${formatLabels(sample.labels)} ${sample.sum}`);
        lines.push(`${name}_count${formatLabels(sample.labels)} ${sample.count}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

function normalizeLabels(labels: MetricLabels): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function labelKey(labels: Record<string, string>): string {
  return JSON.stringify(labels);
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
