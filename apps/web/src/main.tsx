import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";

import { AppToaster } from "@components/AppToaster";
import { ConfirmDialogHost } from "@components/ModalDialog";
import {
  createLocalDeskCueRuntime,
  DeskCueRuntimeProvider,
  initializeDeskCueRuntime
} from "@runtime";

import { ConnectionConfigBootstrap } from "./ConnectionConfigBootstrap";
import "./styles.scss";

const runtime = initializeDeskCueRuntime(createLocalDeskCueRuntime());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DeskCueRuntimeProvider runtime={runtime}>
      <BrowserRouter basename={runtime.routerBasename}>
        <ConnectionConfigBootstrap />
        <ConfirmDialogHost />
        <AppToaster />
      </BrowserRouter>
    </DeskCueRuntimeProvider>
  </React.StrictMode>
);
