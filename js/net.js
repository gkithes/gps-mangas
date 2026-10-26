// Αιτήματα στο ίντερνετ με όριο χρόνου και εφεδρικούς διακομιστές:
// αν ο πρώτος αργεί ή χαλάει, δοκιμάζουμε αμέσως τον επόμενο.

// hedge: αν ο πρώτος δεν έχει απαντήσει σε τόσα ms, ρωτάμε ΚΑΙ τον επόμενο — κερδίζει ο πιο γρήγορος.
export function getJSON(urls, init = {}, timeout = 10000, hedge = 0) {
  return hedge ? race([].concat(urls), init, timeout, hedge) : oneByOne(urls, init, timeout);
}

function race(list, init, timeout, hedge) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let next = 0, failed = 0, done = false, hedgeTimer;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      ctrls.forEach((c) => c.abort());
      fn(v);
    };
    init.signal?.addEventListener("abort", () => finish(reject, new DOMException("aborted", "AbortError")), { once: true });
    const launch = () => {
      if (done || next >= list.length) return;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), timeout);
      clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(launch, hedge);
      fetch(list[next++], { ...init, signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => finish(resolve, json))
        .catch((e) => (++failed >= list.length ? finish(reject, e) : launch()))
        .finally(() => clearTimeout(timer));
    };
    launch();
  });
}

async function oneByOne(urls, init, timeout) {
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
