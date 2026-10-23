// Αιτήματα στο ίντερνετ με όριο χρόνου και εφεδρικούς διακομιστές:
// αν ο πρώτος αργεί ή χαλάει, δοκιμάζουμε αμέσως τον επόμενο.

export async function getJSON(urls, init = {}, timeout = 10000) {
  const outer = init.signal;
  let lastErr = new Error("no servers");
  for (const url of [].concat(urls)) {
    if (outer?.aborted) throw new DOMException("aborted", "AbortError");
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (outer?.aborted) throw e;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr;
}
