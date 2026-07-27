import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/play(.*)",
  "/profile(.*)",
  "/forge(.*)",
  "/bazaar(.*)",
  "/council(.*)",
  "/guilds(.*)",
  "/api/v1/books/publish(.*)",
  "/api/v1/items/craft(.*)",
  "/api/v1/profile(.*)",
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
