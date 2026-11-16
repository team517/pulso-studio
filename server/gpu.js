// Cola para la GPU: Whisper y el recorte del sujeto no caben a la vez en 6 GB, así que van de uno en uno.
let chain = Promise.resolve();

/** Ejecuta fn cuando la GPU esté libre. Devuelve lo que devuelva fn. */
export function onGpu(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
