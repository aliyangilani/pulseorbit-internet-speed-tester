/**
 * PulseOrbit configuration.
 *
 * Everything you may want to change without touching the logic lives here:
 * testing endpoints, test durations, history size and the GitHub link.
 */
export const CONFIG = {
  brand: 'PulseOrbit',

  repoUrl: 'https://github.com/aliyangilani/pulseorbit-internet-speed-tester',

  historyKey: 'pulseorbit-history',
  maxHistory: 10,

  /**
   * Test endpoints. They must send permissive CORS headers
   * (Access-Control-Allow-Origin) because GitHub Pages is a different origin.
   *
   * Default provider: Cloudflare's public speed-test endpoints
   * (the same ones used by speed.cloudflare.com).
   *   GET  {download}?bytes=N   -> returns N bytes of data
   *   POST {upload}             -> accepts and discards the request body
   *
   * To use your own server, change these URLs (see README, "Configuring endpoints").
   * Set `upload` to null to disable the upload test; it will then be shown as
   * "unavailable" instead of showing a made-up number.
   */
  endpoints: {
    provider: 'Cloudflare Speed Test (speed.cloudflare.com)',
    download: 'https://speed.cloudflare.com/__down',
    upload: 'https://speed.cloudflare.com/__up',
    ping: 'https://speed.cloudflare.com/__down', // requested with ?bytes=0
  },

  // Latency: `samples` measured requests after `warmup` discarded ones.
  ping: { samples: 20, warmup: 1, timeoutMs: 4000, minValid: 5 },

  // Download: parallel streams, fixed duration. The first `warmupMs`
  // (TCP slow start) are excluded from the final figure.
  download: {
    streams: 4,
    durationMs: 8000,
    warmupMs: 1500,
    minMeasureMs: 2000,
    chunkBytes: [10e6, 25e6], // first request per stream, then every later one
  },

  // Upload: parallel POST streams, fixed duration.
  upload: {
    streams: 3,
    durationMs: 7000,
    warmupMs: 1500,
    minMeasureMs: 2000,
    chunkBytes: 4e6,
  },

  // Try a local Three.js build first, then fall back to the CDN.
  three: {
    local: '../assets/vendor/three.module.min.js', // relative to js/3d-scene.js
    cdn: 'https://unpkg.com/three@0.160.0/build/three.module.min.js',
  },
};
