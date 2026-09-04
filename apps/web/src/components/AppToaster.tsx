import { Toaster } from "sonner";

import styles from "./AppToaster.module.scss";

export function AppToaster() {
  return (
    <Toaster
      className={styles.toaster}
      closeButton
      duration={4000}
      mobileOffset={{ top: "96px" }}
      offset={96}
      position="top-center"
      richColors={false}
      theme="dark"
    />
  );
}
