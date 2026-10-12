// The thin local server: it owns every ledger read and write, the git operations and the code
// lens (@DecisionRef eng:thin-server-owns-files).
import * as fs from 'node:fs';
import * as path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { applyChange, previewChange, Refusal } from './change.js';
import { GitFacts, repoOf } from './gitfacts.js';
import { openLedger } from './ledger.js';
import { citationsFor } from './lens.js';
import { searchLedger } from './search.js';
import { buildView } from './snapshot.js';

interface AppOptions {
  /** The ledger directory opened at start. */
  ledgerDir: string;
  webDist?: string;
}

export function createApp(opts: AppOptions): Express {
  // @DecisionRef ui:open-any-ledger — the opened ledger is whichever directory the user points
  // the tool at, not only the one this repository holds.
  let ledgerDir = path.resolve(opts.ledgerDir);
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void> | void) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };
  const view = async () => {
    const repo = await repoOf(ledgerDir);
    return buildView(openLedger(ledgerDir), repo ? new GitFacts(repo) : null);
  };

  app.get('/api/ledger', wrap(async (_req, res) => {
    res.json(await view());
  }));

  app.post('/api/open', wrap(async (req, res) => {
    const asked = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
    if (!asked) throw new Refusal('give the path of a ledger directory');
    const dir = path.resolve(asked.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Refusal(`${dir} is not a directory`);
    ledgerDir = dir;
    res.json(await view());
  }));

  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q ?? '');
    res.json({ query: q, hits: searchLedger(await view(), q) });
  }));

  // @DecisionRef ui:change-shows-implications — what a change would make suspect, measured
  // before anything is written, so the user sees it at the moment of change.
  app.post('/api/change/preview', wrap((req, res) => {
    res.json(previewChange(ledgerDir, req.body));
  }));

  app.post('/api/change', wrap(async (req, res) => {
    res.json(await applyChange(ledgerDir, await repoOf(ledgerDir), req.body));
  }));

  app.get('/api/lens', wrap(async (req, res) => {
    const id = String(req.query.id ?? '');
    const repo = await repoOf(ledgerDir);
    if (!repo) throw new Refusal('this ledger is not inside a git repository, so there is no code to read');
    const rec = openLedger(ledgerDir).store.byId.get(id);
    const citations = await citationsFor(new GitFacts(repo), ledgerDir, id, rec?._node ?? null);
    res.json({ id, citations });
  }));

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(opts.webDist!, 'index.html'));
    });
  }

  // @DecisionRef eng:refusal-explains-itself — a user-caused refusal states what was wrong in
  // the user's terms; anything else stays a generic line with no internals.
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
