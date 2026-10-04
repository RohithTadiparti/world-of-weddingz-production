import { spawn } from 'child_process';
import { once } from 'events';
import { readFile, mkdtemp, writeFile } from 'fs/promises';
import { request as proxyRequest } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import express from 'express';
import WebSocket from 'ws';

/** Real Chromium smoke test without adding a browser dependency to the app. */
export async function checkBiodataBrowser(apiOrigin: string, email: string, password: string, png: Buffer) {
  const site = express();
  site.use('/api', (req, res) => {
    const outgoing = proxyRequest(new URL(req.originalUrl, apiOrigin), { method: req.method, headers: req.headers }, (incoming) => {
      res.writeHead(incoming.statusCode ?? 500, incoming.headers);
      incoming.pipe(res);
    });
    outgoing.on('error', () => res.sendStatus(502));
    req.pipe(outgoing);
  });
  const dist = resolve('../frontend/dist');
  site.use(express.static(dist));
  site.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  const server = site.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const directory = await mkdtemp(join(tmpdir(), 'wow-biodata-browser-'));
  const fixture = join(directory, 'family.png');
  await writeFile(fixture, png);
  const chrome = spawn(process.env.CHROME_BIN!, [
    '--headless=new',
    ...(process.env.CI === 'true' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${directory}`,
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let socket: WebSocket | undefined;
  const diagnostics = {
    consoleErrors: [] as string[],
    runtimeErrors: [] as string[],
    failedRequests: [] as string[],
    evaluationErrors: [] as string[],
  };
  const remember = (list: string[], message: string) => {
    if (list.length < 20) list.push(message.slice(0, 500));
  };
  const redact = (value: string) => {
    let safe = value
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/eyJ[\w.-]+/g, '[redacted token]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
      .replace(/\+?91[6-9]\d{9}|\b[6-9]\d{9}\b/g, '[redacted phone]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted id]');
    for (const [sensitive, label] of [[email, 'email'], [password, 'password'], ['Ada Rao', 'name'], ['Biodata Test', 'name']] as const) {
      if (sensitive) safe = safe.split(sensitive).join(`[redacted ${label}]`);
    }
    return safe;
  };
  const safeUrl = (value: string) => {
    try {
      const url = new URL(value);
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
        .replace(/\/[A-Za-z0-9_-]{40,}(?=\/|$)/g, '/[redacted]');
      return url.toString();
    } catch {
      return '[invalid URL]';
    }
  };
  const pause = () => new Promise((done) => setTimeout(done, 100));
  try {
    let port = '';
    for (let i = 0; i < 100 && !port; i++) {
      try { port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await pause(); }
    }
    if (!port) throw new Error('Headless browser did not start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    socket = new WebSocket(targets.find((target) => target.type === 'page')!.webSocketDebuggerUrl);
    await new Promise<void>((done, reject) => { socket!.onopen = () => done(); socket!.onerror = () => reject(new Error('Browser connection failed')); });
    let sequence = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const requestById = new Map<string, { method: string; url: string }>();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message: string };
      };
      if (message.method) {
        const params = message.params ?? {};
        if (message.method === 'Runtime.consoleAPICalled' && params.type === 'error') {
          const args = (params.args ?? []) as { type?: string; value?: unknown; description?: string }[];
          const summary = args.map((arg) => {
            if (typeof arg.value === 'string') return redact(arg.value);
            if (arg.type === 'object') return '[object]';
            return redact(arg.description?.split('\n')[0] ?? arg.type ?? 'unknown');
          }).join(' ');
          remember(diagnostics.consoleErrors, summary || 'console.error called');
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const details = params.exceptionDetails as {
            text?: string;
            exception?: { className?: string; description?: string };
          } | undefined;
          const description = details?.exception?.description?.split('\n').slice(0, 3).join('\n');
          remember(diagnostics.runtimeErrors, redact(
            [details?.exception?.className, details?.text, description].filter(Boolean).join(': ') || 'uncaught JavaScript exception',
          ));
        }
        if (message.method === 'Runtime.bindingCalled' && params.name === '__biodataE2eDiagnostic') {
          try {
            const payload = JSON.parse(String(params.payload)) as { kind?: string; message?: string };
            remember(diagnostics.runtimeErrors, redact(`${payload.kind ?? 'browser error'}: ${payload.message ?? ''}`));
          } catch {
            remember(diagnostics.runtimeErrors, 'browser runtime diagnostic could not be parsed');
          }
        }
        if (message.method === 'Network.requestWillBeSent') {
          const requestId = String(params.requestId ?? '');
          const request = params.request as { method?: string; url?: string } | undefined;
          if (requestId && request?.url) {
            requestById.set(requestId, { method: request.method ?? 'GET', url: safeUrl(request.url) });
          }
        }
        if (message.method === 'Network.responseReceived') {
          const request = requestById.get(String(params.requestId ?? ''));
          const response = params.response as { status?: number; url?: string } | undefined;
          if (response && (response.status ?? 0) >= 400) {
            remember(
              diagnostics.failedRequests,
              `${request?.method ?? 'GET'} ${request?.url ?? safeUrl(response.url ?? '')} -> HTTP ${response.status}`,
            );
          }
        }
        if (message.method === 'Network.loadingFailed') {
          const request = requestById.get(String(params.requestId ?? ''));
          if (request) {
            remember(diagnostics.failedRequests, `${request.method} ${request.url} failed: ${String(params.errorText ?? 'network error')}`);
          }
        }
        if (message.method === 'Log.entryAdded') {
          const entry = params.entry as { level?: string; text?: string } | undefined;
          if (entry?.level === 'error') remember(diagnostics.consoleErrors, redact(entry.text ?? 'browser error log entry'));
        }
        return;
      }
      if (message.id === undefined) return;
      const receiver = pending.get(message.id);
      if (!receiver) return;
      pending.delete(message.id);
      if (message.error) receiver.reject(new Error(message.error.message));
      else receiver.resolve(message.result);
    };
    const send = <T>(method: string, params: object = {}): Promise<T> => new Promise((done, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: (value) => done(value as T), reject });
      socket!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = await send<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression}`);
      return result.result.value;
    };
    const waitFor = async (expression: string, label?: string) => {
      for (let i = 0; i < 150; i++) {
        try {
          if (await evaluate<boolean>(expression)) return;
        } catch (error) {
          remember(diagnostics.evaluationErrors, redact(error instanceof Error ? error.message : String(error)));
        }
        await pause();
      }
      let pageState: unknown;
      try {
        pageState = await evaluate(`(() => {
          const body = document.body?.innerText ?? '';
          const markers = [
            'WORLD OF WEDDINGZ', 'Welcome back', 'Sign in', 'Biodata',
            'Saved section by section', 'Family Photo', 'This page could not be shown',
            'Forbidden', 'Loading', 'Complete your profile',
          ];
          return {
            url: location.origin + location.pathname + (location.search ? '?[redacted]' : ''),
            readyState: document.readyState,
            title: document.title,
            elements: {
              steps: Boolean(document.querySelector('#biodata-steps')),
              heightInput: Boolean(document.querySelector('#biodata-steps input[aria-label="Height in feet"]')),
              familyPhotoSection: Boolean(document.querySelector('#family-photo')),
              familyPhotoInput: Boolean(document.querySelector('#family-photo input[type=file]')),
            },
            loading: document.readyState !== 'complete' || Boolean(document.querySelector('[aria-busy="true"], .animate-pulse')),
            visibleTextMarkers: markers.filter((marker) => body.toLowerCase().includes(marker.toLowerCase())),
          };
        })()`);
      } catch (error) {
        pageState = { unavailable: redact(error instanceof Error ? error.message : String(error)) };
      }
      throw new Error(`${label ? `${label}: ` : ''}Browser condition timed out: ${expression}; diagnostics: ${JSON.stringify({
        page: pageState,
        consoleErrors: diagnostics.consoleErrors,
        runtimeErrors: diagnostics.runtimeErrors,
        failedRequests: diagnostics.failedRequests,
        evaluationErrors: diagnostics.evaluationErrors,
      })}`);
    };
    const fill = (selector: string, value: string) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const navigate = async (path: string) => { await send('Page.navigate', { url: origin + path }); };
    // Moves inside the running app, as a link would. A full page load straight
    // after signing in can race the app's own session refresh, and the losing
    // refresh reads as a replayed token and ends the session.
    const goInApp = (path: string) => evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate')); })()`);
    const login = async () => {
      await navigate('/login');
      await waitFor('Boolean(document.querySelector("#email"))');
      await fill('#email', email);
      await fill('input[type=password]', password);
      await evaluate('document.querySelector("#email").closest("form").requestSubmit()');
      await waitFor('location.pathname !== "/login"');
    };
    // The biodata opens on the photographs step, where the family photo is.
    const openPhoto = async (label: string) => {
      await waitFor('Boolean(document.querySelector("#family-photo input[type=file]"))', label);
    };
    // The step card's forward button: "Continue" on the photographs step.
    const nextStep = () => evaluate(`Array.from(document.querySelectorAll('#biodata-steps footer button')).find((button) => /Continue|Skip/.test(button.textContent ?? '')).click()`);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Runtime.addBinding', { name: '__biodataE2eDiagnostic' });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        const report = (kind, value) => window.__biodataE2eDiagnostic(JSON.stringify({ kind, message: value }));
        window.addEventListener('error', (event) => report('window.error', event.message));
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason;
          report('unhandledrejection', reason instanceof Error ? reason.message : String(reason));
        });
      `,
    });
    await login();
    await goInApp('/biodata');

    // The photographs step: upload the family photo, then replace it.
    await openPhoto('on the photographs step');
    let url = await evaluate<string>('document.querySelector("#family-photo img")?.src ?? ""');
    for (let i = 0; i < 2; i++) {
      const doc = await send<{ root: { nodeId: number } }>('DOM.getDocument');
      const input = await send<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#family-photo input[type=file]' });
      await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [fixture] });
      await waitFor(`(() => { const image = document.querySelector('#family-photo img'); return image && image.src !== ${JSON.stringify(url)} && image.naturalWidth > 0 && !document.querySelector('#family-photo input[type=file]').disabled; })()`, 'family photo upload');
      url = await evaluate<string>('document.querySelector("#family-photo img").src');
    }

    // The basic information step: the saved height reads back in feet and
    // inches, the browser refuses bad values, and a new height saves.
    await nextStep();
    await waitFor(`document.querySelector('#biodata-steps input[aria-label="Height in feet"]')?.value === '5' && document.querySelector('#biodata-steps input[aria-label="Height in inches"]')?.value === '11'`, 'saved height');
    const heightSelector = '#biodata-steps input[aria-label="Height in feet"]';
    const inchesSelector = '#biodata-steps input[aria-label="Height in inches"]';
    for (const invalid of ['abc', '-5', '5..6', '5.', '8.1', '']) {
      await fill(heightSelector, invalid);
      if (await evaluate(`document.querySelector(${JSON.stringify(heightSelector)}).checkValidity()`)) throw new Error(`Browser accepted invalid height ${invalid}`);
    }
    await fill(heightSelector, '5');
    await fill(inchesSelector, '6');
    const invalidFields = await evaluate<string[]>(`Array.from(document.querySelector(${JSON.stringify(heightSelector)}).closest('form').querySelectorAll(':invalid')).map(input => input.outerHTML + ': ' + input.validationMessage)`);
    if (invalidFields.length) throw new Error(`Invalid form fields: ${invalidFields.join('; ')}`);
    await evaluate(`document.querySelector(${JSON.stringify(heightSelector)}).closest('form').requestSubmit()`);
    await waitFor('document.body.innerText.includes("Saved. Next:")', 'basic information save');

    await navigate('/biodata');
    await openPhoto('after navigating back to /biodata');
    await waitFor(`document.querySelector('#family-photo img')?.src === ${JSON.stringify(url)}`, 'family photo after reload');
    await evaluate(`fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })`);
    await login();
    await goInApp('/biodata');
    await openPhoto('after signing in again');
    await waitFor(`document.querySelector('#family-photo img')?.src === ${JSON.stringify(url)}`, 'family photo after sign-in');
    await waitFor('Boolean(document.querySelector("#saved-details button"))', 'saved details');
    await evaluate('document.querySelector("#saved-details button").click()');
    await waitFor(`document.querySelector('#saved-details')?.innerText.includes('5 ft 6 in')`, 'saved height read-back');
    return url;
  } finally {
    socket?.close();
    chrome.kill();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
