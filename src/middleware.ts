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



$file = "D:\shorescoa-survey\src\pages\index.astro"
$content = Get-Content $file -Raw

# Remove required from arrival date, departure date, and unit number inputs
$content = $content -replace '(<input[^>]*id="arrival_date"[^>]*)\s*required([^>]*>)', '$1$2'
$content = $content -replace '(<input[^>]*id="departure_date"[^>]*)\s*required([^>]*>)', '$1$2'
$content = $content -replace '(<input[^>]*id="unit_number"[^>]*)\s*required([^>]*>)', '$1$2'

Set-Content $file -Value $content -Encoding UTF8

git -C D:\shorescoa-survey add src/pages/index.astro
git -C D:\shorescoa-survey commit -m "Make arrival date, departure date, and unit number optional"
git -C D:\shorescoa-survey push


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
