import { useEffect, useRef, useState } from 'react';
import type { HistoryCommit, HistoryDiff, HistoryFile, HistoryFiles } from '@adroit/shared';
import { api, reasonOf } from '../api.js';
import { renderInstant } from '../time.js';

const statusNames: Record<HistoryFile['status'], string> = { A: 'Added', M: 'Edited', D: 'Deleted', T: 'Type changed' };

/** @DecisionRef ui:read-ledger-history — committed history is a separate reading mode. */
export function HistoryPanel({ inRepo }: { inRepo: boolean }) {
  const [revision, setRevision] = useState(0);
  if (!inRepo) return <main className="history-empty">This ledger has no Git history because it is not inside a Git repository.</main>;
  return <HistoryBrowser key={revision} onRefresh={() => setRevision((n) => n + 1)} />;
}

/** @DecisionRef ui:recent-ledger-commits — newest first, with older commits loaded on demand. */
function HistoryBrowser({ onRefresh }: { onRefresh: () => void }) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [selected, setSelected] = useState<HistoryCommit | null>(null);
  const [skip, setSkip] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const head = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.history(skip, head.current ?? undefined).then(
      (page) => {
        if (!live) return;
        head.current = page.head;
        setCommits((all) => skip === 0 ? page.commits : [...all, ...page.commits]);
        setHasMore(page.hasMore);
        if (skip === 0) setSelected(page.commits[0] ?? null);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(reasonOf(e, 'The commit history could not be read.'));
        setLoading(false);
      },
    );
    return () => { live = false; };
  }, [skip, attempt]);

  return (
    <main className="history-panels">
      <nav className="history-column" aria-label="commits">
        <div className="history-heading">
          <h2>Commits</h2>
          <button onClick={onRefresh}>Refresh</button>
        </div>
        <p className="history-caption muted">Changes to this ledger</p>
        <ol className="history-list">
          {commits.map((commit) => (
            <li key={commit.hash}>
              <button className="history-choice commit-choice" aria-current={selected?.hash === commit.hash ? 'true' : undefined} onClick={() => setSelected(commit)}>
                <span className="commit-subject">{commit.subject || '(no commit message)'}</span>
                <span className="commit-meta"><code>{commit.hash.slice(0, 8)}</code><span>{commit.author}</span></span>
                <span className="commit-time muted">{renderInstant(commit.epoch)}</span>
              </button>
            </li>
          ))}
        </ol>
        {loading && <p className="history-message muted" role="status">Reading commits…</p>}
        {error && <HistoryError message={error} retry={() => setAttempt((n) => n + 1)} />}
        {!loading && !error && commits.length === 0 && <p className="history-message muted">No commits have changed this ledger yet.</p>}
        {!loading && !error && hasMore && <button className="history-more" onClick={() => setSkip(commits.length)}>Load older commits</button>}
      </nav>
      {selected ? <CommitFiles key={selected.hash} commit={selected} /> : (
        <>
          <section className="history-column" aria-label="changed files"><div className="history-heading"><h2>Changed files</h2></div><p className="history-message muted">Select a commit to see its files.</p></section>
          <section className="history-detail history-empty" aria-label="file diff">Select a changed file to read its diff.</section>
        </>
      )}
    </main>
  );
}

function HistoryError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="history-message"><p className="refusal" role="alert">{message}</p><button onClick={retry}>Retry</button></div>;
}

/** @DecisionRef ui:commit-changed-files — the selected commit drives the adjacent file list. */
function CommitFiles({ commit }: { commit: HistoryCommit }) {
  const [data, setData] = useState<HistoryFiles | null>(null);
  const [selected, setSelected] = useState<HistoryFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api.historyFiles(commit.hash).then(
      (r) => {
        if (!live) return;
        setData(r);
        setSelected(r.files[0] ?? null);
      },
      (e) => live && setError(reasonOf(e, 'The changed files could not be read.')),
    );
    return () => { live = false; };
  }, [commit.hash, attempt]);
  return (
    <>
      <section className="history-column" aria-label="changed files">
        <div className="history-heading"><h2>Changed files</h2>{data && <span className="muted">{data.files.length}</span>}</div>
        <p className="history-caption muted"><code>{commit.hash.slice(0, 8)}</code></p>
        {error ? <HistoryError message={error} retry={() => setAttempt((n) => n + 1)} /> : !data ? <p className="history-message muted" role="status">Reading changed files…</p> : (
          <>
            {data.files.length === 0 && <p className="history-message muted">No ledger files changed against this commit’s first parent.</p>}
            <ul className="history-list">
              {data.files.map((file) => (
                <li key={file.path}>
                  <button className="history-choice file-choice" aria-current={selected?.path === file.path ? 'true' : undefined} onClick={() => setSelected(file)}>
                    <span className={`file-status status-${file.status}`} title={statusNames[file.status]} aria-label={statusNames[file.status]}>{file.status}</span>
                    <code>{file.path}</code>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {selected && data ? <FileDiff key={selected.path} commit={commit} parent={data.parent} file={selected} /> : (
        <section className="history-detail history-empty" aria-label="file diff">Select a changed file to read its diff.</section>
      )}
    </>
  );
}

/** @DecisionRef ui:selected-file-diff — show the patch with line numbers and addition/deletion marks. */
function FileDiff({ commit, parent, file }: { commit: HistoryCommit; parent: string | null; file: HistoryFile }) {
  const [data, setData] = useState<HistoryDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api.historyDiff(commit.hash, file.path).then(
      (r) => live && setData(r),
      (e) => live && setError(reasonOf(e, 'The file diff could not be read.')),
    );
    return () => { live = false; };
  }, [commit.hash, file.path, attempt]);
  return (
    <section className="history-detail" aria-label="file diff">
      <header className="history-diff-heading">
        <div className="row"><span className={`file-status status-${file.status}`}>{statusNames[file.status]}</span><h2><code>{file.path}</code></h2></div>
        <p>{commit.subject}</p>
        <div className="row muted"><code>{parent?.slice(0, 8) ?? 'empty tree'} → {commit.hash.slice(0, 8)}</code><span>{parent ? 'Compared with first parent' : 'Initial commit'}</span></div>
      </header>
      {error ? <HistoryError message={error} retry={() => setAttempt((n) => n + 1)} /> : !data ? <p className="history-message muted" role="status">Reading diff…</p> : data.patch ? <Patch text={data.patch} /> : <p className="history-message muted">No textual changes in this file.</p>}
    </section>
  );
}

function Patch({ text }: { text: string }) {
  let before = 0;
  let after = 0;
  let inHunk = false;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return (
    <pre className="history-patch" tabIndex={0} aria-label="diff lines">
      {lines.map((line, i) => {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        let oldLine: number | undefined;
        let newLine: number | undefined;
        let kind = 'meta';
        if (hunk) {
          before = Number(hunk[1]);
          after = Number(hunk[2]);
          inHunk = true;
          kind = 'hunk';
        } else if (inHunk) {
          if (line.startsWith('+')) { kind = 'add'; newLine = after++; }
          else if (line.startsWith('-')) { kind = 'delete'; oldLine = before++; }
          else if (line.startsWith(' ')) { kind = 'context'; oldLine = before++; newLine = after++; }
        }
        return <span className={`diff-line diff-${kind}`} key={i}><span className="diff-number" aria-hidden="true">{oldLine}</span><span className="diff-number" aria-hidden="true">{newLine}</span><span className="diff-text">{line}{'\n'}</span></span>;
      })}
    </pre>
  );
}
