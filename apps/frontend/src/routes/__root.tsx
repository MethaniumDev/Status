import { createRootRoute, Outlet } from "@tanstack/react-router";

import { Header } from "../components/layout/Header";

const EmptyPage = () => (
  <main className="min-h-[calc(100vh-3rem)] bg-background text-2xl w-full h-full items-center justify-center flex font-medium">
    404 Page Not Found
  </main>
);

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Outlet />
      <a
        href="https://legal.methanium.net/methanium/privacy-policy"
        target="_blank"
        className="hover:underline fixed bottom-0 left-0 p-3"
      >
        Privacy Policy
      </a>
    </div>
  ),
  notFoundComponent: EmptyPage,
});
