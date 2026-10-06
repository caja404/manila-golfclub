import { useEffect, useState } from 'react';
import { MemberSearch, useAction } from '../components/ui.tsx';
import { PhotoCapture } from '../components/PhotoCapture.tsx';
import { api } from '../lib/api.ts';
import { clock, shortDate } from '../lib/format.ts';
import { useLive } from '../lib/live.tsx';
import type { Member, PhotoKind, StorageItem, StoragePhoto } from '../../shared/types.ts';

const KIND_LABEL: Record<PhotoKind, string> = {
  deposit: 'Deposited',
  return: 'Back from a round',
  check: 'Condition check',
};

const photoUrl = (id: number) => `/api/photos/${id}`;

/** Low-level bag storage register with photo proof. The planned equipment-tracking system will feed this same list. */
export function StorageTab() {
  const { snap } = useLive();
  const { run, busy } = useAction();
  const [items, setItems] = useState<StorageItem[]>([]);
  const [filter, setFilter] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [tag, setTag] = useState('');
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<StorageItem | null>(null);

  // Reload whenever the board changes (bags go out and come back with sessions, photos are added).
  useEffect(() => {
    api.get<StorageItem[]>('/storage').then(setItems);
  }, [snap]);

  const f = filter.trim().toLowerCase();
  const shown = items.filter(
    (i) => !f || i.tag.toLowerCase().includes(f) || i.memberName.toLowerCase().includes(f) || i.memberNo.startsWith(f),
  );
  const outCount = items.filter((i) => i.status === 'out').length;
  const noPhoto = items.filter((i) => !i.photoId).length;

  return (
    <div className="storage">
      <section className="section">
        <div className="section-head">
          <h2>Bags in storage</h2>
          <span className="count num">{items.length}</span>
          <span className="aside">
            {outCount} out on course · {noPhoto} without a photo
          </span>
        </div>
        <input
          id="storage-filter"
          className="input"
          placeholder="Filter by tag, member name or number"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="table-wrap panel">
          <table className="data">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Tag</th>
                <th>Member</th>
                <th>Bag</th>
                <th>Where</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td className="photo-cell">
                    {i.photoId ? (
                      <button className="thumb" onClick={() => setViewing(i)} aria-label={`Photos of ${i.tag}`}>
                        <img src={photoUrl(i.photoId)} alt="" loading="lazy" />
                        {i.photoCount > 1 && <span className="thumb-count num">{i.photoCount}</span>}
                      </button>
                    ) : (
                      <button className="thumb is-empty" onClick={() => setViewing(i)} aria-label={`Add a photo of ${i.tag}`}>
                        No photo
                      </button>
                    )}
                  </td>
                  <td>
                    <span className="stored-tag num">{i.tag}</span>
                  </td>
                  <td>
                    {i.memberName} <span className="muted small num">#{i.memberNo}</span>
                  </td>
                  <td className="small">{i.description}</td>
                  <td>
                    {i.status === 'stored' ? (
                      <span className="status">In storage</span>
                    ) : (
                      <span className="status is-out">With caddie</span>
                    )}
                  </td>
                  <td className="r">
                    {i.status === 'stored' &&
                      (confirmId === i.id ? (
                        <span className="confirm">
                          <button
                            className="btn btn-small"
                            disabled={busy}
                            onClick={() => run(() => api.post(`/storage/${i.id}/withdraw`), `${i.tag} released to ${i.memberName}.`).then(() => setConfirmId(null))}
                          >
                            Confirm
                          </button>
                          <button className="btn btn-small btn-text" onClick={() => setConfirmId(null)}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button className="btn btn-small btn-text" onClick={() => setConfirmId(i.id)}>
                          Release to member
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No bags match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="storage-form panel" aria-labelledby="deposit-title">
        <h2 id="deposit-title">Deposit a bag</h2>
        <div className="field">
          <label htmlFor="deposit-member">Member</label>
          {member ? (
            <div className="picked">
              <span>
                {member.name} <span className="muted small num">#{member.memberNo}</span>
              </span>
              <button className="btn btn-text btn-small" onClick={() => setMember(null)}>
                Change
              </button>
            </div>
          ) : (
            <MemberSearch id="deposit-member" onPick={setMember} />
          )}
        </div>
        <div className="field">
          <label htmlFor="deposit-tag">Storage tag</label>
          <input id="deposit-tag" className="input num" placeholder="S-052" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="deposit-desc">Bag description</label>
          <input
            id="deposit-desc"
            className="input"
            placeholder="Brand, colour, number of clubs"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>
        <PhotoCapture id="deposit-photo" label="Photo of the bag" value={photo} onChange={setPhoto} />
        <button
          className="btn btn-primary"
          disabled={busy || !member || !tag.trim()}
          onClick={async () => {
            const ok = await run(
              () => api.post('/storage', { memberId: member!.id, tag, description: desc, photo }),
              `${tag.trim().toUpperCase()} stored for ${member!.name}${photo ? ', with photo' : ''}.`,
            );
            if (ok) {
              setMember(null);
              setTag('');
              setDesc('');
              setPhoto(null);
            }
          }}
        >
          Store bag
        </button>
        <p className="note">
          The photo records the bag's condition when it was handed over. Proof of concept: one record per bag, by tag.
        </p>
      </section>

      {viewing && <PhotoHistory item={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Every photo of one bag, newest first, with a way to add a condition check. */
function PhotoHistory({ item, onClose }: { item: StorageItem; onClose: () => void }) {
  const { snap } = useLive();
  const { run, busy } = useAction();
  const [photos, setPhotos] = useState<StoragePhoto[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [newPhoto, setNewPhoto] = useState<string | null>(null);

  useEffect(() => {
    api.get<StoragePhoto[]>(`/storage/${item.id}/photos`).then((p) => {
      setPhotos(p);
      setSelected((s) => (s && p.some((x) => x.id === s) ? s : (p[0]?.id ?? null)));
    });
  }, [item.id, snap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = photos?.find((p) => p.id === selected);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="photos-title">
        <div className="modal-head">
          <div>
            <h2 id="photos-title">
              <span className="stored-tag num">{item.tag}</span> {item.memberName}
            </h2>
            <p className="small muted">{item.description}</p>
          </div>
          <button className="btn btn-text" onClick={onClose} autoFocus>
            Close
          </button>
        </div>

        {photos === null ? (
          <p className="muted">Loading photos…</p>
        ) : photos.length === 0 ? (
          <p className="muted">No photos of this bag yet.</p>
        ) : (
          <>
            {current && (
              <figure className="photo-main">
                <img src={photoUrl(current.id)} alt={`${item.tag}, ${KIND_LABEL[current.kind]}`} />
                <figcaption>
                  <strong>{KIND_LABEL[current.kind]}</strong>{' '}
                  <span className="num">
                    {shortDate(current.takenAt)}, {clock(current.takenAt)}
                  </span>
                </figcaption>
              </figure>
            )}
            {photos.length > 1 && (
              <ol className="photo-strip">
                {photos.map((p) => (
                  <li key={p.id}>
                    <button className={`thumb${p.id === selected ? ' is-selected' : ''}`} onClick={() => setSelected(p.id)} aria-label={`${KIND_LABEL[p.kind]}, ${shortDate(p.takenAt)} ${clock(p.takenAt)}`}>
                      <img src={photoUrl(p.id)} alt="" loading="lazy" />
                    </button>
                    <span className="small muted num">{shortDate(p.takenAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        <div className="modal-add">
          <PhotoCapture id={`check-${item.id}`} label="Add a condition check" value={newPhoto} onChange={setNewPhoto} />
          {newPhoto && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                if (await run(() => api.post(`/storage/${item.id}/photos`, { photo: newPhoto }), `Photo saved for ${item.tag}.`)) setNewPhoto(null);
              }}
            >
              Save photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
