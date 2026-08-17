import net from "node:net";
import { networkInterfaces } from "node:os";
import type { NetworkInterfaceInfo } from "node:os";

function isPrivateIPv4Address(address: string) {
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;

  const [first, second] = address.split(".").map(Number);
  return first === 172 && second >= 16 && second <= 31;
}

function isUsableIPv4Address(info: NetworkInterfaceInfo) {
  return info.family === "IPv4" && !info.internal;
}

function listLanIPv4Addresses() {
  const privateAddresses: string[] = [];
  const publicAddresses: string[] = [];

  for (const interfaces of Object.values(networkInterfaces())) {
    for (const info of interfaces ?? []) {
      if (!isUsableIPv4Address(info)) continue;

      if (isPrivateIPv4Address(info.address)) {
        privateAddresses.push(info.address);
      } else {
        publicAddresses.push(info.address);
      }
    }
  }

  return [...privateAddresses, ...publicAddresses];
}

export function findLanIPv4Address() {
  return listLanIPv4Addresses()[0] ?? null;
}

function formatHostForUrl(host: string) {
  return net.isIPv6(host) && !host.startsWith("[") ? `[${host}]` : host;
}

function normalizeHost(value: string) {
  const host = value.trim();
  if (!host) return null;

  try {
    return new URL(host.includes("://") ? host : `http://${formatHostForUrl(host)}`).hostname;
  } catch {
    return host.replace(/^\[|\]$/g, "");
  }
}

export function isLocalInterfaceHost(host: string) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;

  return listLanIPv4Addresses().includes(normalizedHost);
}

export function isLoopbackHost(host: string) {
  const normalizedHost = normalizeHost(host);

  return (
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "::1"
  );
}
