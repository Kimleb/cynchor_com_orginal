// Use the same request-local cookie context as Next.js route handlers.
import 'next/dist/server/node-environment';
import { NextRequest } from 'next/server';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { createWorkStore } from 'next/dist/server/async-storage/work-store';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store';

export function request(handler: (req: NextRequest) => Promise<Response>, body?: object, cookie = '', ip = '192.0.2.1', cookieName = 'cynchor_session') {
  const req = new NextRequest('http://localhost/api/auth', {
    method: body ? 'POST' : 'GET',
    headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body && JSON.stringify(body),
  });
  const store = createRequestStoreForAPI(req, req.nextUrl, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined, undefined);
  const work = createWorkStore({
    page: '/api/auth/route',
    buildId: 'test',
    deploymentId: '',
    previouslyRevalidatedTags: [],
    renderOpts: {
      assetPrefix: '',
      waitUntil: undefined,
      onClose: () => {},
      onAfterTaskError: undefined,
      isBuildTimePrerendering: false,
      isDraftMode: false,
      cacheLifeProfiles: { default: { stale: 0, revalidate: 0, expire: 0 } },
      staticPageGenerationTimeout: 60,
      cacheComponents: false,
      validationLevel: 'warning',
      experimental: { authInterrupts: false, useCacheTimeout: 60_000, durableUseCacheEntries: false },
    },
  });
  return workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, async () => {
    const response = await handler(req);
    return { response, cookie: store.mutableCookies.get(cookieName) };
  }));
}
