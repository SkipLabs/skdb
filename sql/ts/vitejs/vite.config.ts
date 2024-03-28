import express from "express";
import chalk from "chalk";
import { defineConfig, ProxyOptions, ViteDevServer } from "vite";

const app = express();

// @ts-ignore
app.get("/api/succeed", (req, res) => {
  let message = chalk.green("[OK]") + " DEV SKDB successfully started.";
  console.log(message);
  res.send("[OK] DEV SKDB successfully started.").end();
  // @ts-ignore
  process.exit();
});

// @ts-ignore
app.get("/api/creationfailed", (req, res) => {
  let message = chalk.red("[FAILED]") + " Unable to use DEV SKDB.";
  console.log(message);
  res.send("[FAILED] Unable to use DEV SKDB.").end();
  // @ts-ignore
  process.exit();
});

// @ts-ignore
app.get("/api/loadfailed", (req, res) => {
  let message = chalk.red("[FAILED]") + " Unable to load DEV SKDB.";
  console.log(message);
  res.send("[FAILED] Unable to load DEV SKDB.").end();
  // @ts-ignore
  process.exit();
});

const proxy: Record<string, string | ProxyOptions> = {
  "/api": {}, // proxy our /api route to nowhere
};

function expressPlugin() {
  return {
    name: "express-plugin",
    config() {
      return {
        server: { proxy },
        preview: { proxy },
      };
    },
    configureServer(server: ViteDevServer) {
      // @ts-ignore
      server.middlewares.use(app);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [expressPlugin()],
  worker: {
    format: "es",
  },
  optimizeDeps: { exclude: ["skdb"] },
});
