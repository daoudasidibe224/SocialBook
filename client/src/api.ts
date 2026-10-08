import axios from "axios";
import { z } from "zod";
export const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? location.origin : "http://127.0.0.1:5000")
).replace(/\/$/, "");
const transport = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 15000,
});
export const api = {
  async get<T>(schema: z.ZodType<T>, url: string): Promise<{ data: T }> {
    const response = await transport.get<unknown>(url);
    return { data: schema.parse(response.data) };
  },
  async post<T = unknown>(
    url: string,
    data?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<{ data: T | undefined }> {
    const response = await transport.post<unknown>(url, data);
    return { data: schema?.parse(response.data) };
  },
  patch: (url: string, data: unknown) => transport.patch<unknown>(url, data),
  put: (url: string, data: unknown) => transport.put<unknown>(url, data),
  request: (options: {
    method: "patch" | "put" | "delete";
    url: string;
    data?: unknown;
  }) => transport.request<unknown>(options),
};
const errorSchema = z.object({ message: z.string() });
export const isUnauthorized = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 401;
export const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError<unknown>(error)) {
    const result = errorSchema.safeParse(error.response?.data);
    if (result.success) return result.data.message;
  }
  if (
    error instanceof Error &&
    !axios.isAxiosError(error) &&
    !(error instanceof z.ZodError)
  )
    return error.message;
  return error instanceof z.ZodError
    ? "La réponse du serveur est invalide. Actualisez la page."
    : "La connexion au serveur a échoué. Réessayez dans un instant.";
};
export const imageUrl = (picture?: string) => {
  if (!picture) return "/uploads/profil/random-user.png";
  if (picture.startsWith("./uploads/")) return `${API_URL}/${picture.slice(2)}`;
  if (picture.startsWith("/uploads/")) return `${API_URL}${picture}`;
  if (/^https?:\/\//.test(picture)) return picture;
  return "/uploads/profil/random-user.png";
};
export const dateLabel = (value: string | number) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
