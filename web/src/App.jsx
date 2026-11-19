import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, STATE_LABEL } from './api.js';
import Debloat from './Debloat.jsx';
import Icon from './Icon.jsx';

const remembered = () => {
  try {
    return localStorage.getItem('debloater.device') || '';
  } catch {
    return '';
  }
};

export default function App() {
  const [state, setState] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [current, setCurrentRaw] = useState(remembered);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);

  const setCurrent = (serial) => {
    setCurrentRaw(serial);
    try {
      localStorage.setItem('debloater.device', serial);
    } catch {}
  };
  const notify = useCallback((msg) => {
    setToast(String(msg));
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  /** Run a server call and show its error instead of throwing. */
  const act = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (e) {
      notify(e.message);
      return null;
    }
  }, [notify]);

  const refresh = useCallback(async () => {
    try {
      setState(await api('GET', '/api/state'));
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  // Keep the device list fresh while the page is open.
  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const devices = state ? state.devices : [];
  const firstOnline = devices.find((d) => d.state === 'online');
  const device = devices.find((d) => d.serial === current) || firstOnline || devices[0];

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo"><Icon name="broom" fill /></span><span>Debloater<span className="dotc">.</span></span></div>
        <div className="grow" />
        <div className="row muted">
          <span className={`dot ${reachable && state && !state.adbError ? 'online' : 'unauthorized'}`} aria-hidden="true" />
          {!reachable ? 'Debloater has stopped. Start debloater.exe again.' : !state ? 'Starting…' : state.adbError ? 'adb is not working' : `${devices.filter((d) => d.state === 'online').length} of ${devices.length} online`}
        </div>
      </header>

      <main className="main">
        {!state ? (
          <div className="empty"><Icon name="spinner-gap" className="spin" />{reachable ? 'Starting…' : 'Debloater is not running. Start debloater.exe again, then reload this page.'}</div>
        ) : !state.adbPath ? (
          <AdbSetup state={state} act={act} notify={notify} refresh={refresh} />
        ) : (
          <>
            <DeviceBar state={state} device={device} setCurrent={setCurrent} act={act} notify={notify} refresh={refresh} />
            {!device ? (
              <div className="empty">
                <Icon name="television-simple" />
                <b>No TV found</b>
                <span>Plug the TV in by USB, or type its IP address above and press Connect.</span>
                <span>On the TV, switch on <b className="inl">Developer options → USB debugging</b> (and network debugging to connect by IP).</span>
              </div>
            ) : device.state === 'unauthorized' ? (
              <div className="empty"><Icon name="hand-tap" /><b>Approve this PC on the TV</b><span>The TV shows “Allow USB debugging?”. Tick “Always allow from this computer” and choose Allow.</span></div>
            ) : device.state !== 'online' ? (
              <div className="empty"><Icon name="plugs" /><b>{device.name} is offline</b><span>Check the cable or the network, then press Connect again.</span></div>
            ) : (
              <Debloat key={device.serial} device={device} act={act} notify={notify} />
            )}
            <AdbSettings state={state} act={act} notify={notify} refresh={refresh} />
          </>
        )}
      </main>
      {toast && <div className="toast" role="status"><Icon name="info" fill /><span>{toast}</span></div>}
    </div>
  );
}

function DeviceBar({ state, device, setCurrent, act, notify, refresh }) {
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const connect = async (e) => {
    e.preventDefault();
    if (!host.trim()) return;
    setBusy(true);
    const r = await act(() => api('POST', '/api/connect', { host }));
    setBusy(false);
    if (!r) return;
    notify(r.message);
    setHost('');
    setCurrent(r.serial);
    refresh();
  };
  const disconnect = async () => {
    await act(() => api('POST', `/api/devices/${encodeURIComponent(device.serial)}/disconnect`));
    refresh();
  };
  const rename = async (e) => {
    e.preventDefault();
    await act(() => api('PUT', `/api/devices/${encodeURIComponent(device.serial)}/name`, { name }));
    setNaming(false);
    refresh();
  };

  return (
    <section className="panel" aria-label="TV">
      <div className="row gap16 end">
        <label className="field grow">TV
          <select className="input" value={device ? device.serial : ''} disabled={!state.devices.length} onChange={(e) => setCurrent(e.target.value)}>
            {!state.devices.length && <option value="">No TV connected</option>}
            {state.devices.map((d) => <option key={d.serial} value={d.serial}>{d.name} · {d.serial}{d.state !== 'online' ? ` (${STATE_LABEL[d.state]})` : ''}</option>)}
          </select>
        </label>
        <form className="row end" onSubmit={connect}>
          <label className="field">Connect by IP
            <input className="input" placeholder="192.168.1.41" value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || !host.trim()}><Icon name="plugs-connected" />{busy ? 'Connecting…' : 'Connect'}</button>
        </form>
      </div>
      {device && (
        naming ? (
          <form className="row" onSubmit={rename}>
            <input className="input grow" autoFocus maxLength={60} placeholder={device.model || device.serial} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name for this TV" />
            <button className="btn">Save</button>
            <button type="button" className="btn quiet" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <div className="row muted">
            <span className={`state ${device.state}`}>{STATE_LABEL[device.state]}</span>
            {[device.maker, device.model, device.os && `Android ${device.os}`].filter(Boolean).join(' · ')}
            <span className="grow" />
            <button className="linkbtn" onClick={() => { setName(device.name === device.serial ? '' : device.name); setNaming(true); }}><Icon name="pencil-simple" />Rename</button>
            {device.network && <button className="linkbtn" onClick={disconnect}><Icon name="plugs" />Disconnect</button>}
          </div>
        )
      )}
    </section>
  );
}

function AdbSetup({ state, act, notify, refresh }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const r = await act(() => api('POST', '/api/adb/download'));
    setBusy(false);
    if (r) notify(`adb is ready: ${r.adbPath}`);
    refresh();
  };
  return (
    <section className="panel setup" aria-label="Set up adb">
      <h2 className="ptitle"><Icon name="wrench" />One-time setup: adb</h2>
      <div className="muted">
        Debloater talks to the TV with adb, Google’s Android Debug Bridge. It was not found on this PC.
        Download it here (about 7 MB from Google, saved in your user folder), or point to a copy you already have.
      </div>
      {state.canDownload && (
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={download}><Icon name={busy ? 'spinner-gap' : 'download-simple'} className={busy ? 'spin' : ''} />{busy ? 'Downloading…' : 'Download adb'}</button>
          <span className="muted">By downloading you accept the <a href="https://developer.android.com/studio/releases/platform-tools" target="_blank" rel="noreferrer">SDK Platform-Tools terms</a>.</span>
        </div>
      )}
      <AdbPathForm state={state} act={act} notify={notify} refresh={refresh} />
    </section>
  );
}

function AdbSettings(props) {
  return (
    <details className="panel settings">
      <summary className="ptitle"><Icon name="gear-six" />adb settings</summary>
      <div className="muted">Using <span className="mono">{props.state.adbPath}</span></div>
      <AdbPathForm {...props} />
    </details>
  );
}

function AdbPathForm({ state, act, notify, refresh }) {
  const [path, setPath] = useState(state.savedAdbPath || '');
  const submit = async (e) => {
    e.preventDefault();
    const r = await act(() => api('PUT', '/api/settings', { adbPath: path }));
    if (r) notify(r.adbPath ? `Using adb at ${r.adbPath}` : 'adb was not found.');
    refresh();
  };
  return (
    <form className="row end" onSubmit={submit}>
      <label className="field grow">Path to adb.exe or the platform-tools folder (leave empty to search automatically)
        <input className="input code" placeholder="C:\platform-tools" value={path} onChange={(e) => setPath(e.target.value)} />
      </label>
      <button className="btn">Save</button>
    </form>
  );
}
