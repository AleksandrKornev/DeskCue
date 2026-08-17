import { createLocalAccessLink } from "@api/connection/pairing";
import { accessApi } from "@api/endpoint/access/endpoints";

export async function createDevicePairingLink() {
  try {
    return await accessApi.createDevicePairingLink();
  } catch {
    return createLocalAccessLink("device");
  }
}
