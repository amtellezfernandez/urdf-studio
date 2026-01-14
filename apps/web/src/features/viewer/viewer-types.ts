export interface AnimationFrame {
  timestamp: number;
  joints: Record<string, number>;
}
