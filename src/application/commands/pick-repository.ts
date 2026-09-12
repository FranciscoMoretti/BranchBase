import { currentHost } from "../../adapters/host/host-adapter";

export interface PickRepositoryResult {
  path: string | null;
}

export const pickRepository = (): PickRepositoryResult => ({
  path: currentHost().pickRepository(),
});
