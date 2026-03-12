import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary — catches React render errors and displays a recovery UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-text-secondary mb-4 max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Feature-level error boundary with a simpler inline fallback.
 */
interface FeatureErrorProps {
  children: ReactNode;
  name: string;
}

interface FeatureErrorState {
  hasError: boolean;
}

export class FeatureErrorBoundary extends Component<FeatureErrorProps, FeatureErrorState> {
  constructor(props: FeatureErrorProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): FeatureErrorState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[${this.props.name}]`, error, errorInfo.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-3 p-4 bg-surface rounded-lg">
          <span className="text-yellow-500">⚠️</span>
          <span className="text-sm text-text-secondary">{this.props.name} error</span>
          <button
            onClick={this.handleRetry}
            className="text-xs text-accent hover:underline ml-auto"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
