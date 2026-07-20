import { API_URL } from "./api";
import { authFetch } from "./session";
import type {
  OnboardingExperience,
  OnboardingFrequency,
  OnboardingLevel,
} from "@/constants/onboarding";

export interface OnboardingAnswers {
  experience: OnboardingExperience;
  foundMate: boolean;
  frequency: OnboardingFrequency;
}

export interface OnboardingResult {
  already_completed: boolean;
  /** null quando already_completed (o backend não reprocessa). */
  level: OnboardingLevel | null;
  rating: number;
  provisional: boolean;
}

export async function submitOnboarding(
  token: string,
  answers: OnboardingAnswers
): Promise<OnboardingResult> {
  const res = await authFetch(`${API_URL}/api/v1/auth/onboarding/`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      experience: answers.experience,
      found_mate: answers.foundMate,
      frequency: answers.frequency,
    }),
  });
  if (!res.ok) throw new Error("Falha ao concluir o onboarding");
  return res.json();
}
