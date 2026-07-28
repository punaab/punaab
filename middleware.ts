import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/account(.*)",
  "/api/v1/projects(.*)",
  "/api/v1/keys(.*)",
  "/api/v1/credits(.*)",
  "/api/v1/characters(.*)",
  // Managing embed tokens is dashboard work. The *public* embed surfaces
  // (/api/v1/embed/chat and /config) authenticate with an embed token and an
  // origin check instead, and must stay reachable from customers' sites.
  "/api/v1/embed/tokens(.*)",
  "/api/v1/embed/bridges(.*)",
  "/api/stripe/checkout(.*)",
  "/api/stripe/portal(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
