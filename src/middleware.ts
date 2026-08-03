import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname === '/' || pathname === '') {
    const env = (context.locals as any).runtime?.env;
    const SURVEY_TOKEN = env?.SURVEY_TOKEN;

    if (!SURVEY_TOKEN) {
      return next();
    }

    const urlToken    = context.url.searchParams.get('token');
    const cookieToken = context.cookies.get('survey_auth')?.value;

    if (urlToken === SURVEY_TOKEN) {
      context.cookies.set('survey_auth', SURVEY_TOKEN, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      return next();
    } else if (cookieToken === SURVEY_TOKEN) {
      return next();
    } else {
      return context.redirect('/denied');
    }
  }

  return next();
});