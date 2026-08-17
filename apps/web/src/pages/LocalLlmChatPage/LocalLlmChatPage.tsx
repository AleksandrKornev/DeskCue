import { Navigate, useNavigate, useParams } from "react-router";

import type { DashboardState } from "@modules/dashboard";
import { LocalLlmManagedSessionPanel } from "@modules/localLlmChats";

import styles from "./styles.module.scss";

type LocalLlmChatPageProps = {
  dashboard: DashboardState;
};

export function LocalLlmChatPage({ dashboard }: LocalLlmChatPageProps) {
  const navigate = useNavigate();
  const { chatId } = useParams();

  if (!chatId) {
    return <Navigate replace to="/" />;
  }

  return (
    <div className={styles.appShell}>
      <main className={styles.layout}>
        <LocalLlmManagedSessionPanel
          chatId={chatId}
          runtimes={dashboard.overview.visibleRuntimes}
          workspaces={dashboard.overview.overview.workspaces}
          onExit={() => navigate("/")}
        />
      </main>
    </div>
  );
}
