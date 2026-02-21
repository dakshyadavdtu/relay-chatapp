/**
 * Standardized API error handling helper
 */

import { toast } from "@/hooks/useToast";

/**
 * Handle API errors with standardized logging and user feedback
 */
export function handleApiError(error, context = {}) {
  const {
    operation = "API operation",
    metadata = {},
    showToast = true,
    fallbackMessage = "An error occurred. Please try again.",
  } = context;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`[API_ERROR] ${operation} failed`, {
    error: errorMessage,
    stack: errorStack,
    ...metadata,
  });

  if (showToast) {
    toast({
      title: "Error",
      description: errorMessage || fallbackMessage,
      variant: "destructive",
    });
  }

  return error;
}

/**
 * Handle API response errors
 */
export async function handleApiResponseError(response, context = {}) {
  const {
    operation = "API request",
    metadata = {},
    showToast = true,
  } = context;

  let errorData = {};
  try {
    errorData = await response.json();
  } catch {
    errorData = { message: response.statusText || `HTTP ${response.status}` };
  }

  const errorMessage = errorData.message || `Request failed with status ${response.status}`;
  const error = new Error(errorMessage);
  error.status = response.status;
  error.data = errorData;

  handleApiError(error, {
    operation,
    metadata: { ...metadata, status: response.status, statusText: response.statusText },
    showToast,
    fallbackMessage: errorMessage,
  });

  return error;
}

/**
 * Wrap async function with error handling
 */
export async function withErrorHandling(fn, context = {}) {
  try {
    return await fn();
  } catch (error) {
    handleApiError(error, context);
    throw error;
  }
}
