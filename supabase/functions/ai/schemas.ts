// action별 JSON Schema (Structured Outputs, strict: true)
// 규칙: 모든 object에 additionalProperties:false, 모든 프로퍼티를 required에 넣는다.

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: { type: 'string' } } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const arr = (items: unknown) => ({ type: 'array', items });
const commentKind = { type: 'string', enum: ['praise', 'warning', 'suggestion', 'feedback'] };
const feasibility = { type: 'integer', enum: [1, 2, 3, 4, 5] };
const scopeItems = arr(obj({ item: str, why: str }));

export const schemas = {
  analyze_doc: obj({
    summary: str,
    requirements: arr(obj({
      category: { type: 'string', enum: ['topic', 'deliverable', 'constraint', 'criteria', 'deadline', 'etc'] },
      content: str,
      importance: { type: 'integer', enum: [1, 2, 3] },
      source_quote: str,
    })),
  }),

  generate_ideas: obj({
    ideas: arr(obj({
      parent_ref: str,
      title: str,
      description: str,
      requirement_refs: strArr,
      experience_refs: strArr,
      feasibility,
      how_we_do_it: str,
    })),
  }),

  concretize_node: obj({
    feasibility,
    feasibility_note: str,
    research_methods: arr(obj({
      method: str,
      why: str,
      experience_refs: strArr,
      owner_refs: strArr,
      requirement_refs: strArr,
    })),
    scope: obj({
      mvp: scopeItems,
      stretch: scopeItems,
      out_of_scope: scopeItems,
    }),
    risks: arr(obj({ risk: str, mitigation: str })),
    tasks: arr(obj({ content: str, owner_ref: str })),
  }),

  node_feedback: obj({
    comments: arr(obj({
      kind: commentKind,
      content: str,
      requirement_refs: strArr,
      experience_refs: strArr,
    })),
  }),

  review_all: obj({
    summary: str,
    coverage: arr(obj({
      requirement_ref: str,
      status: { type: 'string', enum: ['covered', 'partial', 'missing'] },
      node_refs: strArr,
      reason: str,
    })),
    capability_gaps: arr(obj({
      skill: str,
      node_refs: strArr,
      requirement_refs: strArr,
      mitigation: str,
      learner_refs: strArr,
    })),
    node_comments: arr(obj({
      node_ref: str,
      kind: commentKind,
      content: str,
      requirement_refs: strArr,
    })),
    gaps: arr(obj({
      title: str,
      why: str,
      suggested_parent_ref: { type: ['string', 'null'] },
      requirement_refs: strArr,
    })),
  }),

  suggest_direction: obj({
    directions: arr(obj({
      focus_ref: str,
      title: str,
      why: str,
      next_questions: strArr,
      requirement_refs: strArr,
      experience_refs: strArr,
    })),
  }),

  suggest_roles: obj({
    assignments: arr(obj({
      node_ref: str,
      member_refs: strArr,
      experience_refs: strArr,
      reason: str,
    })),
    balance_note: str,
  }),

  help_blocked: obj({
    tips: strArr,
    helper_refs: strArr,
    helper_reason: str,
  }),
};
