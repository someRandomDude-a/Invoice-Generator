declare global {
  interface Window { invoiceDesktop?: { runnerEndpoint: string } }
}

export function defaultRunnerEndpoint() {
  return (typeof window !== 'undefined' && window.invoiceDesktop?.runnerEndpoint) || 'http://127.0.0.1:8000';
}

export function desktopRunnerEndpoint(endpoint: string) {
  // Preserve explicitly configured external local runners, but migrate the browser default.
  return endpoint === 'http://127.0.0.1:8000' ? defaultRunnerEndpoint() : endpoint;
}
