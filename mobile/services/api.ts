export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const NODE_URL = process.env.EXPO_PUBLIC_NODE_URL ?? "http://localhost:3000";
export const ENV = (process.env.EXPO_PUBLIC_ENV ?? "development") as "development" | "preview" | "production";

export const IS_DEV = ENV === "development";
export const IS_PROD = ENV === "production";
