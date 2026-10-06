import { afterEach, expect, it, vi } from 'vitest';
import { defaultRunnerEndpoint, desktopRunnerEndpoint } from './runtime';

afterEach(() => vi.unstubAllGlobals());
it('browser defaults still use the standalone local server', () => {
  expect(defaultRunnerEndpoint()).toBe('http://127.0.0.1:8000');
});
it('desktop maps the browser default but preserves an explicitly configured runner', () => {
  vi.stubGlobal('window', { invoiceDesktop: { runnerEndpoint: 'http://127.0.0.1:17865' } });
  expect(defaultRunnerEndpoint()).toBe('http://127.0.0.1:17865');
  expect(desktopRunnerEndpoint('http://127.0.0.1:8000')).toBe('http://127.0.0.1:17865');
  expect(desktopRunnerEndpoint('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
});
