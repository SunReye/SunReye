// The motion tier and the motion every screen shares (ADRs 21, 25): one store measures the whole
// page, the builder's studio and the consumer's screens alike. Loads no three.js.

export { ease, fade, MOTION_EASE, MOTION_MS, motionMs } from "../motion.ts";

export { motion } from "../motion/tier.svelte.ts";

export { MOTION_SETTINGS, type MotionSetting, type MotionTier } from "../motion/tier.ts";

export { spring, tween, VelocityTracker } from "../animate.ts";
