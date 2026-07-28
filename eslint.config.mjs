import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    // The 3D hero scene.
    //
    // `react-hooks/immutability` and `react-hooks/refs` encode the React
    // Compiler's purity model: values reached through hooks are treated as
    // frozen after render. react-three-fiber is the opposite model by design —
    // a scene is built once and then *mutated* every frame by `useFrame`. The
    // camera returned by `useThree()` is positioned by assignment, an object
    // must be handed to `<primitive object={...}>` during render, and
    // per-frame state is deliberately kept in refs precisely so it does NOT
    // trigger a render sixty times a second.
    //
    // Everything genuinely fixable has been fixed (mutable rigs and scratch
    // vectors live in refs, device probing seeds state lazily instead of via
    // an effect). What remains is the render loop itself, which cannot be
    // expressed any other way. Scoped to this directory so the rules stay on
    // everywhere else in the app.
    files: ["components/world/**/*.tsx", "components/downloads/BardPreview.tsx"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },

  {
    // Build/ops scripts are plain CommonJS run directly by `node`, not bundled
    // application code. `require()` is correct there.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
