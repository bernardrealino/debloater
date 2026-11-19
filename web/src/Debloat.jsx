import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import Icon from './Icon.jsx';

const LEVEL = {
  safe: 'Recommended',
  optional: 'If unused',
  caution: 'Careful',
  unknown: 'Unknown',
  app: 'Installed app',
  keep: 'Needed',
};
const VIEWS = [
  ['safe', 'Recommended to switch off'],
  ['optional', 'Apps and extras you may not use'],
  ['caution', 'Careful: removes a feature'],
  ['app', 'Apps installed on this TV'],
  ['unknown', 'Other system parts'],
  ['changed', 'Switched off or removed'],
  ['all', 'Everything'],
];
const STATE = { enabled: 'On', disabled: 'Switched off', removed: 'Removed' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The app list and Lite Launcher steps for one device. `device` is online. */
export default function Debloat({ device, act, notify }) {
  const online = device.state === 'online';
  const enc = encodeURIComponent(device.serial);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState('safe');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState([]);
  const [failed, setFailed] = useState([]);

  const load = useCallback(async () => {
    if (!online) return setInfo(null);
    setLoading(true);
    const r = await act(() => api('GET', `/api/devices/${enc}/debloat`));
    setLoading(false);
    if (r) setInfo(r);
  }, [online, enc, act]);

  useEffect(() => {
    setInfo(null);
    setPicked([]);
    setFailed([]);
    load();
  }, [load]);

  const packages = info ? info.packages : [];
  const byPkg = useMemo(() => new Map(packages.map((p) => [p.pkg, p])), [packages]);
  const term = search.trim().toLowerCase();
  const shown = packages.filter((p) => {
    if (term) return `${p.name} ${p.pkg}`.toLowerCase().includes(term);
    if (view === 'all') return true;
    if (view === 'changed') return p.state !== 'enabled';
    return p.level === view;
  });
  const count = (id) => packages.filter((p) => (id === 'all' ? true : id === 'changed' ? p.state !== 'enabled' : p.level === id)).length;
  const chosen = picked.map((p) => byPkg.get(p)).filter(Boolean);
  const toOff = chosen.filter((p) => p.state === 'enabled');
  const toRemove = chosen.filter((p) => p.state !== 'removed');
  const toRestore = chosen.filter((p) => p.state !== 'enabled');
  const toggle = (pkg) => setPicked((sel) => (sel.includes(pkg) ? sel.filter((x) => x !== pkg) : [...sel, pkg]));
  const selectable = (p) => p.level !== 'keep';

  const run = async (action, list) => {
    const risky = list.filter((p) => p.level === 'caution' || p.level === 'unknown');
    if (action !== 'restore') {
      const verb = action === 'disable' ? 'Switch off' : 'Remove';
      let text = `${verb} ${plural(list.length, 'app')} on ${device.name}?\n\nYou can put them back from this page at any time.`;
      if (risky.length) text += `\n\nTake care with: ${risky.map((p) => p.name || p.pkg).join(', ')}. These remove a feature or are not in the list of known apps.`;
      if (!confirm(text)) return;
    }
    setBusy(action);
    const r = await act(() => api('POST', `/api/devices/${enc}/debloat`, { action, packages: list.map((p) => p.pkg) }));
    setBusy('');
    if (!r) return;
    setFailed(r.failed);
    setPicked(r.failed.map((f) => f.pkg));
    const done = action === 'disable' ? 'Switched off' : action === 'remove' ? 'Removed' : 'Put back';
    notify(`${done} ${plural(r.done, 'app')}${r.failed.length ? ` · ${r.failed.length} could not be changed (listed on the page)` : ''}.`);
    load();
  };

  const launcher = async (action) => {
    if (action === 'uninstall' && !confirm('Remove the Lite Launcher? The stock home screen is switched back on first.')) return;
    setBusy(`launcher-${action}`);
    const r = await act(() => api('POST', `/api/devices/${enc}/launcher`, { action }));
    setBusy('');
    if (r) notify(r.message);
    load();
  };

  const l = info && info.launcher;
  const stockHomes = l ? l.stock : [];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h2 className="ptitle"><Icon name="broom" />Apps on {device.name}</h2>
          <div className="sub">Switch off the apps and background parts you do not use so the TV has less to run.</div>
        </div>
        <button className="btn" disabled={!online || loading} onClick={load}><Icon name="arrows-clockwise" className={loading ? 'spin' : ''} />{loading ? 'Reading…' : 'Read again'}</button>
      </div>

      {!online ? (
        <div className="empty"><Icon name="plugs" />This device is not online.</div>
      ) : !info ? (
        <div className="empty"><Icon name={loading ? 'spinner-gap' : 'warning-circle'} className={loading ? 'spin' : ''} />{loading ? 'Reading the app list from the TV…' : 'Could not read the app list. Press Refresh to try again.'}</div>
      ) : (
        <>
          <div className="notice info">
            <Icon name="shield-check" />
            <span className="grow">Nothing is deleted for good. “Switch off” freezes an app; “Remove” takes it away for this TV’s user but keeps its files. Both can be undone here with “Put back”, or by a factory reset. Parts the TV cannot run without are locked.</span>
          </div>

          <section className="panel" aria-label="Light home screen">
            <h2 className="ptitle"><Icon name="house-line" />Light home screen</h2>
            <div className="muted">
              The Lite Launcher is a home screen that shows only a clock, the network status, your TV inputs, Settings and your apps (which you can hide or sort by use). It loads no recommendations or adverts and runs nothing in the background.
            </div>
            <div className="steps">
              <div className="step">
                <span className={`num ${l.installed ? 'done' : ''}`} aria-hidden="true">{l.installed ? <Icon name="check" size={14} /> : 1}</span>
                <span className="grow"><b>Install it.</b> {l.installed ? 'Installed on this TV.' : l.available ? 'Not installed yet.' : 'The launcher APK is missing from this build.'}</span>
                <button className="btn" disabled={!l.available || !!busy} onClick={() => launcher('install')}><Icon name="download-simple" />{busy === 'launcher-install' ? 'Installing…' : l.installed ? 'Install again' : 'Install'}</button>
                {l.installed && <button className="btn" disabled={!!busy} onClick={() => launcher('open')}><Icon name="arrow-square-out" />Open on TV</button>}
              </div>
              <div className="step">
                <span className={`num ${l.isHome ? 'done' : ''}`} aria-hidden="true">{l.isHome ? <Icon name="check" size={14} /> : 2}</span>
                <span className="grow"><b>Make it the home screen.</b> {l.isHome ? 'The Home button now opens the Lite Launcher.' : `The Home button opens ${(byPkg.get(l.currentHome) || {}).name || l.currentHome || 'the stock home screen'}.`}</span>
                <button className="btn" disabled={!l.installed || l.isHome || !!busy} onClick={() => launcher('home')}>{busy === 'launcher-home' ? 'Setting…' : 'Set as home screen'}</button>
              </div>
              <div className="step">
                <span className={`num ${l.installed && !stockHomes.length ? 'done' : ''}`} aria-hidden="true">{l.installed && !stockHomes.length ? <Icon name="check" size={14} /> : 3}</span>
                <span className="grow"><b>Switch the stock home screen off.</b> {!stockHomes.length ? (l.installed ? 'Done. Only the Lite Launcher is left.' : 'Install the Lite Launcher first.') : `Still on: ${stockHomes.map((h) => (byPkg.get(h) || {}).name || h).join(', ')}. Switching these off stops the stock home screen running in the background and hands the Home button to the Lite Launcher.`}</span>
                <button className="btn" disabled={!l.installed || !stockHomes.length || !!busy} onClick={() => run('disable', stockHomes.map((h) => byPkg.get(h)).filter(Boolean))}>Switch off</button>
              </div>
            </div>
            {l.installed && <div className="row"><button className="linkbtn" disabled={!!busy} onClick={() => launcher('uninstall')}>Remove the Lite Launcher and bring the stock home screen back</button></div>}
          </section>

          <section className="panel flush" aria-label="Apps and system parts">
            <div className="panel-head">
              <div className="row gap16">
                <h2 className="grow ptitle"><Icon name="list-checks" />Choose what to switch off</h2>
                <label className="field">Show
                  <select className="input dark" value={view} onChange={(e) => { setView(e.target.value); setSearch(''); }}>
                    {VIEWS.map(([id, label]) => <option key={id} value={id}>{label} ({count(id)})</option>)}
                  </select>
                </label>
                <label className="field">Search everything
                  <span className="search"><Icon name="magnifying-glass" /><input className="input dark" type="search" placeholder="Name or package" value={search} onChange={(e) => setSearch(e.target.value)} /></span>
                </label>
              </div>
              <div className="bar">
                <div className="grow count"><b>{picked.length}</b>selected</div>
                <button className="btn" onClick={() => setPicked([...new Set([...picked, ...shown.filter((p) => selectable(p)).map((p) => p.pkg)])])} disabled={!shown.some(selectable)}><Icon name="checks" />Select all shown</button>
                <button className="btn" onClick={() => setPicked([])} disabled={!picked.length}><Icon name="x" />Clear</button>
                <span className="sep" aria-hidden="true" />
                <button className="btn light" disabled={!toOff.length || !!busy} onClick={() => run('disable', toOff)}><Icon name="power" />{busy === 'disable' ? 'Working…' : `Switch off${toOff.length ? ` (${toOff.length})` : ''}`}</button>
                <button className="btn" disabled={!toRemove.length || !!busy} onClick={() => run('remove', toRemove)}><Icon name="trash" />{busy === 'remove' ? 'Working…' : `Remove${toRemove.length ? ` (${toRemove.length})` : ''}`}</button>
                <button className="btn" disabled={!toRestore.length || !!busy} onClick={() => run('restore', toRestore)}><Icon name="arrow-counter-clockwise" />{busy === 'restore' ? 'Working…' : `Put back${toRestore.length ? ` (${toRestore.length})` : ''}`}</button>
              </div>
            </div>
            {!!failed.length && (
              <div className="result">
                <div className="warn row" style={{ fontWeight: 600, gap: 6 }}><Icon name="warning-circle" />{plural(failed.length, 'app')} could not be changed</div>
                <pre className="out">{failed.map((f) => `${f.pkg}: ${f.message}`).join('\n')}</pre>
              </div>
            )}
            <div className="list">
              {!shown.length && <div className="item muted">{term ? `Nothing matches “${search}”.` : 'Nothing in this group on this TV.'}</div>}
              {shown.map((p) => {
                const on = picked.includes(p.pkg);
                return (
                  <label key={p.pkg} className={`item tall ${on ? 'sel' : ''}`} style={{ cursor: selectable(p) ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={on} disabled={!selectable(p)} onChange={() => toggle(p.pkg)} aria-label={`Select ${p.name || p.pkg}`} />
                    <span className="name">
                      <span className="clip" style={{ display: 'block', fontWeight: 600 }}>{p.name || p.pkg}</span>
                      <span className="muted clip" style={{ display: 'block' }}>{p.note}</span>
                      {p.name && <span className="mono muted clip" style={{ display: 'block' }}>{p.pkg}</span>}
                    </span>
                    <span className={`tag ${p.level}`}>{p.level === 'keep' && <Icon name="lock-simple" size={12} />} {LEVEL[p.level]}</span>
                    <span className={`state ${p.state === 'enabled' ? '' : 'offline'}`} style={{ flex: 'none', width: 96, textAlign: 'right' }}>{STATE[p.state]}</span>
                  </label>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}
