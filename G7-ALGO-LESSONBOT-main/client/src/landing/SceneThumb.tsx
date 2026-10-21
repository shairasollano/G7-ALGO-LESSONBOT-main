/**
 * Small static preview of a scene, used on the topic cards.
 *
 * Reuses the hero's own graph and tableau renderers, so a card's diagram is the
 * same drawing code — and the same verified fixture data — as the animation.
 * The step shown is the one that distinguishes the most states, because a
 * preview of a completed run is often uniform (every vertex selected, every
 * edge covered) and would not illustrate the algorithm.
 */
import { landingScenes, type Scene, type SceneStep } from "@shared/landing-scenes";
import { edgeStateOf, GraphView, nodeStateOf, TableauView } from "./AlgoScene";

export function sceneForTopic(topicId: string): Scene | undefined {
  return landingScenes.find((scene) => scene.topicId === topicId);
}

/** How many distinct visual states a step puts on screen. */
function distinctStates(scene: Scene, step: SceneStep): number {
  const states = new Set<string>();
  for (const graph of scene.graphs) {
    for (const node of graph.nodes) states.add(nodeStateOf(step, graph.key, node.id));
    for (const edge of graph.edges) states.add(edgeStateOf(step, graph.key, edge.source, edge.target));
  }
  if (step.tableau?.initialConfig) states.add("initial");
  if (step.tableau?.window) states.add("window");
  if (step.tableau?.accept) states.add("accept");
  return states.size;
}

/** The most illustrative step of a scene (ties resolve to the later step). */
export function previewStep(scene: Scene): SceneStep {
  let best = scene.steps[0];
  let bestScore = -1;
  for (const step of scene.steps) {
    const score = distinctStates(scene, step);
    if (score >= bestScore) {
      bestScore = score;
      best = step;
    }
  }
  return best;
}

export function SceneThumb({ scene }: { scene: Scene }) {
  const step = previewStep(scene);
  const graph = scene.graphs[0];
  return (
    <div className="lp-thumb" aria-hidden="true">
      {scene.tableau && <TableauView tableau={scene.tableau} step={step} />}
      {graph && <GraphView graph={graph} step={step} signals={[]} />}
    </div>
  );
}
