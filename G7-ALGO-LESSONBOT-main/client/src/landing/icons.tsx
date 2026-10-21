/**
 * Landing-page icon imports.
 *
 * The icon set itself now lives in `components/icons.tsx` so the landing page
 * and the chat share one family — same grid, same stroke weight, same
 * `aria-hidden` convention. This module re-exports it so the landing's
 * existing import path (and its tests) are untouched.
 */
export {
  IconArrowDown,
  IconArrowDownToLine,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconChat,
  IconCheck,
  IconClose,
  IconCompare,
  IconCopy,
  IconEdit,
  IconGraph,
  IconHistory,
  IconLayers,
  IconLightbulb,
  IconMenu,
  IconPause,
  IconPlay,
  IconPlus,
  IconProof,
  IconQuiz,
  IconRestart,
  IconShield,
  IconStop,
  IconTrash,
} from "../components/icons";
