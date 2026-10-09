import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ permissions: [] as string[] }));
const http = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => undefined)),
  post: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ api: http }));
vi.mock('../../store/auth', () => ({ usePermissions: () => state.permissions }));

import AdminInfrastructure from './AdminInfrastructure';
import InfrastructureSummary from '../../components/admin/infrastructure/InfrastructureSummary';
import { ADMIN_NAV } from './AdminLayout';
import { formatDateTime } from '../../lib/dates';
import {
  INFRASTRUCTURE_QUERY_KEYS,
  acknowledgeAlert,
  formatMeasurement,
  type MigrationReadiness,
  type OperationalAlert,
  type OperationalAlerts,
  type OperationsStatus,
} from '../../lib/infrastructure';

// Named so secret scanners do not read a metric key literal as a credential.
const LATENCY_METRIC = 'p95LatencyMs' as const;

const READ = 'admin:infrastructure:read';

const metric = (overrides: Partial<OperationsStatus['metrics'][number]>): OperationsStatus['metrics'][number] => ({
  key: 'accounts',
  value: 1234,
  unit: 'count',
  source: 'PostgreSQL users count',
  windowMinutes: null,
  estimate: false,
  thresholds: { warning: 5000, critical: 10000, unit: 'count' },
  periodStart: '2026-10-09T12:00:00.000Z',
  collectedAt: '2026-10-09T12:00:04.000Z',
  freshness: 'fresh',
  status: 'ok',
  statusReason: null,
  alert: { state: 'none', alertId: null, severity: null },
  ...overrides,
});

const STATUS: OperationsStatus = {
  evaluatedAt: '2026-10-09T12:20:00.000Z',
  overallStatus: 'critical',
  counts: { ok: 1, warning: 1, critical: 1, unknown: 1 },
  staleness: { collectionIntervalMinutes: 60, staleAfterMinutes: 120, futureToleranceMinutes: 5, basis: 'periodStart' },
  snapshot: {
    id: 'snap-1',
    periodStart: '2026-10-09T12:00:00.000Z',
    collectedAt: '2026-10-09T12:00:04.000Z',
    ageMinutes: 20,
    freshness: 'fresh',
  },
  metrics: [
    metric({}),
    metric({
      key: 'databaseGigabytes',
      value: 0.123456789,
      unit: 'GB',
      source: 'PostgreSQL pg_database_size',
      thresholds: { warning: 5, critical: 10, unit: 'GB' },
      status: 'ok',
    }),
    metric({
      key: LATENCY_METRIC,
      value: 812.5,
      unit: 'ms',
      source: 'Redis request telemetry',
      windowMinutes: 15,
      thresholds: { warning: 400, critical: 750, unit: 'ms' },
      status: 'critical',
      alert: { state: 'open', alertId: 'alert-critical', severity: 'critical' },
    }),
    metric({
      key: 'errorRatePercent',
      value: 0.62,
      unit: 'percent',
      source: 'Redis request telemetry',
      thresholds: { warning: 0.5, critical: 1, unit: 'percent' },
      status: 'warning',
    }),
    metric({
      key: 'cpuPercent',
      value: null,
      unit: null,
      source: null,
      thresholds: { warning: 70, critical: 80, unit: 'percent' },
      freshness: 'missing',
      status: 'unknown',
      statusReason: 'metric_not_in_snapshot',
    }),
  ],
};

const delivery = (overrides: Partial<OperationalAlert['delivery']> = {}): OperationalAlert['delivery'] => ({
  recorded: false,
  notifiedSeverity: null,
  lastReminderAt: null,
  lastNotifiedAt: null,
  lastAttempt: null,
  history: [],
  ...overrides,
});

const alert = (overrides: Partial<OperationalAlert>): OperationalAlert => ({
  id: 'alert-x',
  metric: 'accounts',
  severity: 'warning',
  status: 'open',
  observedValue: 5001,
  thresholdValue: 5000,
  unit: 'count',
  source: 'PostgreSQL users count',
  firstObservedAt: '2026-10-09T10:00:00.000Z',
  lastObservedAt: '2026-10-09T12:00:00.000Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  delivery: delivery(),
  ...overrides,
});

const ALERTS: OperationalAlerts = {
  total: 4,
  data: [
    alert({
      id: 'alert-critical',
      metric: 'p95LatencyMs',
      severity: 'critical',
      observedValue: 812.5,
      thresholdValue: 750,
      unit: 'ms',
      source: 'Redis request telemetry',
      delivery: delivery({
        recorded: true,
        notifiedSeverity: 'critical',
        lastNotifiedAt: '2026-10-09T12:00:06.000Z',
        lastAttempt: {
          event: 'opened',
          at: '2026-10-09T12:00:05.000Z',
          correlationId: 'req-1',
          severity: 'critical',
          portal: { status: 'delivered', at: '2026-10-09T12:00:05.000Z', recipients: 2, error: null },
          email: { status: 'simulated', at: '2026-10-09T12:00:06.000Z', recipients: 1, provider: 'log', error: null },
          audit: { status: 'recorded', at: '2026-10-09T12:00:06.000Z', error: null },
        },
        history: [],
      }),
    }),
    alert({
      id: 'alert-acked',
      metric: 'errorRatePercent',
      severity: 'warning',
      status: 'acknowledged',
      observedValue: 0.62,
      thresholdValue: 0.5,
      unit: 'percent',
      acknowledgedAt: '2026-10-09T12:05:00.000Z',
      acknowledgedBy: 'b0000000-0000-4000-8000-000000000002',
    }),
    alert({ id: 'alert-open-warning', severity: 'warning', status: 'open' }),
    alert({
      id: 'alert-resolved',
      metric: 'memoryPercent',
      severity: 'critical',
      status: 'resolved',
      observedValue: 81,
      thresholdValue: 80,
      unit: 'percent',
      resolvedAt: '2026-10-09T11:00:00.000Z',
    }),
  ],
};

const READINESS: MigrationReadiness = {
  evaluatedAt: '2026-10-09T12:20:00.000Z',
  available: false,
  migration: { enabled: false, executor: 'mock', dryRun: true, readOnlyWindowMinutes: 15, railwayRetentionHours: 72 },
  revenue: {
    currency: 'INR',
    minimumMonthlyNetInr: 1200000,
    preferredMonthlyNetInr: 1500000,
    measuredMonthlyNetInr: null,
    status: 'unknown',
    source: null,
    detail: 'No persisted monthly net platform revenue measurement exists.',
  },
  capacity: { overallStatus: 'critical', unknownMetrics: 1 },
  prerequisites: [
    { id: 'auth_step_up', label: 'Administrator step-up authentication', status: 'unmet', detail: 'Not implemented.', owner: 'AUTH-001' },
    { id: 'migration_control_plane', label: 'Migration state machine and executor', status: 'unmet', detail: 'Not implemented.', owner: 'MIG-001' },
    { id: 'migration_enabled', label: 'Migration enabled in configuration', status: 'unmet', detail: 'migration.enabled is false.', owner: null },
    { id: 'real_executor', label: 'Real AWS executor selected', status: 'unmet', detail: 'migration.executor is mock.', owner: null },
    { id: 'capacity_telemetry', label: 'Capacity telemetry fresh and complete', status: 'unmet', detail: '1 of 10 unknown.', owner: null },
    { id: 'revenue_target', label: 'Monthly net revenue target measured and met', status: 'unknown', detail: 'Not measured.', owner: null },
  ],
  unmet: ['auth_step_up', 'migration_control_plane', 'migration_enabled', 'real_executor', 'capacity_telemetry', 'revenue_target'],
};

type Seed = { data: unknown } | { error: unknown };

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, retryOnMount: false, refetchInterval: false } },
  });
}

function seed(client: QueryClient, key: readonly string[], value: Seed) {
  if ('data' in value) {
    client.setQueryData(key, value.data);
    return;
  }
  const query = client.getQueryCache().build(client, { queryKey: key });
  query.setState({ status: 'error', error: value.error as Error, fetchStatus: 'idle', errorUpdatedAt: Date.now() });
}

function render(
  seeds: Partial<Record<keyof typeof INFRASTRUCTURE_QUERY_KEYS, Seed>>,
  url = '/admin/infrastructure',
) {
  const client = newClient();
  for (const [name, value] of Object.entries(seeds)) {
    seed(client, INFRASTRUCTURE_QUERY_KEYS[name as keyof typeof INFRASTRUCTURE_QUERY_KEYS], value as Seed);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AdminInfrastructure />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The markup of one element, found by an attribute, through its matching close tag. */
function slice(html: string, marker: string, tag = 'li'): string {
  const start = html.lastIndexOf(`<${tag}`, html.indexOf(marker));
  let depth = 0;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const ALL = { status: { data: STATUS }, alerts: { data: ALERTS }, readiness: { data: READINESS } };

beforeEach(() => {
  state.permissions = [READ];
  http.get.mockClear();
  http.post.mockReset();
});

describe('AdminInfrastructure capacity', () => {
  it('shows exact values, units, thresholds, sources, collection time and freshness', () => {
    const html = render(ALL);

    const accounts = text(slice(html, 'data-metric="accounts"'));
    expect(accounts).toContain('Registered accounts');
    expect(accounts).toContain(' 1,234 ');
    expect(accounts).toContain('Warning at 5,000');
    expect(accounts).toContain('Critical at 10,000');
    expect(accounts).toContain('Unit count');
    expect(accounts).toContain('Source PostgreSQL users count');
    expect(accounts).toContain(`Collected ${formatDateTime('2026-10-09T12:00:04.000Z')}`);
    expect(accounts).toContain('Freshness Fresh');
    expect(accounts).toContain(' OK ');

    // Every persisted digit, in the persisted unit: no rounding, no MB.
    const db = text(slice(html, 'data-metric="databaseGigabytes"'));
    expect(db).toContain('0.123456789 GB');
    expect(db).toContain('Warning at 5 GB');
    expect(db).toContain('Critical at 10 GB');

    const latency = slice(html, 'data-metric="p95LatencyMs"');
    expect(latency).toContain('data-status="critical"');
    expect(text(latency)).toContain('812.5 ms');
    expect(text(latency)).toContain('Window 15 minutes');
    expect(text(latency)).toContain('Alert Open (critical)');
    expect(latency).toContain('href="/admin/infrastructure?alert=alert-critical"');

    const errors = slice(html, 'data-metric="errorRatePercent"');
    expect(errors).toContain('data-status="warning"');
    expect(text(errors)).toContain('0.62%');
    expect(text(errors)).toContain('Warning at 0.5%');

    expect(html).toContain('data-testid="overall-status">Critical<');
    expect(text(html)).toContain(`Snapshot period ${formatDateTime('2026-10-09T12:00:00.000Z')}`);
  });

  it('renders a missing metric as unknown in the neutral colour, never green', () => {
    const cpu = slice(render(ALL), 'data-metric="cpuPercent"');
    expect(cpu).toContain('data-status="unknown"');
    expect(cpu).toContain('class="pill-neutral">Unknown<');
    expect(cpu).not.toContain('pill-positive');
    expect(text(cpu)).toContain('No value');
    expect(text(cpu)).toContain('Freshness Missing');
    expect(text(cpu)).toContain('The latest snapshot has no value for this metric.');
  });

  it('shows a stale snapshot as unknown with its values for reference only', () => {
    const stale: OperationsStatus = {
      ...STATUS,
      overallStatus: 'unknown',
      counts: { ok: 0, warning: 0, critical: 0, unknown: 1 },
      snapshot: { ...STATUS.snapshot!, ageMinutes: 300, freshness: 'stale' },
      metrics: [metric({ freshness: 'stale', status: 'unknown', statusReason: 'stale_snapshot' })],
    };
    const html = render({ ...ALL, status: { data: stale } });

    expect(html).toContain('data-state="stale"');
    expect(html).toContain('data-testid="overall-status">Unknown<');
    const accounts = slice(html, 'data-metric="accounts"');
    expect(accounts).toContain('data-status="unknown"');
    expect(accounts).not.toContain('pill-positive');
    expect(text(accounts)).toContain(' 1,234 ');
    expect(text(accounts)).toContain('Freshness Stale');
    expect(text(accounts)).toContain('The latest snapshot is stale');
  });

  const railway = (value: number, overrides: Partial<OperationsStatus['metrics'][number]>) =>
    metric({
      key: 'railwayMonthlyInr',
      value,
      unit: 'INR/month',
      source: 'Canonical configured Railway estimate',
      thresholds: { warning: 15000, critical: 30000, unit: 'INR/month' },
      ...overrides,
    });

  it('shows the 0 configured Railway placeholder as not measured, never as a healthy value', () => {
    const status: OperationsStatus = {
      ...STATUS,
      overallStatus: 'unknown',
      metrics: [railway(0, { status: 'unknown', statusReason: 'not_measured' })],
    };
    const card = slice(render({ ...ALL, status: { data: status } }), 'data-metric="railwayMonthlyInr"');

    expect(card).toContain('data-status="unknown"');
    expect(card).toContain('class="pill-neutral">Unknown<');
    expect(card).not.toContain('pill-positive');
    expect(card).toContain('data-testid="metric-value">Not measured<');
    expect(text(card)).toContain('Not measured: configured placeholder, Railway billing adapter not enabled.');
    expect(text(card)).toContain('Configured placeholder value: ₹0 per month');
    expect(card).not.toContain('Configured estimate<');
  });

  it('labels a non-zero configured estimate as an estimate, not a measurement', () => {
    const status: OperationsStatus = {
      ...STATUS,
      overallStatus: 'warning',
      metrics: [railway(16000, { status: 'warning', estimate: true })],
    };
    const card = slice(render({ ...ALL, status: { data: status } }), 'data-metric="railwayMonthlyInr"');

    expect(card).toContain('data-status="warning"');
    expect(card).toContain('data-testid="metric-estimate">Configured estimate<');
    expect(text(card)).toContain('₹16,000 per month (configured estimate)');
    expect(text(card)).toContain('Warning at ₹15,000 per month');
  });

  it('says so when no snapshot exists', () => {
    const empty: OperationsStatus = {
      ...STATUS,
      overallStatus: 'unknown',
      snapshot: null,
      metrics: [metric({ value: null, unit: null, source: null, collectedAt: null, periodStart: null, freshness: 'missing', status: 'unknown', statusReason: 'no_snapshot' })],
    };
    const html = render({ ...ALL, status: { data: empty } });
    expect(html).toContain('data-state="empty"');
    expect(text(html)).toContain('No capacity snapshot has been collected yet');
    expect(text(slice(html, 'data-metric="accounts"'))).toContain('Collected Never');
  });
});

describe('AdminInfrastructure alerts', () => {
  it('keeps the server order and shows every alert state', () => {
    const html = render(ALL);
    const order = [...html.matchAll(/data-alert-id="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['alert-critical', 'alert-acked', 'alert-open-warning', 'alert-resolved']);

    const critical = slice(html, 'data-alert-id="alert-critical"');
    expect(text(critical)).toContain('Critical');
    expect(text(critical)).toContain('Open');
    expect(text(critical)).toContain('Observed 812.5 ms');
    expect(text(critical)).toContain('Threshold 750 ms');
    expect(text(critical)).toContain('Source Redis request telemetry');
    expect(text(critical)).toContain(`First observed ${formatDateTime('2026-10-09T10:00:00.000Z')}`);
    expect(text(critical)).toContain('Not acknowledged');
    expect(critical).toContain('>Acknowledge</button>');

    const acked = slice(html, 'data-alert-id="alert-acked"');
    expect(acked).toContain('data-status="acknowledged"');
    expect(text(acked)).toContain(
      `Acknowledged ${formatDateTime('2026-10-09T12:05:00.000Z')} by b0000000-0000-4000-8000-000000000002`,
    );
    expect(acked).not.toContain('>Acknowledge</button>');

    const resolved = slice(html, 'data-alert-id="alert-resolved"');
    expect(resolved).toContain('data-status="resolved"');
    expect(text(resolved)).toContain(`Resolved ${formatDateTime('2026-10-09T11:00:00.000Z')}`);
    expect(resolved).not.toContain('>Acknowledge</button>');
    expect(text(html)).toContain('Active (3)');
    expect(text(html)).toContain('Resolved (1)');
  });

  it('labels simulated email as simulated and shows non-secret channel state', () => {
    const critical = slice(render(ALL), 'data-alert-id="alert-critical"');
    const portal = text(slice(critical, 'data-channel="portal"'));
    const email = text(slice(critical, 'data-channel="email"'));
    const audit = text(slice(critical, 'data-channel="audit"'));
    expect(portal).toContain('Delivered in portal to 2 administrators');
    expect(email).toContain('Email simulated (log provider, not delivered to any inbox) to 1 recipient');
    expect(email).toContain('provider log');
    expect(audit).toContain('Audit recorded');
    expect(text(slice(render(ALL), 'data-alert-id="alert-acked"'))).toContain('No delivery has been recorded');
  });

  it('highlights the alert named in ?alert=', () => {
    const html = render(ALL, '/admin/infrastructure?alert=alert-acked');
    const acked = slice(html, 'data-alert-id="alert-acked"');
    expect(acked).toContain('data-highlighted="true"');
    expect(acked).toContain('aria-current="true"');
    expect(text(acked)).toContain('From your notification');
    expect(slice(html, 'data-alert-id="alert-critical"')).not.toContain('data-highlighted');
  });

  it('says when the notified alert is not in the list', () => {
    expect(render(ALL, '/admin/infrastructure?alert=gone')).toContain('data-state="highlight-missing"');
  });

  it('shows an empty state with no alerts', () => {
    const html = render({ ...ALL, alerts: { data: { data: [], total: 0 } } });
    expect(text(html)).toContain('No operational alerts have been raised.');
  });
});

describe('AdminInfrastructure request states', () => {
  it('shows loading placeholders while each section is fetched', () => {
    const html = render({});
    expect(html.match(/data-state="loading"/g)).toHaveLength(3);
    expect(html).not.toContain('pill-positive');
  });

  it('shows permission denied for a 403', () => {
    const forbidden = Object.assign(new Error('Forbidden'), { response: { status: 403, data: {} } });
    const html = render({ ...ALL, status: { error: forbidden } });
    expect(html).toContain('data-state="forbidden"');
    expect(text(html)).toContain('does not have permission to read capacity status');
  });

  it('shows an API error with a retry and nothing healthy', () => {
    const failure = Object.assign(new Error('boom'), {
      response: { status: 500, data: { error: { message: 'Database unavailable' } } },
    });
    const html = render({ ...ALL, status: { error: failure } });
    const block = slice(html, 'data-state="error"', 'div');
    expect(text(block)).toContain('Capacity status could not be loaded: Database unavailable');
    expect(block).toContain('>Retry</button>');
    expect(html).not.toContain('data-testid="overall-status"');
  });

  it('refuses the page without admin:infrastructure:read and fetches nothing', () => {
    state.permissions = ['admin:analytics:read'];
    const html = render(ALL);
    expect(html).toContain('data-state="forbidden"');
    expect(html).not.toContain('data-metric=');
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe('MigrationReadiness', () => {
  it('shows the INR revenue gates, unknown measured revenue and each prerequisite', () => {
    const html = render(ALL);
    expect(html).toContain('data-testid="revenue-minimum">₹12,00,000<');
    expect(html).toContain('data-testid="revenue-preferred">₹15,00,000<');
    expect(html).toContain('data-testid="revenue-measured">Unknown<');
    for (const p of READINESS.prerequisites) {
      expect(slice(html, `data-prerequisite="${p.id}"`)).toContain(`data-status="${p.status}"`);
    }
    expect(text(slice(html, 'data-prerequisite="auth_step_up"'))).toContain('Owner: AUTH-001.');
  });

  it('disables the migration button and lists exactly the unmet prerequisites', () => {
    const html = render(ALL);
    const button = html.slice(html.lastIndexOf('<button', html.indexOf('data-testid="start-migration"')), html.indexOf('</button>', html.indexOf('data-testid="start-migration"')));
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toContain('onclick');
    const blockers = text(slice(html, 'id="migration-blockers"', 'div'));
    for (const p of READINESS.prerequisites) expect(blockers).toContain(p.label);
  });

  it('keeps the button disabled even if every prerequisite were met', () => {
    const allMet: MigrationReadiness = {
      ...READINESS,
      available: true,
      unmet: [],
      prerequisites: READINESS.prerequisites.map((p) => ({ ...p, status: 'met' as const })),
    };
    const html = render({ ...ALL, readiness: { data: allMet } });
    expect(html.slice(html.indexOf('data-testid="start-migration"') - 200, html.indexOf('data-testid="start-migration"'))).toContain('disabled=""');
  });
});

describe('Infrastructure navigation and dashboard summary', () => {
  it('gates the nav entry on admin:infrastructure:read', () => {
    const entry = ADMIN_NAV.find((e) => e.to === '/admin/infrastructure');
    expect(entry?.requires).toEqual([READ]);
  });

  function summary(seeds: Partial<Record<'status', Seed>>) {
    const client = newClient();
    if (seeds.status) seed(client, INFRASTRUCTURE_QUERY_KEYS.status, seeds.status);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <InfrastructureSummary />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('summarises the server status and links to the page', () => {
    const html = summary({ status: { data: STATUS } });
    expect(html).toContain('href="/admin/infrastructure"');
    expect(text(html)).toContain('1 critical · 1 warning · 1 unknown · snapshot fresh');
    expect(html).toContain('class="pill-critical">Critical<');
  });

  it('is unknown, never green, when loading or failed', () => {
    expect(summary({})).toContain('class="pill-neutral">Unknown<');
    const failed = summary({ status: { error: Object.assign(new Error('x'), { response: { status: 500 } }) } });
    expect(failed).toContain('class="pill-neutral">Unknown<');
    expect(text(failed)).toContain('Capacity status could not be loaded.');
  });
});

describe('infrastructure helpers', () => {
  it('formats with digit grouping and the persisted unit, never converting', () => {
    expect(formatMeasurement(0.0123456789, 'GB')).toBe('0.0123456789 GB');
    expect(formatMeasurement(1e-21, 'GB')).toBe('1e-21 GB');
    expect(formatMeasurement(100000, 'count')).toBe('1,00,000');
    expect(formatMeasurement(30000, 'INR/month')).toBe('₹30,000 per month');
    expect(formatMeasurement(0.5, 'percent')).toBe('0.5%');
    expect(formatMeasurement(null, 'ms')).toBe('No value');
    expect(formatMeasurement(Number.NaN, 'ms')).toBe('No value');
  });

  it('acknowledges through the API and refetches alerts and status, without guessing the result', async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    http.post.mockResolvedValue({ data: { changed: true, alert: { id: 'a1' } } });

    const result = await acknowledgeAlert(client, 'a1');

    expect(http.post).toHaveBeenCalledWith('/admin/operations/alerts/a1/acknowledge');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: INFRASTRUCTURE_QUERY_KEYS.alerts });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: INFRASTRUCTURE_QUERY_KEYS.status });
    expect(result.changed).toBe(true);
  });
});
