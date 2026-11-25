import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type WrittenCookie = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api/');
  const publicRoute = pathname.startsWith('/login') || pathname === '/api/login';
  let response = NextResponse.next({ request });
  const writtenCookies: WrittenCookie[] = [];
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values: WrittenCookie[]) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        writtenCookies.push(...values);
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getUser() puede renovar cookies: hay que propagarlas a cualquier respuesta
  // anticipada (redirects o JSON), no solo al NextResponse.next() final.
  const withCookies = <T extends NextResponse>(target: T) => {
    writtenCookies.forEach(({ name, value, options }) => target.cookies.set(name, value, options));
    return target;
  };
  const redirect = (path: string) => withCookies(NextResponse.redirect(new URL(path, request.url)));
  const unauthorized = (message: string) => isApi
    ? withCookies(NextResponse.json({ error: message }, { status: 401 }))
    : redirect('/login');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !publicRoute) return unauthorized('Inicia sesión para continuar.');
  if (user && pathname === '/login') return redirect('/');
  if (user && !publicRoute) {
    const { data: profile } = await supabase.from('perfiles').select('rol,activo').eq('id', user.id).maybeSingle();
    if (!profile || profile.activo === false) {
      // Una cuenta desactivada no debe conservar una sesión válida.
      await supabase.auth.signOut();
      return unauthorized('La cuenta no está activa.');
    }
    const inInstallations = pathname === '/instalaciones' || pathname.startsWith('/instalaciones/');
    const isSignout = pathname === '/auth/signout';
    const allowedSalesRoute = pathname === '/instalaciones' || pathname === '/instalaciones/precios' || pathname === '/instalaciones/cotizaciones';
    if (profile.rol === 'ventas' && !inInstallations && !isSignout) return redirect('/instalaciones');
    if (profile.rol === 'ventas' && inInstallations && !allowedSalesRoute) return redirect('/instalaciones');
    if (inInstallations && profile.rol !== 'admin' && profile.rol !== 'ventas') return redirect('/');
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
