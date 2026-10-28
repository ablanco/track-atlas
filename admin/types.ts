export type AdminValue =
  | string
  | number
  | boolean
  | null
  | AdminValue[]
  | { [key: string]: AdminValue };
export type AdminRecord = {
  id: string;
  values: Record<string, AdminValue>;
  related: { field: string; model: string; id: string }[];
  selectable: boolean;
};
export type AdminPage = {
  rows: AdminRecord[];
  total: number;
  page: number;
  pageSize: number;
};
export type AdminMutationRequest = {
  model: string;
  operation: "update" | "delete" | "revoke";
  ids: string[];
  values?: Record<string, AdminValue>;
};
export class AdminError extends Error {
  constructor(
    public code: "unauthorized" | "forbidden" | "invalidRequest" | "notFound",
  ) {
    super(code);
  }
}
