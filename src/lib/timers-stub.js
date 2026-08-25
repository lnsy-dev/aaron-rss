/**
 * timers Stub
 *
 * xml2js (a dependency of rss-parser) imports setImmediate from the
 * Node 'timers' module. In the browser there is no such module, but
 * setTimeout is universally available. This tiny stub provides the
 * minimum surface rss-parser needs at runtime.
 */

export function setImmediate(callback, ...args) {
  return setTimeout(callback, 0, ...args);
}

export function clearImmediate(id) {
  clearTimeout(id);
}
