// The thin local server: it owns every ledger read and write, the git operations and the
// code lens; the browser is a pure view (@DecisionRef eng:thin-server-owns-files).
import * as fs from 'node:fs';
import * as path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { applyChange, Refusal } from './change.js';
import { dependentsOf, fieldsCiting, subtreeIds } from './derive.js';
import { GitFacts } from './gitfacts.js';
import { parseLedger } from './ledger.js';
import { citationsFor } from './lens.js';
import { searchLedger } from './search.js';
import { buildSnapshot, type SnapshotOptions } from './snapshot.js';

interface AppOptions {
  repoRoot: string;
  ledgerDirName?: string;
  /** Repo-relative directories the code lens reads. */
  codeDirs?: string[];
  webDist?: string;
  snapshot?: SnapshotOptions;
}

export function createApp(opts: AppOptions): Express {
  const repoRoot = opts.repoRoot;
  const ledgerDirName = opts.ledgerDirName ?? 'ledger';
  const codeDirs = opts.codeDirs ?? ['app'];
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void> | void) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };

  app.get(
    '/api/ledger',
    wrap(async (_req, res) => {
      res.json(await buildSnapshot(repoRoot, ledgerDirName, opts.snapshot ?? {}));
    }),
  );

  app.get(
    '/api/search',
    wrap((req, res) => {
      const q = String(req.query.q ?? '');
      const ledger = parseLedger(path.join(repoRoot, ledgerDirName));
      res.json({ query: q, hits: searchLedger(ledger, q) });
    }),
  );

  // @DecisionRef ui:change-shows-implications — the dependents of a change, measured
  // from the graph, served so the UI can put them in front of the user at the moment
  // of change.
  app.get(
    '/api/impact',
    wrap((req, res) => {
      const id = String(req.query.id ?? '');
      const ledger = parseLedger(path.join(repoRoot, ledgerDirName));
      if (!ledger.records.has(id)) throw new Refusal(`record "${id}" does not exist`);
      const descendants = subtreeIds(ledger, id).filter((x) => x !== id);
      const dependents = dependentsOf(ledger, id);
      const consumers = dependents.filter((d) => !descendants.includes(d));
      // A move's suspects are the moved subtree itself (ui:edits-cast-suspicion).
      const moved = subtreeIds(ledger, id);
      // The model fields citing this ruling: its migration surface (adr:fields-link-their-rulings).
      const modelFields = fieldsCiting(ledger, id);
      res.json({ id, descendants, consumers, dependents, moved, modelFields });
    }),
  );

  app.post(
    '/api/change',
    wrap(async (req, res) => {
      const outcome = await applyChange(repoRoot, ledgerDirName, req.body);
      res.json(outcome);
    }),
  );

  app.get(
    '/api/lens/citations',
    wrap(async (req, res) => {
      const id = String(req.query.id ?? '');
      const git = new GitFacts(repoRoot);
      const ledger = parseLedger(path.join(repoRoot, ledgerDirName));
      const rec = ledger.records.get(id);
      const decisionChangedAt = rec
        ? await git.lastDecisionChange(path.posix.join(ledgerDirName, rec.path))
        : 0;
      const citations = await citationsFor(repoRoot, codeDirs, id, git, decisionChangedAt);
      res.json({ id, citations, axis: 'textual @DecisionRef bindings in the built code' });
    }),
  );

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(opts.webDist!, 'index.html'));
    });
  }

  // @DecisionRef eng:refusal-explains-itself — a user-caused refusal states what was
  // wrong in the user's terms; anything else stays a generic line with no internals.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof Refusal) {
      res.status(422).json({ ok: false, refusal: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ ok: false, refusal: 'something went wrong on the server' });
  });

  return app;
}
