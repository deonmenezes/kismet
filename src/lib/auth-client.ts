"use client";

import "./zod-jitless"; // first: before the auth client's schemas are built (no eval probe under the CSP)
import { createAuthClient } from "@neondatabase/auth/next";

// Browser side of the website sign-in (Google, emailed code); talks to /api/auth on our origin.
export const authClient = createAuthClient();
