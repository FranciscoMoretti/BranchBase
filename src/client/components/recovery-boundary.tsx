import { RotateCcwIcon, XIcon } from "lucide-react";
import { Component } from "react";
import type { ReactNode } from "react";

import { ErrorDetails } from "../product/async-state";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

interface RecoveryBoundaryProps {
  children: ReactNode;
  description: string;
  dismissLabel?: string;
  onDismiss?: () => void;
  title: string;
}

interface RecoveryBoundaryState {
  error: Error | null;
}

export class RecoveryBoundary extends Component<
  RecoveryBoundaryProps,
  RecoveryBoundaryState
> {
  constructor(props: RecoveryBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): RecoveryBoundaryState {
    return { error };
  }

  private readonly handleReset = (): void => {
    // oxlint-disable-next-line react/no-set-state -- Error boundaries must clear captured errors to retry their children.
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="bg-background grid h-full min-h-0 place-items-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{this.props.title}</CardTitle>
            <CardDescription>{this.props.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ErrorDetails error={this.state.error} />
          </CardContent>
          <CardFooter className="justify-end gap-2">
            {this.props.onDismiss ? (
              <Button onClick={this.props.onDismiss} variant="outline">
                <XIcon data-icon="inline-start" />
                {this.props.dismissLabel ?? "Dismiss"}
              </Button>
            ) : (
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
              >
                Reload page
              </Button>
            )}
            <Button onClick={this.handleReset}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
}
