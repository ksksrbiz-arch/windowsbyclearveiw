import { clearSessionCookie } from '../_lib/session.mjs';

export async function onRequestPost(context) {
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL('/internal/login', context.request.url).toString(),
      'set-cookie': clearSessionCookie(),
      'cache-control': 'no-store',
    },
  });
}
