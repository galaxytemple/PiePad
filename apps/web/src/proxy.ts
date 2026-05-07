import { auth } from "@/auth";

// Next.js 16 renamed middleware -> proxy; Auth.js docs use the same name.
export const proxy = auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLoginPage = nextUrl.pathname === "/login";
  // /api/auth is excluded by the matcher below; everything else under /api is
  // a fetch target that should never receive an HTML 302 → /login (the fetch
  // can't follow into a sign-in page and the caller sees a useless redirect).
  const isApi = nextUrl.pathname.startsWith("/api/");

  if (!isLoggedIn && !isLoginPage) {
    if (isApi) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", nextUrl);
    if (nextUrl.pathname !== "/") {
      url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    }
    return Response.redirect(url);
  }

  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", nextUrl));
  }
});

// Skip middleware for:
// - /api/auth/* (NextAuth handles its own routing)
// - Next.js internals (_next/static, _next/image)
// - Static metadata files we serve from app/ (icon.svg, apple-icon.png)
export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|icon\\.svg|apple-icon\\.png|favicon).*)",
  ],
};
