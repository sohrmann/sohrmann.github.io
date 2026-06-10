const CACHE_NAME = "cinebubs-precache";
const PRECACHE_MANIFEST = [
  { url: "./", revision: "1.0.6" },
  { url: "./index.html", revision: "1.0.6" },
  { url: "./style.css", revision: "1.0.9" },
  { url: "./script.js", revision: "1.0.8" },
  { url: "./icon-192.png", revision: "1.0.0" },
  { url: "./icon-512.png", revision: "1.0.0" }
];

// Install Service Worker and precache/update assets
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const keys = await cache.keys();
      
      // Map currently cached absolute URLs to their full Request keys
      const cachedRequestsMap = {};
      keys.forEach((req) => {
        const baseUrl = req.url.split("?")[0];
        cachedRequestsMap[baseUrl] = req;
      });

      // Precache assets that are missing or out-of-date
      const precachePromises = PRECACHE_MANIFEST.map(async (asset) => {
        // Resolve relative paths to absolute URLs for correct matching
        const absoluteUrl = new URL(asset.url, self.location.href).toString();
        const cachedReq = cachedRequestsMap[absoluteUrl];
        
        // Construct the cache key URL with query parameter revision
        const cacheKeyUrl = `${asset.url}?v=${asset.revision}`;
        
        if (cachedReq) {
          const cachedUrlObj = new URL(cachedReq.url);
          const cachedVersion = cachedUrlObj.searchParams.get("v");
          
          if (cachedVersion === asset.revision) {
            // Already cached and up to date
            return;
          }
          // Out of date: delete old request key
          await cache.delete(cachedReq);
        }
        
        // Fetch new version and store it in cache
        try {
          const response = await fetch(asset.url);
          if (response.ok) {
            await cache.put(cacheKeyUrl, response);
            console.log(`Precached: ${asset.url} (v${asset.revision})`);
          }
        } catch (err) {
          console.error(`Failed to precache ${asset.url}:`, err);
        }
      });
      
      await Promise.all(precachePromises);
    })
  );
  self.skipWaiting();
});

// Clean up old dynamic or custom caches on activation
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Cache-First strategy for precached assets, falling back to network
self.addEventListener("fetch", (e) => {
  // Only handle GET requests
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
