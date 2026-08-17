import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      closeButton={false}
      duration={2400}
      mobileOffset={{ bottom: "116px" }}
      offset={24}
      position="bottom-center"
      richColors={false}
      theme="dark"
      toastOptions={{
        style: {
          background: "rgba(27, 72, 46, 0.96)",
          borderColor: "rgba(64, 162, 104, 0.32)",
          color: "#b6f4c8",
          fontWeight: 800
        }
      }}
    />
  );
}
