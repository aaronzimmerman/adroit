// A small LedgerView as the server would send it: an app tree with a severed decision, a
// capability the app root includes, a model with a pending entry, and one finding.
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
    ancestors: [],
    capabilities: [],
    severed: {},
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
    models: root('models', ['models/model.widget.yaml']),
    'product/demo': node(
      'product/demo',
      'product',
      {
        name: 'Demo',
        decisions: [
          { id: 'story:demo', decision: 'A user can demo things.' },
          { id: 'app:works-offline', decision: 'Every surface works with no network.', severable: true },
        ],
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
        name: 'Parent rule',
        decisions: [{ id: 'app:parent-rule', decision: 'Parents rule broadly.', rejected: ['letting children rule — too chaotic'] }],
        context: { why: 'because' },
      },
      {
        ancestors: ['product/demo'],
        capabilities: [{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }],
        dependents: 2,
        contextText: 'why: because\n',
      },
      ['product/demo/parent-rule/online-only'],
    ),
    'product/demo/parent-rule/online-only': node(
      'product/demo/parent-rule/online-only',
      'product/demo/parent-rule',
      {
        name: 'Online only',
        decisions: [{ id: 'app:online-only', decision: 'This corner works online only.' }],
        severed: ['app:works-offline'],
        dubious: '"Parent rule" changed (product/demo/parent-rule)',
      },
      {
        ancestors: ['product/demo', 'product/demo/parent-rule'],
        capabilities: [{ name: 'notify', root: 'capabilities/notify', via: 'product/demo', decisionCount: 2 }],
        severed: { 'app:works-offline': 'product/demo/parent-rule/online-only' },
        dependents: 1,
      },
      ['product/demo/parent-rule/online-only/deep-leaf.yaml'],
    ),
    'product/demo/parent-rule/online-only/deep-leaf.yaml': node(
      'product/demo/parent-rule/online-only/deep-leaf.yaml',
      'product/demo/parent-rule/online-only',
      { name: 'Deep leaf', decisions: [{ id: 'app:deep-leaf', decision: 'Deep leaves live here.' }] },
      { ancestors: ['product/demo', 'product/demo/parent-rule', 'product/demo/parent-rule/online-only'] },
    ),
    'capabilities/notify': node(
      'capabilities/notify',
      'capabilities',
      { name: 'Notify', decisions: [{ id: 'notify:tell-the-user', decision: 'The user is told when something happens.' }] },
      { capability: 'notify', includers: ['product/demo'], dependents: 4 },
    ),
    'models/model.widget.yaml': {
      path: 'models/model.widget.yaml',
      kind: 'model',
      label: 'model:widget',
      parent: 'models',
      children: [],
      uncommitted: false,
      model: {
        id: 'model:widget',
        decision: 'One widget at rest.',
        fields: [
          { name: 'name', deployed: 'scalar (app:parent-rule) — the widget name', cites: ['app:parent-rule'] },
          { name: 'size', deployed: 'scalar — how big', intended: 'scalar — in millimetres', pendingIn: 'model', cites: [] },
        ],
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
    decisions: {
      'story:demo': 'product/demo',
      'app:works-offline': 'product/demo',
      'app:parent-rule': 'product/demo/parent-rule',
      'app:online-only': 'product/demo/parent-rule/online-only',
      'app:deep-leaf': 'product/demo/parent-rule/online-only/deep-leaf.yaml',
      'notify:tell-the-user': 'capabilities/notify',
    },
  };
}
