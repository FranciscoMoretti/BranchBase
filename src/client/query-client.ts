import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { networkMode: "always" },
    queries: {
      // The local service can remain reachable when the browser reports no internet.
      networkMode: "always",
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 1500,
    },
  },
});
