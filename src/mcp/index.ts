#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
await createServer(process.env.LUDOSCOPE_PROJECT_ROOT ?? process.cwd()).connect(
  new StdioServerTransport(),
);
