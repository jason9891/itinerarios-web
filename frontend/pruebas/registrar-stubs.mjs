// Redirige "../shared/auth.js" (Firebase por URL) a un stub para poder probar en Node.
import { register } from "node:module";
register("./stubs-loader.mjs", import.meta.url);
import "./indexeddb-falso.mjs";
