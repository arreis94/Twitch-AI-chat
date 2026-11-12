import { useState } from 'react';
import { api } from '../api';
import type { Persona } from '../types';

interface Props {
  personas: Persona[];
  aiConfigured: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}

type Draft = Omit<Persona, 'id'>;

const emptyDraft: Draft = {
  name: '',
  personality: '',
  interests: [],
  favoriteEmotes: ['Kappa', 'LUL'],
  chattiness: 2,
  verbosity: 'short',
  language: 'English',
};

export default function PersonaPanel({ personas, aiConfigured, onChanged, onError }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null); // null = closed, '' = new
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewContext, setPreviewContext] = useState('Streamer just started playing a new game');

  const openNew = () => {
    setDraft(emptyDraft);
    setEditingId('');
  };
  const openEdit = (p: Persona) => {
    const { id, ...rest } = p;
    setDraft(rest);
    setEditingId(id);
  };

  const save = () => {
    if (!draft.name || !draft.personality) {
      onError('Persona needs a name and personality');
      return;
    }
    const op = editingId ? api.updatePersona(editingId, draft) : api.createPersona(draft);
    op.then(() => {
        setEditingId(null);
        onChanged();
      })
      .catch((e: Error) => onError(e.message));
  };

  const preview = (p: Persona) => {
    setPreviews((prev) => ({ ...prev, [p.id]: '…thinking…' }));
    api.previewPersona(p.id, previewContext)
      .then((r) => setPreviews((prev) => ({ ...prev, [p.id]: `${r.text}  (${(r.latencyMs / 1000).toFixed(1)}s)` })))
      .catch((e: Error) => {
        setPreviews((prev) => ({ ...prev, [p.id]: '' }));
        onError(e.message);
      });
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Personas</h2>
        <button onClick={openNew}>+ New persona</button>
      </div>
      {!aiConfigured && <p className="hint warn-text">Azure AI not configured — personas can be edited but not generate.</p>}

      {personas.length === 0 && <p className="empty">No personas yet.</p>}
      <ul className="persona-list">
        {personas.map((p) => (
          <li key={p.id}>
            <div className="persona-row">
              <strong>{p.name}</strong>
              <span className="muted">{p.chattiness}/min · {p.verbosity}</span>
              <button onClick={() => openEdit(p)}>Edit</button>
              <button disabled={!aiConfigured} onClick={() => preview(p)}>Preview</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Delete persona ${p.name}?`)) {
                    api.deletePersona(p.id).then(onChanged).catch((e: Error) => onError(e.message));
                  }
                }}
              >
                ✕
              </button>
            </div>
            <div className="persona-desc muted">{p.personality}</div>
            {previews[p.id] && <div className="preview-bubble">{previews[p.id]}</div>}
          </li>
        ))}
      </ul>

      {personas.length > 0 && (
        <label className="field">
          Preview context
          <input value={previewContext} onChange={(e) => setPreviewContext(e.target.value)} />
        </label>
      )}

      {editingId !== null && (
        <div className="editor">
          <h3>{editingId ? 'Edit persona' : 'New persona'}</h3>
          <label className="field">
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="field">
            Personality
            <textarea
              rows={3}
              placeholder="e.g. sarcastic lurker who loves speedruns and roasts the streamer's deaths (kindly)"
              value={draft.personality}
              onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
            />
          </label>
          <label className="field">
            Interests (comma separated)
            <input
              value={draft.interests.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, interests: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
            />
          </label>
          <label className="field">
            Favorite emotes (comma separated)
            <input
              value={draft.favoriteEmotes.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, favoriteEmotes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
            />
          </label>
          <div className="field-row">
            <label className="field">
              Chattiness (msgs/min)
              <input
                type="number"
                min={0.2}
                max={20}
                step={0.2}
                value={draft.chattiness}
                onChange={(e) => setDraft({ ...draft, chattiness: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Verbosity
              <select
                value={draft.verbosity}
                onChange={(e) => setDraft({ ...draft, verbosity: e.target.value as Draft['verbosity'] })}
              >
                <option value="short">short</option>
                <option value="medium">medium</option>
              </select>
            </label>
            <label className="field">
              Language
              <input value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} />
            </label>
          </div>
          <div className="editor-actions">
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
