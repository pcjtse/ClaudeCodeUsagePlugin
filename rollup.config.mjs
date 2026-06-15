import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.pcjtse.claudeusage.sdPlugin/bin/plugin.js",
    sourcemap: true,
    format: "cjs",
  },
  plugins: [
    typescript(),
    nodeResolve({ browser: false, exportConditions: ["node"] }),
    commonjs(),
  ],
  external: [],
};
