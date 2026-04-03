/**
 * Vercel serverless entry: Express app mounted at /api (e.g. POST /api/mcp).
 * Run `npm run build` before deploy so ../build/httpApp.js exists.
 */

import { createHttpApp } from "../build/httpApp.js";

export default createHttpApp();
