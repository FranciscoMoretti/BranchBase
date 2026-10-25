import { FileWarningIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

export const RepositorySetupNotice = ({
  configPath,
  onInitialize,
}: {
  configPath: string;
  onInitialize?: () => void;
}) => (
  <Alert>
    <FileWarningIcon />
    <AlertTitle>This repository needs Brum setup</AlertTitle>
    <AlertDescription>
      Review a detected starter configuration before Brum creates it, or add the
      file manually at <code>{configPath}</code>.
    </AlertDescription>
    {onInitialize ? (
      <AlertAction>
        <Button className="setup-button" onClick={onInitialize} size="sm">
          Review starter config
        </Button>
      </AlertAction>
    ) : null}
  </Alert>
);
