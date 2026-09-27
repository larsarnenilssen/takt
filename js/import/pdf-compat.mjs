/* Takt – tillegg som pdf.js trenger i Chrome.
   pdf.js i vendor/pdfjs er hentet fra Firefox og bruker noen få nye
   JavaScript-funksjoner som ikke finnes i alle nettlesere ennå. De legges
   bare til når de mangler, og lastes både i appen og i pdf.js-tråden. */
const def = (obj, name, value) => { if (obj && !(name in obj)) Object.defineProperty(obj, name, { value, configurable: true, writable: true }); };

for (const C of [Map, WeakMap]) {
  def(C.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); });
  def(C.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); });
}
def(Math, 'sumPrecise', it => { let s = 0; for (const x of it) s += x; return s; });
def(Promise, 'try', (f, ...a) => new Promise(r => r(f(...a))));
def(Promise, 'withResolvers', () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; });
def(Uint8Array, 'fromBase64', s => Uint8Array.from(atob(s), c => c.charCodeAt(0)));
def(Uint8Array.prototype, 'toBase64', function () { let b = ''; for (let i = 0; i < this.length; i += 0x8000) b += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); return btoa(b); });
def(Uint8Array.prototype, 'toHex', function () { return Array.from(this, x => x.toString(16).padStart(2, '0')).join(''); });
for (const C of [globalThis.Response, globalThis.Blob]) if (C) def(C.prototype, 'bytes', async function () { return new Uint8Array(await this.arrayBuffer()); });
