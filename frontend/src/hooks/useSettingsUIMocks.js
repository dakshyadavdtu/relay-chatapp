/**
 * Mock data for Settings UI. No API/socket.
 * Phase 3.6: UI-only migration.
 */
import { useState, useCallback } from "react";

const MOCK_PROFILE = {
  id: "mock-user-1",
  username: "user",
  displayName: "Demo User",
  email: "user@example.com",
  bio: "Sample bio.",
  avatarUrl: null,
  role: "user",
  createdAt: new Date().toISOString(),
};

const MOCK_DEVICES = [
  { id: "dev-1", name: "Chrome on Mac", type: "browser", location: "Local", ipAddress: "127.0.0.1", isCurrent: true, lastActive: new Date().toISOString() },
  { id: "dev-2", name: "iPhone 14 Pro", type: "mobile", location: "San Francisco, US", ipAddress: "192.168.1.1", isCurrent: false, lastActive: new Date(Date.now() - 3600000).toISOString() },
];

const MOCK_CONNECTION = {
  status: "Connected",
  latency: 42,
  uptime: 99.9,
  messageQueueSize: 0,
};

const MOCK_USERS = [
  { id: "u1", name: "Alice", displayName: "Alice", email: "alice@example.com", role: "admin" },
  { id: "u2", name: "Bob", displayName: "Bob", email: "bob@example.com", role: "user" },
];

const MOCK_REPORTS = [
  { id: "r1", title: "Monthly summary", date: "2024-01-15", status: "Completed", createdAt: "2024-01-15" },
  { id: "r2", title: "Activity log", date: "2024-01-14", status: "Pending", createdAt: "2024-01-14" },
];

export function useMockProfile() {
  const [data, setData] = useState(MOCK_PROFILE);
  const [isLoading] = useState(false);
  const [error] = useState(null);
  const refetch = useCallback(() => {}, []);
  return { data, isLoading, error, refetch };
}

export function useMockUpdateProfile() {
  const [isPending, setIsPending] = useState(false);
  const mutate = useCallback((payload, opts) => {
    setIsPending(true);
    setTimeout(() => {
      setIsPending(false);
      opts?.onSuccess?.();
    }, 500);
  }, []);
  return { mutate, isPending };
}

export function useMockChangePassword() {
  const [isPending, setIsPending] = useState(false);
  const mutate = useCallback((payload, opts) => {
    setIsPending(true);
    setTimeout(() => {
      setIsPending(false);
      opts?.onSuccess?.();
    }, 500);
  }, []);
  return { mutate, isPending };
}

export function useMockDevices() {
  const [data, setData] = useState(MOCK_DEVICES);
  const [isLoading] = useState(false);
  const [error] = useState(null);
  const refetch = useCallback(() => {}, []);
  return { data, isLoading, error, refetch };
}

export function useMockRevokeDevice() {
  const [isPending, setIsPending] = useState(false);
  const mutate = useCallback((id, opts) => {
    setIsPending(true);
    setTimeout(() => {
      setIsPending(false);
      opts?.onSuccess?.();
    }, 300);
  }, []);
  return { mutate, isPending };
}

export function useMockConnectionStatus() {
  const [data] = useState(MOCK_CONNECTION);
  const [isLoading] = useState(false);
  const [error] = useState(null);
  const refetch = useCallback(() => {}, []);
  return { data, isLoading, error, refetch };
}

export function useMockUsers() {
  const [data] = useState({ data: MOCK_USERS, page: 1, limit: 10, total: 2 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const handleRetry = useCallback(() => setError(null), []);
  const handleDelete = useCallback((id) => {
    setDeleteLoading(true);
    setTimeout(() => setDeleteLoading(false), 300);
  }, []);
  const goToPage = useCallback(() => {}, []);
  return {
    data: data.data,
    page: data.page,
    limit: data.limit,
    total: data.total,
    loading,
    error,
    deleteLoading,
    handleRetry,
    handleDelete,
    goToPage,
    searchInput: "",
    setSearchInput: () => {},
  };
}

export function useMockReports() {
  const [data] = useState({ data: MOCK_REPORTS, page: 1, limit: 10, total: 2 });
  const [loading] = useState(false);
  const [error] = useState(null);
  const handleRetry = useCallback(() => {}, []);
  const goToPage = useCallback(() => {}, []);
  return {
    data: data.data,
    page: data.page,
    limit: data.limit,
    total: data.total,
    loading,
    error,
    handleRetry,
    goToPage,
    searchInput: "",
    setSearchInput: () => {},
  };
}
