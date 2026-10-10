import type { DerivedRecord, LedgerSnapshot } from '@adroit/shared';

function rec(partial: Partial<DerivedRecord> & { id: string }): DerivedRecord {
  return {
    path: `${partial.id.replace(':', '.')}.yaml`,
    root: 'product',
    treeName: 'demo',
    children: [],
    depth: 0,
    doc: {
      id: partial.id,
      decision: `Rule of ${partial.id}.`,
      rejected: [],
      links: {},
      context: {},
    },
    consumers: [],
    subtreeSize: 1,
    effectiveCommitments: [],
    negations: [],
    interactionCount: 0,
    ...partial,
  };
}

export function makeSnapshot(): LedgerSnapshot {
  const records: Record<string, DerivedRecord> = {};
  const add = (r: DerivedRecord) => (records[r.id] = r);

  add(
    rec({
      id: 'story:demo',
      children: ['app:parent-rule', 'app:consumer-rule'],
      subtreeSize: 6,
      doc: {
        id: 'story:demo',
        decision: 'A user can demo things.',
        rejected: [],
        links: { consumes: ['notify'] },
        context: {},
        commitments: [
          { id: 'works-offline', description: 'every surface works with no network' },
        ],
      },
      effectiveCommitments: [
        { id: 'works-offline', description: 'every surface works with no network', severable: true, declaredBy: 'story:demo' },
        { id: 'quiet-hours', description: 'nothing fires at night', severable: true, declaredBy: 'capability:notify' },
      ],
    }),
  );
  add(
    rec({
      id: 'app:parent-rule',
      parent: 'story:demo',
      depth: 1,
      children: ['app:child-rule', 'app:severed-zone'],
      subtreeSize: 4,
      consumers: ['app:consumer-rule'],
      doc: {
        id: 'app:parent-rule',
        decision: 'Parents rule broadly.',
        rejected: ['letting children rule — too chaotic'],
        links: {},
        context: { why: 'because' },
      },
      effectiveCommitments: [
        { id: 'works-offline', description: 'every surface works with no network', severable: true, declaredBy: 'story:demo' },
      ],
    }),
  );
  add(
    rec({
      id: 'app:child-rule',
      parent: 'app:parent-rule',
      depth: 2,
      subtreeSize: 1,
      doc: {
        id: 'app:child-rule',
        decision: 'Children follow the parent rule.',
        rejected: [],
        links: { consumes: ['model:widget'], grounds: ['principle:single-resolver'] },
        context: {},
        dubious: 'app:parent-rule was edited (decision) and this record depends on it',
      },
      effectiveCommitments: [
        {
          id: 'works-offline',
          description: 'every surface works with no network',
          severable: true,
          declaredBy: 'story:demo',
          adherence: 'caches the demo list locally',
        },
      ],
    }),
  );
  add(
    rec({
      id: 'app:severed-zone',
      parent: 'app:parent-rule',
      depth: 2,
      subtreeSize: 2,
      children: ['app:deep-leaf'],
      negations: ['works-offline'],
      doc: {
        id: 'app:severed-zone',
        decision: 'This corner works online only.',
        rejected: [],
        links: {},
        context: {},
        commitments: [{ id: 'works-offline', negation: true }],
      },
    }),
  );
  add(
    rec({
      id: 'app:deep-leaf',
      parent: 'app:severed-zone',
      depth: 3,
      subtreeSize: 1,
      doc: {
        id: 'app:deep-leaf',
        decision: 'Deep leaves live beneath the severed zone.',
        rejected: [],
        links: { tension: ['principle:single-resolver'] },
        context: { why: 'two places hold the leaf rule on purpose' },
      },
      effectiveCommitments: [],
    }),
  );
  add(
    rec({
      id: 'app:consumer-rule',
      parent: 'story:demo',
      depth: 1,
      subtreeSize: 1,
      doc: {
        id: 'app:consumer-rule',
        decision: 'Consumers depend on the parent rule.',
        rejected: [],
        links: { consumes: ['app:parent-rule'] },
        context: {},
      },
    }),
  );
  add(
    rec({
      id: 'eng:sample-practice',
      root: 'engineering',
      treeName: undefined,
      subtreeSize: 2,
      children: ['eng:sample-child'],
      doc: {
        id: 'eng:sample-practice',
        decision: 'Do things the sample way.',
        rejected: [],
        links: {},
        context: {},
      },
    }),
  );
  add(
    rec({
      id: 'eng:sample-child',
      root: 'engineering',
      treeName: undefined,
      parent: 'eng:sample-practice',
      depth: 1,
      doc: {
        id: 'eng:sample-child',
        decision: 'Refine the sample way.',
        rejected: [],
        links: {},
        context: {},
      },
    }),
  );
  add(
    rec({
      id: 'principle:single-resolver',
      root: 'engineering',
      treeName: undefined,
      doc: {
        id: 'principle:single-resolver',
        decision: 'One rule, one place.',
        rejected: [],
        links: {},
        context: {},
      },
    }),
  );

  return {
    corpus: 'fixture',
    domains: { app: 'the demo product', eng: 'engineering practice' },
    productTrees: [{ name: 'demo', rootId: 'story:demo' }],
    records,
    models: [
      {
        id: 'model:widget',
        path: 'models/model.widget.yaml',
        doc: {
          id: 'model:widget',
          summary: 'One widget at rest.',
          fields: {
            name: 'scalar — the widget name (app:parent-rule)',
            size: 'scalar — how big it is',
          },
          pending: [
            {
              field: 'size',
              op: 'change',
              current: 'scalar — how big it is',
              intended: 'scalar — size in millimeters',
            },
          ],
        },
        projectedFields: {
          name: 'scalar — the widget name (app:parent-rule)',
          size: 'scalar — size in millimeters',
        },
        consumers: ['app:child-rule'],
        fieldLinks: { name: ['app:parent-rule'], size: [] },
        orphanFields: ['size'],
        danglingCitations: [],
      },
    ],
    changes: [
      {
        path: 'models/pending-changes/widget-name.yaml',
        doc: {
          name: 'widget-name',
          model: 'model:widget',
          origin: ['app:parent-rule'],
          operations: [
            {
              field: 'name',
              op: 'change',
              current: 'scalar — the widget name (app:parent-rule)',
              intended: 'scalar — the widget display name',
            },
          ],
          state: 'in-flight',
        },
      },
    ],
    capabilities: [
      {
        name: 'notify',
        contractPath: 'capabilities/notify/contract.yaml',
        contract: {
          capability: 'notify',
          version: 1,
          summary: 'Tell the user something happened.',
          operations: { send: 'one message to the user' },
          commitments: [{ id: 'quiet-hours', description: 'nothing fires at night' }],
        },
        adherents: ['story:demo'],
        records: [],
      },
    ],
    skew: [
      {
        id: 'app:parent-rule',
        kind: 'concentration',
        child: 'app:child-rule',
        share: 0.9,
        note: '90% of the decisions hang beneath app:child-rule',
      },
    ],
    incoherences: [],
    workingDiff: [],
    gaps: [
      { ids: ['app:deep-leaf'], kind: 'gap', note: 'no record says how deep leaves sort', where: 'map' },
    ],
    interactionsSkipped: 1,
  };
}
