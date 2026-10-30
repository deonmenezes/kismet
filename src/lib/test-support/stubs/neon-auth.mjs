// @neondatabase/auth for tests: never signed in.
export const createNeonAuth = () => ({ getSession: async () => ({ data: null }) });
