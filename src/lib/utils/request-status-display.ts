/**
 * Component: Request Status Display
 * Documentation: documentation/frontend/components.md
 */

interface RequestStatusDetails {
  status: string;
  lastSearchAt?: string | Date | null;
  errorMessage?: string | null;
}

export function getRequestDisplayStatus({ status, lastSearchAt, errorMessage }: RequestStatusDetails): string {
  if (status !== 'awaiting_search' || !lastSearchAt) return status;

  if (errorMessage === "No ebook sources enabled. Enable Anna's Archive or Indexer Search in settings.") {
    return status;
  }

  return 'no_suitable_match';
}
