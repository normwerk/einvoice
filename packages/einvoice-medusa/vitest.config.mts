import { configDefaults, defineConfig } from "vitest/config";

// Only this package needs its own vitest config: `.medusa/server` is `medusa plugin:build`'s compiled-CJS
// output, the equivalent of `dist/` elsewhere in this repo — vitest's default discovery would otherwise
// also pick up its transpiled `*.test.js` copies and fail to run them as CommonJS.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.medusa/**"],
  },
});
