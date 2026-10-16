// A small LedgerView as the server would send it: an app tree, a capability the app root
// includes, a view with typed fields, and one finding.
import type { LedgerView, NodeDoc, NodeView, Place } from '@adroit/shared';

const node = (
  path: string,
  parent: string,
  doc: NodeDoc,
  extra: Partial<NodeView> = {},
  children: string[] = [],
): Place => ({
  path,
  kind: 'node',
  label: doc.name,
  parent,
  children,
  uncommitted: false,
  node: {
    rel: path.endsWith('.yaml') ? path : `${path}/self.yaml`,
    tree: path.split('/').slice(0, 2).join('/'),
    doc,
    views: doc.references ?? [],
    ancestors: [],
    capabilities: [],
    dependents: 0,
    contextText: '',
    ...extra,
  },
});

const root = (path: string, children: string[]): Place => ({ path, kind: 'root', label: path, parent: '', children, uncommitted: false });

export function makeView(): LedgerView {
  const places: Record<string, Place> = {
    '': { path: '', kind: 'root', label: 'ledger', parent: null, children: ['product', 'capabilities', 'engineering', 'models'], uncommitted: false },
    product: root('product', ['product/demo']),
    capabilities: root('capabilities', ['capabilities/notify']),
    engineering: root('engineering', []),
    models: root('models', ['models/widget.yaml']),
    'product/demo': node(
      'product/demo',
      'product',
      {
        id: 'story:demo',
        name: 'Demo',
        decision: 'A user can demo things.',
        includes: ['notify'],
        questions: ['Does the demo need accounts?'],
      },
      { capabilities: [{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }], dependents: 3 },
      ['product/demo/parent-rule'],
    ),
    'product/demo/parent-rule': node(
      'product/demo/parent-rule',
      'product/demo',
      {
        id: 'app:parent-rule',
        name: 'Parent rule',
        decision: 'Parents rule broadly.',
        rejected: ['letting children rule — too chaotic'],
        references: ['view:widget'],
        context: 'because parents know',
      },
      {
        ancestors: ['product/demo'],
        capabilities: [{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }],
        views: ['view:widget', 'view:part'],
        dependents: 2,
        contextText: 'because parents know',
      },
      ['product/demo/parent-rule/online-only'],
    ),
    'product/demo/parent-rule/online-only': node(
      'product/demo/parent-rule/online-only',
      'product/demo/parent-rule',
      {
        id: 'app:online-only',
        name: 'Online only',
        decision: 'This corner works online only.',
        dubious: '"Parent rule" changed (product/demo/parent-rule)',
      },
      {
        ancestors: ['product/demo', 'product/demo/parent-rule'],
        capabilities: [{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }],
        dependents: 1,
      },
      ['product/demo/parent-rule/online-only/deep-leaf.yaml'],
    ),
    'product/demo/parent-rule/online-only/deep-leaf.yaml': node(
      'product/demo/parent-rule/online-only/deep-leaf.yaml',
      'product/demo/parent-rule/online-only',
      { id: 'app:deep-leaf', name: 'Deep leaf', decision: 'Deep leaves live here.' },
      { ancestors: ['product/demo', 'product/demo/parent-rule', 'product/demo/parent-rule/online-only'] },
    ),
    'capabilities/notify': node(
      'capabilities/notify',
      'capabilities',
      { id: 'notify:tell-the-user', name: 'Notify', decision: 'The user is told when something happens.' },
      { capability: 'notify', includers: ['product/demo'], dependents: 4 },
    ),
    'models/widget.yaml': {
      path: 'models/widget.yaml',
      kind: 'view',
      label: 'view:widget',
      parent: 'models',
      children: [],
      uncommitted: false,
      view: {
        id: 'view:widget',
        decision: 'One widget, as the demo shows it.',
        rejected: [],
        fields: [
          { name: 'name', type: 'string', cites: ['app:parent-rule'], meaning: 'the widget name', raw: 'string (app:parent-rule) — the widget name' },
          { name: 'size', type: 'int', cites: [], meaning: 'how big it is', raw: 'int — how big it is' },
        ],
        consumes: ['view:part'],
        grounds: ['principle:derive-dont-materialize'],
      },
    },
  };
  return {
    dir: '/tmp/fixture/ledger',
    corpus: 'fixture',
    domains: { app: 'The demo app.' },
    repo: '/tmp/fixture',
    places,
    roots: places[''].children,
    findings: [
      { place: 'product/demo/parent-rule', subject: 'app:parent-rule', rule: 'id-in-decision-text', message: "decision names 'app:x'", severity: 'error' },
    ],
    ids: {
      'story:demo': 'product/demo',
      'app:parent-rule': 'product/demo/parent-rule',
      'app:online-only': 'product/demo/parent-rule/online-only',
      'app:deep-leaf': 'product/demo/parent-rule/online-only/deep-leaf.yaml',
      'notify:tell-the-user': 'capabilities/notify',
      'view:widget': 'models/widget.yaml',
    },
  };
}
