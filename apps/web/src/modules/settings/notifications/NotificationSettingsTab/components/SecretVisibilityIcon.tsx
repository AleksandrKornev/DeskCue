import EyeOffIcon from "@assets/images/icon-eye-off.svg?react";
import EyeIcon from "@assets/images/icon-eye.svg?react";

export function SecretVisibilityIcon({ visible }: { visible: boolean }) {
  const Icon = visible ? EyeOffIcon : EyeIcon;

  return <Icon aria-hidden="true" focusable="false" />;
}
