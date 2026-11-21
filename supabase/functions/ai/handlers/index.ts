import type { Handler } from './_shared.ts';
import { analyzeDoc } from './analyze_doc.ts';
import { generateIdeas } from './generate_ideas.ts';
import { nodeFeedback } from './node_feedback.ts';
import { reviewAll } from './review_all.ts';
import { suggestDirection } from './suggest_direction.ts';
import { suggestRoles } from './suggest_roles.ts';
import { helpBlocked } from './help_blocked.ts';
import { concretizeNode } from './concretize_node.ts';

export const handlers: Record<string, Handler> = {
  analyze_doc: analyzeDoc,
  generate_ideas: generateIdeas,
  concretize_node: concretizeNode,
  node_feedback: nodeFeedback,
  review_all: reviewAll,
  suggest_direction: suggestDirection,
  suggest_roles: suggestRoles,
  help_blocked: helpBlocked,
};
