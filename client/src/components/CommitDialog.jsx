import React, { useState, useEffect, useRef } from 'react';

const ipcRenderer = window.electron?.ipcRenderer;

export default function CommitDialog({ cwd, sessionId, onRunBackground, onClose, onDone }) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);
  const [showAiTooltip, setShowAiTooltip] = useState(false);
  const [unpushedCommits, setUnpushedCommits] = useState([]);
  const inputRef = useRef(null);
  const hasGeminiToken = !!window.electron?.ipcRenderer?.sendSync('settings.get')?.geminiToken;

  useEffect(() => {
    ipcRenderer.invoke('terminal.getChangedFiles', { cwd }).then(result => {
      const list = (result || []).map(f => f.file);
      setFiles(list);
      setSelected(new Set(list));
      setLoadingFiles(false);

      // If no changed files, check for unpushed commits
      if (list.length === 0) {
        ipcRenderer.invoke('terminal.getUnpushedCommits', { cwd }).then(commits => {
          setUnpushedCommits(commits);
        });
      } else if (hasGeminiToken && list.length > 0) {
        handleGenerateAI(list);
      } else {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });
  }, [cwd]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);


  const toggleFile = (f) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const runBackgroundCommand = (command) => {
    onRunBackground(command).catch(err => {
      console.error('Background action error:', err);
    });
    onClose();
  };

  const handleGenerateAI = async (filesOverride) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const filesToUse = filesOverride ?? [...selected];
      const result = await ipcRenderer.invoke('terminal.generateCommitMessage', { cwd, files: filesToUse });
      if (result.message) setMessage(result.message);
      if (result.error) { setAiError(result.error); }
      else { inputRef.current?.focus(); }
    } catch (err) {
      setAiError(err.message || 'Failed to generate commit message');
    } finally {
      setAiLoading(false);
    }
  };

  const handleCommit = async (push = false, pullFirst = false) => {
    if (selected.size === 0) return;

    if (!message.trim()) {
      if (aiLoading) {
        // Queue at main process level so it persists after dialog closes
        await ipcRenderer.invoke('terminal.queueGitAction', { cwd, files: [...selected], push, pullFirst });
        onClose();
      }
      return;
    }

    const commitMsg = message.trim().replace(/"/g, '\\"');
    const fileArgs = [...selected].map(f => `"${f}"`).join(' ');

    let command = `git add ${fileArgs} && git commit -m "${commitMsg}"`;
    if (push) {
      command += ' && git pull && git push';
    } else if (pullFirst) {
      command = `git pull && ${command}`;
    }

    runBackgroundCommand(command);
  };

  const handlePushBackground = async () => {
    runBackgroundCommand('git pull && git push');
  };

  const handleCommitAndPushBackground = async () => {
    if (selected.size === 0) return;

    if (!message.trim()) {
      if (aiLoading) {
        // Queue at main process level so it persists after dialog closes
        await ipcRenderer.invoke('terminal.queueGitAction', { cwd, files: [...selected], push: true, pullFirst: false });
        onClose();
      }
      return;
    }

    const commitMsg = message.trim().replace(/"/g, '\\"');
    const fileArgs = [...selected].map(f => `"${f}"`).join(' ');
    const command = `git add ${fileArgs} && git commit -m "${commitMsg}" && git pull && git push`;

    runBackgroundCommand(command);
  };

  const handlePullBackground = async () => {
    runBackgroundCommand('git pull');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '40vh', backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #333333', borderRadius: '8px', width: '700px', maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', color: '#e2e8f0' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Commit Changes</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Files or Unpushed Commits */}
        {files.length > 0 ? (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a2a', overflowY: 'auto', maxHeight: '200px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
              {loadingFiles ? 'Loading files…' : `Files (${selected.size}/${files.length} selected)`}
            </div>
            {files.map(f => (
              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace' }}>
                <input type="checkbox" checked={selected.has(f)} onChange={() => toggleFile(f)} style={{ accentColor: '#38bdf8', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>{f}</span>
              </label>
            ))}
          </div>
        ) : unpushedCommits.length > 0 ? (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a2a', overflowY: 'auto', maxHeight: '250px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px', fontWeight: 600 }}>
              📤 Unpushed commits ({unpushedCommits.length})
            </div>
            {unpushedCommits.map((commit, idx) => (
              <div key={commit.hash} style={{ padding: '6px 10px', marginBottom: idx < unpushedCommits.length - 1 ? '6px' : '0', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '4px', fontSize: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <code style={{ color: '#38bdf8', fontSize: '11px', fontFamily: 'monospace', fontWeight: 600, flexShrink: 0 }}>{commit.hash.slice(0, 7)}</code>
                <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={commit.message}>{commit.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a2a', color: '#64748b', fontSize: '12px' }}>
            {loadingFiles ? 'Loading…' : 'No changes to commit'}
          </div>
        )}

        {/* Message - only show if there are files to commit */}
        {files.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Commit message ({message.length})</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={aiLoading ? 'Generating…' : 'Enter commit message'}
              style={{ flex: 1, background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#f1f5f9', fontFamily: 'monospace', fontSize: '13px', padding: '7px 10px', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = '#38bdf8'}
              onBlur={e => e.target.style.borderColor = '#3a3a3a'}
              onKeyDown={e => { if (e.key === 'Enter') handleCommit(false); }}
            />
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => handleGenerateAI()}
                disabled={aiLoading || committing}
                onMouseEnter={() => (!hasGeminiToken || aiError) && setShowAiTooltip(true)}
                onMouseLeave={() => setShowAiTooltip(false)}
                style={{ background: aiError ? 'rgba(239,68,68,0.08)' : aiLoading ? 'rgba(56,189,248,0.15)' : 'rgba(56,189,248,0.08)', border: `1px solid ${aiError ? 'rgba(239,68,68,0.4)' : 'rgba(56,189,248,0.3)'}`, borderRadius: '4px', color: aiError ? '#f87171' : '#38bdf8', padding: '7px 10px', fontSize: '12px', cursor: aiLoading || aiError ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: aiError ? 0.7 : 1 }}
              >
                {aiLoading ? '✦ …' : aiError ? '✦ Error' : '✦ AI'}
              </button>
              {showAiTooltip && (aiError || !hasGeminiToken) && (
                <div style={{ position: 'absolute', bottom: '110%', right: 0, background: '#2a2a2a', border: '1px solid #f87171', borderRadius: '4px', padding: '6px 10px', fontSize: '11px', color: '#f87171', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', maxWidth: '260px', whiteSpace: 'normal' }}>
                  {aiError || 'Gemini API key not set in Settings'}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Error */}
        {/* Error */}
        {error && (
          <div style={{ margin: '8px 20px 0', padding: '8px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#f87171', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            {error.includes('Remote has updates') && (
              <button
                onClick={handlePushBackground}
                disabled={committing}
                style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171', borderRadius: '3px', fontSize: '11px', cursor: committing ? 'default' : 'pointer', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: '12px' }}
              >
                {committing ? 'Pulling…' : 'Pull & Push'}
              </button>
            )}
          </div>
        )}

        {/* Buttons */}
        <div style={{ padding: '12px 20px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={committing} style={{ padding: '6px 14px', background: 'none', border: '1px solid #3a3a3a', color: '#94a3b8', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          {(files.length > 0 || loadingFiles) ? (
            <>
              {files.length > 0 && (
                <>
                  <button
                    onClick={() => handleCommit(false)}
                    disabled={committing || selected.size === 0}
                    style={{ padding: '6px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: committing || selected.size === 0 ? 0.5 : 1 }}
                  >
                    {committing ? 'Committing…' : 'Commit'}
                  </button>
                  <button
                    onClick={handleCommitAndPushBackground}
                    disabled={committing || selected.size === 0}
                    style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: committing || selected.size === 0 ? 0.5 : 1 }}
                  >
                    Commit & Push
                  </button>
                </>
              )}
            </>
          ) : unpushedCommits.length > 0 ? (
            <button
              onClick={() => handlePushBackground(false)}
              disabled={committing}
              style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: committing ? 'default' : 'pointer', opacity: committing ? 0.5 : 1 }}
            >
              Push
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
