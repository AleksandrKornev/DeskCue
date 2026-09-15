export const LINUX_NODE_VERSION = "24.14.0";

export const LINUX_NODE_ARCHIVES = {
  arm64: {
    name: `node-v${LINUX_NODE_VERSION}-linux-arm64.tar.xz`,
    sha256: "e7adfca03d9173276114a6f2219df1a7d25e1bfd6bbd771d3f839118a2053094"
  },
  x64: {
    name: `node-v${LINUX_NODE_VERSION}-linux-x64.tar.xz`,
    sha256: "41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df"
  }
};

export function nodeArchiveUrl(architecture) {
  return `https://nodejs.org/dist/v${LINUX_NODE_VERSION}/${LINUX_NODE_ARCHIVES[architecture].name}`;
}
