export type ApiContractRoute = {
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
  successStatuses: number[];
};
