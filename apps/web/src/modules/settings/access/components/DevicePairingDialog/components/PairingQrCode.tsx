import QRCode from "qrcode";
import { useEffect, useState } from "react";

import styles from "@modules/settings/access/components/DevicePairingDialog/styles.module.scss";

export type PairingQrCodeProps = {
  value: string;
};

export function PairingQrCode({ value }: PairingQrCodeProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(value, {
      color: {
        dark: "#111318",
        light: "#ffffff"
      },
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrCodeUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrCodeUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!qrCodeUrl) {
    return null;
  }

  return (
    <div className={styles.qrPanel}>
      <img alt="Device pairing QR code" src={qrCodeUrl} />
      <span>Scan with the device camera</span>
    </div>
  );
}
