import { router } from "expo-router";

export const useSplash = () => {
  const goToHome = () => {
    setTimeout(() => {
      router.replace("/login"); // ou "/home"
    }, 3000);
  };

  return { goToHome };
};