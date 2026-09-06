/**
 * Raksha Kendra (रक्षा केंद्र) — National Disaster Response Platform
 * Enhanced Progressive Web App (PWA) Emergency Service Worker
 * 
 * Capabilities:
 * - Full offline resilience for weak-connectivity disaster zones
 * - Pre-caches core application shell, offline AI lexicon, national helplines, and survival guides
 * - Stale-while-revalidate strategy for UI assets
 * - Immediate fallback to /index.html on navigation offline
 * - Synthetic JSON emergency fallback for offline API calls
 */

const CACHE_VERSION = 'raksha-kendra-v2.1';
const STATIC_CACHE = `raksha-static-${CACHE_VERSION}`;
const DATA_CACHE = `raksha-data-${CACHE_VERSION}`;
const RUNTIME_CACHE = `raksha-runtime-${CACHE_VERSION}`;

// Core static assets required for standalone offline boot
const CORE_PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/offline/dictionary.json',
  '/offline/contacts.json',
  '/offline/guides.json'
];

// Fallback emergency survival payload embedded directly into worker
const EMERGENCY_OFFLINE_PACK = {
  status: 'OFFLINE_STANDALONE_READY',
  system: 'Raksha Kendra Civil Defense Platform',
  timestamp: new Date().toISOString(),
  helplines: [
    { service: 'National Disaster Helpline (NDMA)', number: '1078' },
    { service: 'All-India Emergency', number: '112' },
    { service: 'Ambulance', number: '108' },
    { service: 'State Disaster EOC', number: '1070' },
    { service: 'NDRF Control Room', number: '011-24363260' }
  ],
  coreSurvivalTip: 'Water: Boil 3 mins or 2 drops bleach/L. Bleeding: Apply direct pressure or tourniquet 2-3 inches above wound. Signal: 3 whistle blasts or Morse SOS (... --- ...).'
};

// -------------------------------------------------------------
// Install Event: Pre-cache core shell and offline assets
// -------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[RakshaKendra SW] Caching emergency core shell & offline packs...');
      return cache.addAll(CORE_PRECACHE_URLS).catch((err) => {
        console.warn('[RakshaKendra SW] Warning caching precache URLs:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// -------------------------------------------------------------
// Activate Event: Purge outdated caches and claim clients
// -------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const currentCaches = [STATIC_CACHE, DATA_CACHE, RUNTIME_CACHE];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (!currentCaches.includes(name)) {
            console.log('[RakshaKendra SW] Deleting obsolete cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// -------------------------------------------------------------
// Message Event: Control interface from client
// -------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION, timestamp: Date.now() });
  } else if (event.data.type === 'PRECACHE_ADD') {
    const urls = event.data.urls || [];
    caches.open(STATIC_CACHE).then(cache => cache.addAll(urls));
  }
});

// -------------------------------------------------------------
// Fetch Event: Offline-first routing & graceful fallbacks
// -------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Skip caching for real-time cloud sync / database endpoints
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.pathname.startsWith('/api/live-sync')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({
          offline: true,
          error: 'DEVICE_OFFLINE',
          message: 'Real-time cloud sync is offline. Data queued to IndexedDB local persistence.'
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        });
      })
    );
    return;
  }

  // 2. Navigation Requests (HTML Page loads): Network-first with /index.html cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          return fallback || new Response('Raksha Kendra Offline Shell Ready', {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
    return;
  }

  // 3. Offline Data / API endpoints: Cache-first with embedded JSON fallback
  if (url.pathname.includes('/offline/') || url.pathname.includes('/_offline_data/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(DATA_CACHE).then(cache => cache.put(event.request, copy));
            }
            return networkResponse;
          })
          .catch(() => {
            // Return synthetic offline pack if network and cache both fail
            return new Response(JSON.stringify(EMERGENCY_OFFLINE_PACK), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
      })
    );
    return;
  }

  // 4. Static Assets & External CDNs (scripts, css, fonts, images, leaflet tiles)
  // Stale-While-Revalidate caching
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Cache successful responses from same-origin or CORS CDN
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const copy = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
