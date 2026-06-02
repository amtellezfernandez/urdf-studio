import { STUDIO_LOADING_MESSAGE } from "@/features/layout/page/loadingScreenParams";

type LoadingScreenProps = {
  message?: string;
};

export const LoadingScreen = ({ message = STUDIO_LOADING_MESSAGE }: LoadingScreenProps) => (
  <div className="flex-1 flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  </div>
);
