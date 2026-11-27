// Install the same request-local cookie context used by Next's app router.
import 'next/dist/server/node-environment';
import { NextRequest } from 'next/server';
import { actionAsyncStorage } from 'next/dist/client/components/action-async-storage.external';
import { requestAsyncStorage } from 'next/dist/client/components/request-async-storage.external';
import { RequestAsyncStorageWrapper } from 'next/dist/server/async-storage/request-async-storage-wrapper';

export function request(handler: (req: NextRequest) => Promise<Response>, body?: object, cookie = '', ip = '192.0.2.1', cookieName = 'cynchor_session') {
  const req = new NextRequest('http://localhost/api/auth', {
    method: body ? 'POST' : 'GET',
    headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body && JSON.stringify(body),
  });
  return actionAsyncStorage.run({ isAppRoute: true }, () =>
    RequestAsyncStorageWrapper.wrap(requestAsyncStorage, { req }, async store => {
      const response = await handler(req);
      return { response, cookie: store.mutableCookies.get(cookieName) };
    })
  );
}
