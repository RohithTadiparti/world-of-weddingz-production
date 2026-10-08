import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
const accountFile = __ENV.QA_ACCOUNT_FILE || './railway-capacity-accounts.json';
const config = JSON.parse(open('./railway-capacity-thresholds.json'));
const accounts = new SharedArray('sanitized-role-accounts', () => JSON.parse(open(accountFile)));
const requiredRoles = ['bride', 'groom', 'vendor', 'wedding_planner', 'admin'];
const profile = __ENV.PROFILE || 'ramp';
const uploadEnabled = __ENV.ENABLE_UPLOADS === 'true';

const profiles = {
  ramp: {
    executor: 'ramping-vus',
    startVUs: 1,
    stages: [
      { duration: '5m', target: 10 },
      { duration: '10m', target: config.plannedOperatingConcurrentUsers },
      { duration: '20m', target: config.plannedOperatingConcurrentUsers },
      { duration: '5m', target: 0 },
    ],
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: config.plannedOperatingConcurrentUsers,
    stages: [
      { duration: '2m', target: config.plannedOperatingConcurrentUsers },
      { duration: '30s', target: config.breakpointConcurrentUsers },
      { duration: '5m', target: config.breakpointConcurrentUsers },
      { duration: '2m', target: config.plannedOperatingConcurrentUsers },
    ],
  },
  soak: {
    executor: 'constant-vus',
    vus: config.plannedOperatingConcurrentUsers,
    duration: __ENV.SOAK_DURATION || '2h',
  },
  recovery: {
    executor: 'ramping-vus',
    startVUs: config.breakpointConcurrentUsers,
    stages: [
      { duration: '3m', target: config.breakpointConcurrentUsers },
      { duration: '30s', target: 0 },
      { duration: '2m', target: 0 },
      { duration: '2m', target: config.plannedOperatingConcurrentUsers },
      { duration: '10m', target: config.plannedOperatingConcurrentUsers },
    ],
  },
};

if (!profiles[profile]) fail(`PROFILE must be one of ${Object.keys(profiles).join(', ')}`);

export const options = {
  scenarios: { [profile]: profiles[profile] },
  thresholds: config.thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

const operationFailures = new Rate('operation_failures');
const operationDuration = new Trend('operation_duration', true);
const operationCount = new Counter('operation_count');
let session;

function request(method, path, body, token, operation, extra = {}) {
  const headers = {
    Origin: __ENV.FRONTEND_ORIGIN || baseUrl,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    ...(extra.headers || {}),
  };
  const response = http.request(method, `${baseUrl}${path}`, body === null ? null : JSON.stringify(body), {
    ...extra,
    headers,
    responseType: operation === 'registration_login' || operation === 'uploads' ? 'text' : 'none',
    tags: { operation, endpoint: path, ...(extra.tags || {}) },
  });
  const passed = check(response, { [`${operation} status is successful`]: (r) => r.status >= 200 && r.status < 400 });
  operationFailures.add(!passed, { operation });
  operationDuration.add(response.timings.duration, { operation });
  operationCount.add(1, { operation });
  return response;
}

function login(account) {
  const response = request('POST', '/api/auth/login', { email: account.email, password: account.password }, null, 'registration_login');
  if (response.status !== 200 && response.status !== 201) return null;
  const payload = response.json();
  return payload.accessToken || payload.access_token || null;
}

function ensureSession() {
  if (session && __ITER % 50 !== 0) return session;
  const account = accounts[(__VU + __ITER) % accounts.length];
  const token = login(account);
  if (!token) fail(`Login failed for sanitized ${account.role} fixture`);
  session = { account, token };
  return session;
}

function discovery(token) {
  request('GET', '/api/vendors/search?limit=20', null, token, 'discovery');
  request('GET', '/api/wedding-planners/search?limit=20', null, token, 'planner');
}

function roleHome(account, token) {
  const path = account.role === 'vendor'
    ? '/api/vendors/me'
    : account.role === 'wedding_planner'
      ? '/api/wedding-planners/me'
      : '/api/users/me';
  request('GET', path, null, token, 'discovery');
}

function chats(token) {
  request('GET', '/api/chat/conversations?limit=20', null, token, 'chat');
}

function bookings(account, token) {
  const path = account.role === 'vendor' || account.role === 'wedding_planner'
    ? '/api/bookings/incoming?limit=20'
    : '/api/bookings?limit=20';
  request('GET', path, null, token, 'bookings');
}

function upload(token) {
  if (!uploadEnabled) return;
  const size = 64 * 1024;
  const slot = request(
    'POST',
    '/api/media/profile-photo/presign',
    { filename: `capacity-${__VU}-${__ITER}.jpg`, size, contentType: 'image/jpeg' },
    token,
    'uploads',
  );
  if (slot.status < 200 || slot.status >= 300) return;
  const payload = slot.json();
  const bytes = 'a'.repeat(size);
  const put = http.put(payload.uploadUrl, bytes, {
    headers: { ...(payload.headers || {}), 'Content-Type': 'image/jpeg' },
    tags: { operation: 'uploads', endpoint: 'presigned-put' },
  });
  if (check(put, { 'presigned upload succeeds': (r) => r.status >= 200 && r.status < 300 })) {
    request('POST', '/api/media/complete', { key: payload.key }, token, 'uploads');
  }
}

export function setup() {
  if (!baseUrl.startsWith('https://')) fail('BASE_URL must be an HTTPS Railway candidate URL');
  if (accounts.length < config.breakpointConcurrentUsers) {
    fail(`QA_ACCOUNT_FILE needs at least ${config.breakpointConcurrentUsers} sanitized accounts`);
  }
  const roles = new Set(accounts.map((account) => account.role));
  for (const role of requiredRoles) {
    if (!roles.has(role)) fail(`QA_ACCOUNT_FILE is missing role ${role}`);
  }
  return { accountCount: accounts.length, roles: [...roles] };
}

export default function () {
  const { account, token } = ensureSession();
  const selector = (__VU * 17 + __ITER) % 100;
  if (selector < 25) discovery(token);
  else if (selector < 45) roleHome(account, token);
  else if (selector < 65) chats(token);
  else if (selector < 90) bookings(account, token);
  else upload(token);
  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
    [__ENV.SUMMARY_PATH || `railway-capacity-${profile}.json`]: JSON.stringify(data, null, 2),
  };
}
