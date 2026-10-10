import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import YAML from 'yaml';
import { applyChange, Refusal } from '../src/change.js';
import { parseLedger } from '../src/ledger.js';
import { exists, git, makeFixtureRepo, read, rmFixture, write } from './fixture.js';

let repo: string;
beforeEach(() => {
  repo = makeFixtureRepo();
});
afterEach(() => rmFixture(repo));

const edit = (id: string, field: string, value: unknown) =>
  ({ op: 'edit-field', id, field, value }) as never;

describe('applyChange — atomic commit', () => {
  // @DecisionRef ui:edits-cast-suspicion — one decision lands as one atomic commit
  // across every record it touches; source control is the transaction.
  it('lands several operations as one commit across the touched records', async () => {
    const before = git(repo, ['rev-list', '--count', 'HEAD']).trim();
    const outcome = await applyChange(repo, 'ledger', {
      operations: [
        edit('app:parent-rule', 'decision', 'Parents rule broadly and kindly.'),
        edit('app:child-rule', 'decision', 'Children follow the kind rule.'),
      ],
      message: 'soften the parent rule',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.committed).toBe(true);
    const after = git(repo, ['rev-list', '--count', 'HEAD']).trim();
    expect(Number(after)).toBe(Number(before) + 1);
    const shown = git(repo, ['show', '--name-only', '--format=%s', 'HEAD']);
    expect(shown).toContain('soften the parent rule');
    expect(shown).toContain('app.parent-rule/self.yaml');
    expect(shown).toContain('app.child-rule.yaml');
  });

  it('never sweeps unrelated dirty files into the commit', async () => {
    write(repo, 'ledger/engineering/eng.sample-practice.yaml', read(repo, 'ledger/engineering/eng.sample-practice.yaml') + '\n# dirty');
    write(repo, 'unrelated.txt', 'someone else was here');
    // a leaf with no dependents: the commit touches exactly the one record
    await applyChange(repo, 'ledger', {
      operations: [edit('app:deep-leaf', 'decision', 'Changed.')],
    });
    const shown = git(repo, ['show', '--name-only', '--format=', 'HEAD']);
    expect(shown.trim().split('\n')).toEqual([
      'ledger/product/demo/app.parent-rule/app.severed-zone/app.deep-leaf.yaml',
    ]);
    const status = git(repo, ['status', '--porcelain']);
    expect(status).toContain('eng.sample-practice.yaml');
    expect(status).toContain('unrelated.txt');
  });

  // @DecisionRef eng:refusal-writes-nothing — validation precedes the first write; a
  // refused change leaves the working tree exactly as it found it.
  it('a refusal writes nothing, even when earlier operations were valid', async () => {
    const original = read(repo, 'ledger/product/demo/app.parent-rule/self.yaml');
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          edit('app:parent-rule', 'decision', 'Would have been fine.'),
          edit('app:parent-rule', 'id', 'app:renamed-rule'),
        ],
      }),
    ).rejects.toThrow(Refusal);
    expect(read(repo, 'ledger/product/demo/app.parent-rule/self.yaml')).toBe(original);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  it('commits are never gated on the suspect set, which is reported instead', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [edit('app:parent-rule', 'decision', 'Rewritten whole.')],
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.suspects.sort()).toEqual([
      'app:child-rule',
      'app:consumer-rule',
      'app:deep-leaf',
      'app:severed-zone',
    ]);
  });

  it('defaults the commit message from the operations', async () => {
    await applyChange(repo, 'ledger', {
      operations: [edit('app:child-rule', 'decision', 'New text.')],
    });
    expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('edit app:child-rule decision');
  });

  it('commit:false stages the in-flight state without committing', async () => {
    const before = git(repo, ['rev-list', '--count', 'HEAD']).trim();
    const outcome = await applyChange(repo, 'ledger', {
      operations: [edit('app:child-rule', 'decision', 'Working diff only.')],
      commit: false,
    });
    expect(outcome.committed).toBe(false);
    expect(git(repo, ['rev-list', '--count', 'HEAD']).trim()).toBe(before);
    expect(git(repo, ['status', '--porcelain'])).toContain('app.child-rule.yaml');
  });
});

describe('edit-field', () => {
  // @DecisionRef ui:all-but-id-editable — every field but the id.
  it('refuses to edit the id', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [edit('app:parent-rule', 'id', 'app:other-name')],
      }),
    ).rejects.toThrow(/not editable/);
  });

  it('edits rejected, links, context and commitments', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        edit('app:child-rule', 'rejected', ['a loser — it lost']),
        edit('app:child-rule', 'context', { why: 'updated' }),
      ],
    });
    const doc = YAML.parse(read(repo, 'ledger/product/demo/app.parent-rule/app.child-rule.yaml'));
    expect(doc.rejected).toEqual(['a loser — it lost']);
    expect(doc.context.why).toBe('updated');
  });

  it('refuses a result that breaks the record shape', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [edit('app:child-rule', 'links', { refines: 'app:parent-rule' })],
      }),
    ).rejects.toThrow(/refines/);
    await expect(
      applyChange(repo, 'ledger', {
        operations: [edit('app:child-rule', 'decision', '')],
      }),
    ).rejects.toThrow(/decision/);
  });

  // @DecisionRef eng:dependencies-must-resolve — a declared dependency must resolve.
  it('refuses consumes that resolve to nothing', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [edit('app:child-rule', 'links', { consumes: ['ghost-capability'] })],
      }),
    ).rejects.toThrow(/does not resolve/);
  });

  it('refuses a new negation of an unseverable commitment', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          edit('app:child-rule', 'commitments', [{ id: 'privacy-kept', negation: true }]),
        ],
      }),
    ).rejects.toThrow(/unseverable/);
  });

  it('refuses adherence to a commitment not in force', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          edit('eng:sample-practice', 'commitments', [
            { id: 'works-offline', adherence: 'not in force here' },
          ]),
        ],
      }),
    ).rejects.toThrow(/not in force/);
  });
});

describe('create-record', () => {
  it('creates a leaf under a folder record', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'create-record',
          parent: 'app:parent-rule',
          record: {
            id: 'app:fresh-rule',
            decision: 'Fresh things stay fresh.',
            rejected: [],
            links: {},
            context: { why: 'test' },
          },
        } as never,
      ],
    });
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.records.get('app:fresh-rule')!.parent).toBe('app:parent-rule');
  });

  // @DecisionRef adr:hierarchy-is-filesystem — a record with children becomes a folder
  // holding itself and its children.
  it('converts a leaf parent into a folder record', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'create-record',
          parent: 'app:consumer-rule',
          record: {
            id: 'app:consumer-child',
            decision: 'Refines the consumer rule.',
            rejected: [],
            links: {},
            context: {},
          },
        } as never,
      ],
    });
    expect(exists(repo, 'ledger/product/demo/app.consumer-rule/self.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/app.consumer-rule.yaml')).toBe(false);
    expect(
      exists(repo, 'ledger/product/demo/app.consumer-rule/app.consumer-child.yaml'),
    ).toBe(true);
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.records.get('app:consumer-child')!.parent).toBe('app:consumer-rule');
  });

  it('refuses a duplicate id — the path is the claim', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          {
            op: 'create-record',
            parent: 'engineering',
            record: {
              id: 'app:child-rule',
              decision: 'Imposter.',
              rejected: [],
              links: {},
              context: {},
            },
          } as never,
        ],
      }),
    ).rejects.toThrow(/already claimed/);
  });

  it('refuses a record with a field outside the shape', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          {
            op: 'create-record',
            parent: 'engineering',
            record: {
              id: 'eng:status-bearing',
              decision: 'Carries a status.',
              rejected: [],
              links: {},
              context: {},
              status: 'active',
            },
          } as never,
        ],
      }),
    ).rejects.toThrow(/status/);
  });
});

describe('move-record', () => {
  it('re-parents a subtree as a file move', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [{ op: 'move-record', id: 'app:severed-zone', newParent: 'story:demo' } as never],
    });
    expect(exists(repo, 'ledger/product/demo/app.severed-zone/self.yaml')).toBe(true);
    expect(exists(repo, 'ledger/product/demo/app.parent-rule/app.severed-zone')).toBe(false);
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.records.get('app:severed-zone')!.parent).toBe('story:demo');
    expect(ledger.records.get('app:deep-leaf')!.parent).toBe('app:severed-zone');
    // the moved subtree is the suspect set
    expect(outcome.suspects.sort()).toEqual(['app:deep-leaf', 'app:severed-zone']);
  });

  it('refuses a move beneath its own subtree', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          { op: 'move-record', id: 'app:parent-rule', newParent: 'app:deep-leaf' } as never,
        ],
      }),
    ).rejects.toThrow(/own subtree/);
  });

  // @DecisionRef ui:change-the-ledger — extraction: promote the root of a pattern to the
  // capabilities root and relink what consumes it, as one unit of work.
  it('promotes a record to a new capability and relinks consumers in one commit', async () => {
    const outcome = await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'publish-contract',
          name: 'parenting',
          contract: { capability: 'parenting', version: 1, summary: 'Rule broadly.' },
        } as never,
        { op: 'move-record', id: 'app:parent-rule', newParent: 'capabilities/parenting' } as never,
        edit('app:consumer-rule', 'links', { consumes: ['parenting', 'notify'] }),
      ],
      message: 'extract parenting capability',
    });
    expect(outcome.committed).toBe(true);
    expect(exists(repo, 'ledger/capabilities/parenting/contract.yaml')).toBe(true);
    expect(exists(repo, 'ledger/capabilities/parenting/app.parent-rule/self.yaml')).toBe(true);
    const ledger = parseLedger(path.join(repo, 'ledger'));
    expect(ledger.records.get('app:parent-rule')!.root).toBe('capabilities');
    expect(ledger.records.get('app:consumer-rule')!.doc.links.consumes).toContain('parenting');
  });
});

describe('model operations', () => {
  // @DecisionRef adr:models-memorialize-deployed-shape — the deployed statement stays;
  // the ruled divergence is a pending entry beside it.
  it('set-model-field records a pending entry without touching the deployed shape', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'set-model-field',
          model: 'model:widget',
          entry: { field: 'size', op: 'change', intended: 'scalar - size in millimeters', origin: ['app:parent-rule'] },
        } as never,
      ],
    });
    const doc = YAML.parse(read(repo, 'ledger/models/model.widget.yaml'));
    expect(doc.fields.size).toBe('scalar - how big it is');
    expect(doc.pending).toHaveLength(1);
    expect(doc.pending[0]).toMatchObject({
      field: 'size',
      op: 'change',
      current: 'scalar - how big it is',
      intended: 'scalar - size in millimeters',
    });
  });

  it('refuses adding a field that exists or changing one that does not', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          { op: 'set-model-field', model: 'model:widget', entry: { field: 'size', op: 'add', intended: 'x' } } as never,
        ],
      }),
    ).rejects.toThrow(/already exists/);
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          { op: 'set-model-field', model: 'model:widget', entry: { field: 'ghost', op: 'change', intended: 'x' } } as never,
        ],
      }),
    ).rejects.toThrow(/does not exist/);
  });

  // @DecisionRef eng:changes-are-projectable — begin-migration gathers named pending
  // entries into a model:change under models/pending-changes.
  it('begin-migration files the change and moves the gathered entries out of the model', async () => {
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'set-model-field',
          model: 'model:widget',
          entry: { field: 'color', op: 'add', intended: 'scalar - the color' },
        } as never,
        {
          op: 'begin-migration',
          model: 'model:widget',
          name: 'widget-color',
          fields: ['color'],
          origin: ['app:parent-rule'],
        } as never,
      ],
    });
    const change = YAML.parse(read(repo, 'ledger/models/pending-changes/widget-color.yaml'));
    expect(change.name).toBe('widget-color');
    expect(change.model).toBe('model:widget');
    expect(change.state).toBe('in-flight');
    expect(change.operations[0].field).toBe('color');
    const model = YAML.parse(read(repo, 'ledger/models/model.widget.yaml'));
    expect(model.pending ?? []).toHaveLength(0);
  });

  it('refuses gathering a field with no pending entry', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          { op: 'begin-migration', model: 'model:widget', name: 'nothing-pending', fields: ['size'], origin: [] } as never,
        ],
      }),
    ).rejects.toThrow(/no pending entry/);
  });
});

describe('land-migration', () => {
  const pendAndBegin = (name: string) => ({
    operations: [
      {
        op: 'set-model-field',
        model: 'model:widget',
        entry: { field: 'size', op: 'change', intended: 'scalar - size in millimeters', origin: ['app:parent-rule'] },
      },
      {
        op: 'set-model-field',
        model: 'model:widget',
        entry: { field: 'color', op: 'add', intended: 'scalar - the color' },
      },
      { op: 'begin-migration', model: 'model:widget', name, fields: ['size', 'color'], origin: ['app:parent-rule'] },
    ] as never[],
  });

  // @DecisionRef adr:models-memorialize-deployed-shape — the model updates only when the
  // migration lands: in one act the deployed shape takes the intended shape, the pending
  // entries go and the model:change file is deleted.
  it('lands a migration in flight as one commit', async () => {
    await applyChange(repo, 'ledger', pendAndBegin('widget-mm'));
    const before = Number(git(repo, ['rev-list', '--count', 'HEAD']).trim());
    const outcome = await applyChange(repo, 'ledger', {
      operations: [{ op: 'land-migration', name: 'widget-mm' } as never],
    });
    expect(outcome.committed).toBe(true);
    expect(Number(git(repo, ['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1);
    const model = YAML.parse(read(repo, 'ledger/models/model.widget.yaml'));
    expect(model.fields.size).toBe('scalar - size in millimeters');
    expect(model.fields.color).toBe('scalar - the color');
    expect(model.fields.name).toContain('widget name');
    expect(model.pending).toBeUndefined();
    expect(exists(repo, 'ledger/models/pending-changes/widget-mm.yaml')).toBe(false);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
    expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('land migration widget-mm');
  });

  it('landing removes identical entries still pending on the model file', async () => {
    await applyChange(repo, 'ledger', pendAndBegin('widget-mm'));
    const modelPath = 'ledger/models/model.widget.yaml';
    const doc = YAML.parse(read(repo, modelPath));
    doc.pending = [
      { field: 'color', op: 'add', intended: 'scalar - the color' },
      { field: 'name', op: 'change', intended: 'scalar - a later ruling', current: doc.fields.name },
    ];
    write(repo, modelPath, YAML.stringify(doc));
    git(repo, ['commit', '-qam', 'pending entries on the file']);
    await applyChange(repo, 'ledger', {
      operations: [{ op: 'land-migration', name: 'widget-mm' } as never],
    });
    const after = YAML.parse(read(repo, modelPath));
    expect(after.pending.map((p: { field: string }) => p.field)).toEqual(['name']);
  });

  // @DecisionRef eng:refusal-writes-nothing — a refused landing changes nothing.
  it('a refused landing changes nothing', async () => {
    await applyChange(repo, 'ledger', pendAndBegin('widget-mm'));
    const modelPath = 'ledger/models/model.widget.yaml';
    const doc = YAML.parse(read(repo, modelPath));
    doc.fields.size = 'scalar - redefined behind the migration';
    write(repo, modelPath, YAML.stringify(doc));
    git(repo, ['commit', '-qam', 'deployed shape moved']);
    const modelBefore = read(repo, modelPath);
    await expect(
      applyChange(repo, 'ledger', { operations: [{ op: 'land-migration', name: 'widget-mm' } as never] }),
    ).rejects.toThrow(/changed since migration "widget-mm" began/);
    expect(read(repo, modelPath)).toBe(modelBefore);
    expect(exists(repo, 'ledger/models/pending-changes/widget-mm.yaml')).toBe(true);
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');
  });

  it('refuses a migration that is not in flight', async () => {
    await expect(
      applyChange(repo, 'ledger', { operations: [{ op: 'land-migration', name: 'ghost' } as never] }),
    ).rejects.toThrow(/no migration named "ghost"/);
  });
});

describe('publish-contract', () => {
  // @DecisionRef adr:capability-contract-artifact — versioned, changed as a unit.
  it('requires a version bump to republish', async () => {
    await expect(
      applyChange(repo, 'ledger', {
        operations: [
          {
            op: 'publish-contract',
            name: 'notify',
            contract: { capability: 'notify', version: 1, summary: 'same version' },
          } as never,
        ],
      }),
    ).rejects.toThrow(/version bump/);
    await applyChange(repo, 'ledger', {
      operations: [
        {
          op: 'publish-contract',
          name: 'notify',
          contract: { capability: 'notify', version: 2, summary: 'bumped' },
        } as never,
      ],
    });
    const doc = YAML.parse(read(repo, 'ledger/capabilities/notify/contract.yaml'));
    expect(doc.version).toBe(2);
  });
});
