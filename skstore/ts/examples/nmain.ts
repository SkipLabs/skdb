import { main } from "./utils.js";
import { createRequire } from "node:module";
const requireFn = createRequire(import.meta.url);

const url = new URL("../../native/build/Release/skstore.node", import.meta.url);

console.log("Run example with node addon.");

const addon = requireFn(url.pathname);

await main(addon.createSKStore);
