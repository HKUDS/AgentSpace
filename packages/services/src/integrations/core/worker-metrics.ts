export interface ExternalWorkerError {
  integrationId: string;
  errorCode: string;
  errorMessage: string;
}

export interface ExternalWorkerMetrics {
  connectionReadyCount: number;
  connectionErrorCount: number;
  receivedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  duplicateCount: number;
  outboxProcessedCount: number;
  outboxSentCount: number;
  outboxFailedCount: number;
  errors: ExternalWorkerError[];
}

export function createExternalWorkerMetrics(): ExternalWorkerMetrics;
export function createExternalWorkerMetrics<TExtraCounts extends Record<string, number>>(
  extraCounts: TExtraCounts,
): ExternalWorkerMetrics & TExtraCounts;
export function createExternalWorkerMetrics<TExtraCounts extends Record<string, number>>(
  extraCounts?: TExtraCounts,
): ExternalWorkerMetrics & TExtraCounts {
  const metrics: ExternalWorkerMetrics = {
    connectionReadyCount: 0,
    connectionErrorCount: 0,
    receivedCount: 0,
    processedCount: 0,
    ignoredCount: 0,
    failedCount: 0,
    duplicateCount: 0,
    outboxProcessedCount: 0,
    outboxSentCount: 0,
    outboxFailedCount: 0,
    errors: [],
  };
  return {
    ...metrics,
    ...(extraCounts ?? {}),
  } as unknown as ExternalWorkerMetrics & TExtraCounts;
}

export function recordExternalWorkerOutboxMetrics(
  metrics: ExternalWorkerMetrics,
  result: {
    processedCount: number;
    sentCount: number;
    failedCount: number;
    errors: Array<{
      integrationId: string;
      errorMessage: string;
    }>;
  },
  errorCode: string,
): void {
  metrics.outboxProcessedCount += result.processedCount;
  metrics.outboxSentCount += result.sentCount;
  metrics.outboxFailedCount += result.failedCount;
  for (const error of result.errors) {
    metrics.errors.push({
      integrationId: error.integrationId,
      errorCode,
      errorMessage: error.errorMessage,
    });
  }
}
