// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Hyungyu Kim

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import type { ErrorResponse } from "@/types/api";

// Get API base URL from environment variable, default to frontend host:8081
const getApiBaseUrl = (): string => {
  // Check for environment variable (Next.js replaces NEXT_PUBLIC_* at build time)
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envUrl) {
    return envUrl;
  }

  // Mirror the page's protocol so an HTTPS page calls an HTTPS API and a
  // WSS page opens a WSS socket; this avoids mixed-content blocking.
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8081`;
  }

  // Fallback for server-side rendering
  return "http://localhost:8081";
};

export const API_BASE_URL = getApiBaseUrl();

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Error handler
function handleError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ErrorResponse | { detail?: string }>;
    const data = axiosError.response?.data;
    const apiError =
      data && "error" in data && typeof data.error === "string" ? data.error : null;
    const detail =
      data && "detail" in data && typeof data.detail === "string"
        ? data.detail
        : null;
    const message =
      apiError ||
      detail ||
      axiosError.message ||
      "An unknown error occurred";
    throw new Error(message);
  }
  throw error;
}

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await apiClient.request<T>(config);
    return response.data;
  } catch (error) {
    handleError(error);
  }
}
