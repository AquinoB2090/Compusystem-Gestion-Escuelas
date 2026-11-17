import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => request.cookies.getAll(), setAll(values: { name: string; value: string; options: CookieOptions }[]) { values.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const publicRoute = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname === '/api/login';
  if (!user && !publicRoute) return NextResponse.redirect(new URL('/login', request.url));
  if (user && request.nextUrl.pathname === '/login') return NextResponse.redirect(new URL('/', request.url));
  if (user && !publicRoute) {
    const { data: profile } = await supabase.from('perfiles').select('rol').eq('id', user.id).eq('activo', true).maybeSingle();
    const pathname = request.nextUrl.pathname;
    const inInstallations = pathname === '/instalaciones' || pathname.startsWith('/instalaciones/');
    const isSignout = pathname === '/auth/signout';
    if (profile?.rol === 'ventas' && !inInstallations && !isSignout) return NextResponse.redirect(new URL('/instalaciones', request.url));
    if (profile?.rol === 'ventas' && inInstallations && pathname !== '/instalaciones' && pathname !== '/instalaciones/precios') return NextResponse.redirect(new URL('/instalaciones', request.url));
    if (inInstallations && profile?.rol !== 'admin' && profile?.rol !== 'ventas') return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
