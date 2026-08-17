import path from "node:path";

const lintWorkspace = (workspace, directory) => (files) => {
  const relativeFiles = files.map((file) => JSON.stringify(path.relative(directory, file)));

  return `npm exec --workspace ${workspace} -- eslint -- ${relativeFiles.join(" ")}`;
};

const lintDaemon = lintWorkspace("@deskcue/daemon", "apps/daemon");
const lintWeb = lintWorkspace("@deskcue/web", "apps/web");

export default {
  "apps/daemon/src/**/*.ts": lintDaemon,
  "apps/web/{src,e2e,scripts}/**/*.{ts,tsx,mjs}": lintWeb,
  "apps/web/{playwright,vite,vite.embed,vitest}.config.ts": lintWeb
};
