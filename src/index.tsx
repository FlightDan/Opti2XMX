import { t } from './i18n';
import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, SliderField, ToggleField, staticClasses, Navigation, Router } from '@decky/ui';
import { callable, definePlugin, FileSelectionType, openFilePicker, toaster } from '@decky/api';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

type Reply<T> = { ok: boolean; data?: T; error?: string };
type Setup = { status: string; launch?: string; old_launch: string; imported?: boolean };
type Game = { appid: number; name: string };
type Settings = { sr: string; fg: string; fg_input: string; spoof: string; fg_multiplier?: string };
type FsrStatus = { ready: boolean; version: string; reason: string };
type GameFsrStatus = FsrStatus & { prepared: boolean; bridge_ready: boolean; opti_version: string };
type Pending = { expected: string; target: string; kind: string };
type Info = Game & { executables: string[]; libraries: { path: string; version: number[] | null }[];
  optis: string[]; runtime_ready: boolean; prefix_ready: boolean; external_managed: boolean;
  automatic: { executable: string; route: string; reason: string; candidates: string[] }; state: Setup | null;
  fsr?: GameFsrStatus;
  opti?: { managed: boolean; installed: boolean; incomplete?: boolean; injection_enabled: boolean; version: string; status: string; rollback: boolean; pending?: Pending; settings_rollback?: boolean; settings_recovery?: boolean; settings: Settings } };
type Registration = { unregister(): void };
type RuntimeStatus = {ready:boolean;available:boolean;version:string;size_bytes:number;host_issue:string;error:string;availability_message:string};
type Operation = {schema:number;instance_id:string;operation_id:string|null;appid:number|null;kind:string;version:string;phase:string;running:boolean;downloaded_bytes:number;total_bytes:number|null;error:string|null;revision:number};
// Steam moves dropdown menus out of Quick Access and unmounts Content. Menu
// callbacks must update the session, not only a component that no longer exists.
type DownloadSource = 'local' | 'github' | 'ghfast' | 'ghproxy';
type SettingsSave = { appid: number; saving: boolean; error: boolean; message: string };
type CacheStatus = Record<string, {cached:boolean;prepared:boolean;size_bytes:number}>;
type Selection = { appid: number; executables: Record<number, string>; sources: Record<string, DownloadSource>;
  versions: Record<number, string>; advanced: Record<number, boolean>; fgDraft: {appid:number; value:number} | null;
  cache: CacheStatus;
  snapshots: Record<number, { info: Info; launch: string }>; settingsSave: SettingsSave | null;
  settingsEpochs: Record<number, number>; actionBusy: boolean;
  manualGame: { appid: number; runningAppid: number } | null };
let selection: Selection = { appid: 0, executables: {}, sources: {}, versions: {}, advanced: {}, fgDraft: null, cache: {}, snapshots: {}, settingsSave: null,
  settingsEpochs: {}, actionBusy: false, manualGame: null };
const selectionListeners = new Set<() => void>();
const selectionSnapshot = () => selection;
function subscribeSelection(listener: () => void) {
  selectionListeners.add(listener);
  return () => { selectionListeners.delete(listener); };
}
function updateSelection(next: Selection) {
  selection = next;
  for (const listener of selectionListeners) listener();
}
let fgTimer: ReturnType<typeof setTimeout> | undefined;
function cancelMultiplier() {
  if (fgTimer !== undefined) clearTimeout(fgTimer);
  fgTimer=undefined;
  if (selection.fgDraft) updateSelection({...selection,fgDraft:null});
}
function scheduleMultiplier(id: number, value: number) {
  if (selection.appid !== id || selection.actionBusy || selection.settingsSave?.saving || !Number.isInteger(value) || value < 0 || value > 3) return;
  if (fgTimer !== undefined) clearTimeout(fgTimer);
  updateSelection({...selection,fgDraft:{appid:id,value}});
  const flush = () => {
    fgTimer=undefined;
    const draft=selection.fgDraft;
    if (!draft || draft.appid!==id || draft.value!==value) return;
    if (selection.appid!==id) { updateSelection({...selection,fgDraft:null}); return; }
    if (selection.actionBusy || selection.settingsSave?.saving) {
      fgTimer=setTimeout(flush,100);
      return;
    }
    void (async()=>{
      await saveSettingsPatch(id,{fg:value===0?'native':'xefg',fg_multiplier:['native','2','3','4'][value]},false,true);
      if (selection.fgDraft===draft) updateSelection({...selection,fgDraft:null});
    })();
  };
  fgTimer=setTimeout(flush,350);
}
function runningAppid(): number {
  try {
    const id = Number(Router?.MainRunningApp?.appid);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  } catch { return 0; }
}
function initialGame(list: Game[], operation: Operation | null, previous: number): number {
  const available = (id: number | null | undefined) => list.find(game => game.appid === id)?.appid;
  const attached = operation?.running || operation?.phase === 'awaiting-launch';
  const running = runningAppid();
  // A native game dropdown temporarily unmounts Content. Keep an explicit
  // choice for this running game, but follow Steam when a different game starts.
  let manual = selection.manualGame;
  if (manual && running > 0 && manual.runningAppid !== running) {
    manual = null;
    updateSelection({...selection, manualGame:null});
  }
  return (selection.settingsSave?.saving ? available(selection.settingsSave.appid) : undefined)
    || (attached ? available(operation?.appid) : undefined)
    || (manual?.runningAppid === running && manual.appid === previous ? available(manual.appid) : undefined)
    || available(running) || available(previous) || list[0]?.appid || 0;
}
function downloadSource(version: string): DownloadSource {
  const chosen = selection.sources[version];
  return chosen || (selection.cache[version]?.cached ? 'local' : 'github');
}
function setSource(version: string, value: string) {
  if (value === 'github' || value === 'ghfast' || value === 'ghproxy' || (value === 'local' && selection.cache[version]?.cached))
    updateSelection({...selection,sources:{...selection.sources,[version]:value as DownloadSource}});
}
declare const SteamClient: { Apps: {
  RegisterForAppDetails(id: number, callback: (...args: unknown[]) => void): Registration;
  SetAppLaunchOptions(id: number, value: string): void;
}};
const inventory = callable<[], Reply<Game[]>>('inventory');
const inspect = callable<[number], Reply<Info>>('inspect_game');
const enable = callable<[number, string, string, string], Reply<Setup>>('enable');
const confirm = callable<[number, string], Reply<Setup>>('confirm_launch');
const restore = callable<[number, string], Reply<Setup>>('restore');
const optiInstall = callable<[number, string, string, string, string], Reply<Pending>>('opti_install');
const optiCacheStatus = callable<[], Reply<CacheStatus>>('opti_cache_status');
const optiMigrate = callable<[number, string, string], Reply<Pending>>('opti_migrate');
const optiRollback = callable<[number, string], Reply<Pending>>('opti_rollback');
const optiUninstall = callable<[number, string], Reply<Pending>>('opti_uninstall');
const optiConfirm = callable<[number, string], Reply<boolean>>('opti_confirm');
const optiToggle = callable<[number, boolean, string], Reply<Pending>>('opti_toggle');
const optiSettings = callable<[number, Settings, boolean], Reply<boolean>>('opti_settings');
const settingsPreflight = callable<[number], Reply<boolean>>('settings_preflight');
const optiRestoreSettings = callable<[number], Reply<boolean>>('opti_restore_settings');
const optiPanel = callable<[number], Reply<boolean>>('opti_panel');
const operationProgress = callable<[], Reply<Operation>>('operation_progress');
const runtimeStatus = callable<[], Reply<RuntimeStatus>>('runtime_status');
const runtimeInstall = callable<[], Reply<RuntimeStatus>>('runtime_install');
const fsrStatus = callable<[], Reply<FsrStatus>>('fsr_status');
const fsrImport = callable<[string], Reply<FsrStatus>>('fsr_import');
const fsrPrepare = callable<[number, string, string, string], Reply<Pending>>('fsr_prepare');
function unwrap<T>(r: Reply<T>): T {
  if (!r.ok || r.data === undefined) throw new Error(t(r.error || '操作失败'));
  return r.data;
}
function readLaunch(id: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let reg: Registration | undefined;
    let done = false;
    const timeout = setTimeout(() => { done = true; reg?.unregister(); reject(new Error(t('读取 Steam 启动项超时'))); }, 8000);
    reg = SteamClient.Apps.RegisterForAppDetails(id, (...args) => {
      const details = args.find((a): a is { strLaunchOptions: string } =>
        typeof a === 'object' && a !== null && 'strLaunchOptions' in a && typeof a.strLaunchOptions === 'string');
      if (done || !details) return;
      done = true; clearTimeout(timeout); resolve(details.strLaunchOptions);
      queueMicrotask(() => reg?.unregister());
    });
  });
}
async function writeLaunch(id: number, desired: string, expected: string): Promise<string> {
  if (await readLaunch(id) !== expected) throw new Error(t('启动项刚被其他工具修改，请重新打开插件后重试'));
  SteamClient.Apps.SetAppLaunchOptions(id, desired);
  for (let n = 0; n < 10; n++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    const actual = await readLaunch(id);
    if (actual === desired) return actual;
  }
  throw new Error(t('Steam 启动项写入尚未确认，请使用继续开启或恢复'));
}
async function finish(id: number, setup: Setup, restoring = false) {
  const before = await readLaunch(id);
  const target = restoring ? setup.old_launch : setup.launch!;
  if (before !== setup.old_launch && before !== setup.launch)
    throw new Error(t('启动项已被其他工具修改，请检查后再试。'));
  const actual = before === target ? before : await writeLaunch(id, target, before);
  unwrap(await confirm(id, actual));
}
async function applyPendingLaunch(id: number, before: string, next: Pending) {
  if (before !== next.expected && before !== next.target) throw new Error(t('启动项已变化，请检查后重试'));
  const actual = before === next.target ? before : await writeLaunch(id, next.target, before);
  unwrap(await optiConfirm(id, actual));
}
async function saveFSRSettings(id: number, desired: Settings, source: DownloadSource, manual: string) {
  let currentInfo = unwrap(await inspect(id));
  let launch = await readLaunch(id);
  let xmxActive = currentInfo.state?.status === 'active' && launch === currentInfo.state.launch;
  const executable = () => currentInfo.automatic.executable
    || (currentInfo.executables.includes(manual) && currentInfo.automatic.candidates.includes(manual) ? manual : '');
  if (currentInfo.state?.status === 'active' && !xmxActive)
    throw new Error(t('启动项已变化，请重新打开插件后恢复 XMX，再保存 FSR。'));
  if (!currentInfo.fsr?.prepared && xmxActive) {
    await finish(id, unwrap(await restore(id, launch)), true);
    currentInfo = unwrap(await inspect(id)); launch = await readLaunch(id); xmxActive = false;
  }
  if (!currentInfo.fsr?.prepared) {
    const exe = executable();
    if (!exe) throw new Error(t('请先选择要运行的游戏程序。'));
    await applyPendingLaunch(id, launch, unwrap(await fsrPrepare(id, exe, launch, source)));
    currentInfo = unwrap(await inspect(id)); launch = await readLaunch(id);
    xmxActive = currentInfo.state?.status === 'active' && launch === currentInfo.state.launch;
  }
  if (xmxActive && !currentInfo.fsr?.bridge_ready) {
    await finish(id, unwrap(await restore(id, launch)), true);
    currentInfo = unwrap(await inspect(id)); launch = await readLaunch(id); xmxActive = false;
  }
  if (!xmxActive) {
    const exe = executable();
    if (!exe) throw new Error(t('请先选择要运行的游戏程序。'));
    const setup = unwrap(await enable(id, exe, currentInfo.automatic.route, launch));
    if (!['active','pending_launch'].includes(setup.status)) throw new Error(t('上次设置未完成，请先点击恢复。'));
    await finish(id, setup);
    currentInfo = unwrap(await inspect(id)); launch = await readLaunch(id);
    xmxActive = currentInfo.state?.status === 'active' && launch === currentInfo.state.launch;
  }
  if (!xmxActive || !currentInfo.fsr?.bridge_ready)
    throw new Error(t(currentInfo.fsr?.reason || 'FSR XMX 兼容组件尚未就绪，请重新打开插件后重试。'));
  unwrap(await optiSettings(id, desired, false));
}
const defaults: Settings = {sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real',fg_multiplier:'native'};
function validPatch(patch: Partial<Settings>) {
  const allowed: Record<string, string[]> = {
    sr:['xess','fsr_xmx','fsr31','fsr22','dlss'], fg:['native','fsrfg','xefg'],
    fg_input:['fsrfg30','fsrfg','dlssg','upscaler'], spoof:['real','nvidia','amd','intel'], fg_multiplier:['native','2','3','4'],
  };
  return Object.entries(patch).every(([key,value]) => allowed[key]?.includes(value));
}
// The native Steam menu can call this after Content has unmounted. The shared
// lock and result belong to the plugin session, not to that old React instance.
async function saveSettingsPatch(id: number, patch: Partial<Settings>, reset = false, fromSlider = false) {
  if (selection.appid !== id || selection.actionBusy || selection.settingsSave?.saving || !validPatch(patch)) return;
  if (!fromSlider) cancelMultiplier();
  const manual = selection.executables[id] || '';
  updateSelection({...selection, settingsEpochs:{...selection.settingsEpochs,[id]:(selection.settingsEpochs[id] || 0)+1},
    settingsSave:{appid:id,saving:true,error:false,message:'正在自动保存设置…'}});
  let failure = '';
  let beforeSettings: Settings | undefined;
  try {
    unwrap(await settingsPreflight(id));
    const current = unwrap(await inspect(id));
    if (!current.opti?.managed) throw new Error(t('请先安装或迁移 Opti'));
    beforeSettings = current.opti.settings;
    const desired: Settings = reset ? {...defaults} : {...current.opti.settings,...patch};
    if (patch.fg === 'native') desired.fg_multiplier = 'native';
    else if (patch.fg && (!desired.fg_multiplier || desired.fg_multiplier === 'native')) desired.fg_multiplier = '2';
    if (desired.sr === 'fsr_xmx') {
      if (!current.fsr?.ready) throw new Error(current.fsr?.reason || t('请导入本地 FSR 模型包。'));
      desired.spoof = 'real';
      await saveFSRSettings(id, desired, downloadSource(current.fsr?.opti_version || '10.0.0-pre1_20261025'), manual);
    } else unwrap(await optiSettings(id, desired, reset));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  await finishSessionTask(id, failure, '');
  const afterSettings = selection.snapshots[id]?.info.opti?.settings;
  const settingKey = (value: Settings) => JSON.stringify([value.sr, value.fg, value.fg_input, value.spoof,
    value.fg === 'native' ? 'native' : value.fg_multiplier || '2']);
  if (!selection.settingsSave?.error && beforeSettings && afterSettings && settingKey(beforeSettings) !== settingKey(afterSettings))
    toaster.toast({title:t('设置已保存'),body:t('请重启游戏以应用更改。')});
}
async function finishSessionTask(id: number, failure: string, success: string) {
  let refreshed: {info: Info; launch: string} | undefined;
  try {
    const [info, launch] = await Promise.all([inspect(id).then(unwrap), readLaunch(id)]);
    refreshed = {info,launch};
  } catch (error) {
    if (!failure) failure = error instanceof Error ? error.message : String(error);
  }
  updateSelection({...selection,
    snapshots:refreshed ? {...selection.snapshots,[id]:refreshed} : selection.snapshots,
    settingsEpochs:{...selection.settingsEpochs,[id]:(selection.settingsEpochs[id] || 0)+1},
    settingsSave:{appid:id,saving:false,error:!!failure,message:failure || success}});
  if (failure) toaster.toast({title:t('Opti2XMX：未完成'),body:t(failure)});
}
function selectedExecutable(info: Info) {
  const manual = selection.executables[info.appid] || '';
  return info.automatic.executable || (info.executables.includes(manual) && info.automatic.candidates.includes(manual) ? manual : '');
}
type OptiAction = 'install' | 'migrate' | 'rollback' | 'uninstall' | 'finish';
async function runOptiAction(id: number, kind: OptiAction, version: string) {
  if (selection.appid !== id || selection.actionBusy || selection.settingsSave?.saving) return;
  cancelMultiplier();
  const source = downloadSource(version);
  updateSelection({...selection,settingsEpochs:{...selection.settingsEpochs,[id]:(selection.settingsEpochs[id] || 0)+1},
    settingsSave:{appid:id,saving:true,error:false,message:'正在准备 Opti 安装…'}});
  let failure = '', restoredXmx = false;
  try {
    let data = unwrap(await inspect(id));
    let launch = await readLaunch(id);
    const exe = selectedExecutable(data);
    if ((kind === 'install' || kind === 'migrate') && !exe) throw new Error(t('请先选择要运行的游戏程序。'));
    if (kind === 'install' && source === 'local') {
      const cache = unwrap(await optiCacheStatus());
      updateSelection({...selection,cache});
      if (!cache[version]?.cached) throw new Error(t('本地安装包不存在，请重新选择安装来源。'));
    }
    const wasActive = data.state?.status === 'active';
    if (wasActive && launch !== data.state?.launch)
      throw new Error(t('启动项已被其他工具修改，请检查后再试。'));
    if (kind === 'install' && wasActive) {
      updateSelection({...selection,settingsSave:{appid:id,saving:true,error:false,message:'正在临时关闭 XMX，以安装 Opti…'}});
      await finish(id, unwrap(await restore(id, launch)), true);
      restoredXmx = true;
      data = unwrap(await inspect(id)); launch = await readLaunch(id);
    }
    const fsrReprepare = version === data.fsr?.opti_version && data.fsr.prepared && data.fsr.ready;
    const next = kind === 'install' ? fsrReprepare
      ? unwrap(await fsrPrepare(id, exe, launch, source)) : unwrap(await optiInstall(id, exe, launch, version, source))
      : kind === 'migrate' ? unwrap(await optiMigrate(id, exe, launch))
      : kind === 'rollback' ? unwrap(await optiRollback(id, launch))
      : kind === 'uninstall' ? unwrap(await optiUninstall(id, launch)) : data.opti?.pending;
    if (!next) throw new Error(t('没有待完成的 Opti 启动设置。'));
    await applyPendingLaunch(id, launch, next);
    if (restoredXmx) {
      updateSelection({...selection,settingsSave:{appid:id,saving:true,error:false,message:'Opti 已安装，正在恢复 XMX…'}});
      data = unwrap(await inspect(id)); launch = await readLaunch(id);
      const freshExe = selectedExecutable(data);
      if (!freshExe) throw new Error(t('请先选择要运行的游戏程序。'));
      const setup = unwrap(await enable(id, freshExe, data.automatic.route, launch));
      if (!['active','pending_launch'].includes(setup.status)) throw new Error(t('上次设置未完成，请先点击恢复。'));
      await finish(id, setup);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (failure.includes('游戏仍在运行')) failure = '游戏正在运行，请先退出游戏再安装或更换 Opti。';
    else if (restoredXmx) failure = t('安装流程未完成，请按当前状态完成或恢复：') + t(failure);
  }
  try { updateSelection({...selection,cache:unwrap(await optiCacheStatus())}); } catch { /* Nonessential cache status must not hide the installation result. */ }
  await finishSessionTask(id, failure, restoredXmx ? 'Opti 已安装，XMX 已恢复；下次启动游戏生效。' : 'Opti 操作完成，下次启动游戏生效。');
}
function Content() {
  const [games, setGames] = useState<Game[]>([]);
  const [appid, setAppid] = useState(0);
  const [loadedInfo, setInfo] = useState<Info | null>(null);
  const [manualExe, setManualExe] = useState('');
  const [loadedLaunch, setActualLaunch] = useState('');
  const [localBusy, setBusy] = useState(false);
  const [message, setMessage] = useState(t('正在读取游戏列表…'));
  const [error, setError] = useState(false);
  const lock = useRef(false);

  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [progressDisconnected, setProgressDisconnected] = useState(false);
  const latestOperation = useRef<Operation | null>(null);
  const mounted = useRef(true);
  const selected = useRef(0);
  const loadSequence = useRef(0);
  const progressRequest = useRef(0);
  const acceptedRequest = useRef(0);
  const refreshNeeded = useRef<{appid:number;instance:string;operation:string|null} | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [fsr, setFsr] = useState<FsrStatus | null>(null);
  const session = useSyncExternalStore(subscribeSelection, selectionSnapshot);
  const snapshot = session.snapshots[appid];
  const info = snapshot?.info || loadedInfo;
  const actualLaunch = snapshot?.launch ?? loadedLaunch;
  const settings = info?.opti?.settings || defaults;
  const saveFeedback = session.settingsSave?.appid === appid ? session.settingsSave : null;
  const visibleMessage = saveFeedback?.message || message;
  const visibleError = saveFeedback?.error ?? error;
  const sliderBusy = localBusy || operation?.running === true || session.settingsSave?.saving === true || session.actionBusy;
  const busy = sliderBusy || session.fgDraft !== null;
  const advanced = session.advanced[appid] ?? true;
  function acceptOperation(value: Operation) {
    if (!mounted.current || value.schema !== 1 || !Number.isSafeInteger(value.revision)
      || (latestOperation.current?.instance_id === value.instance_id && value.revision < latestOperation.current.revision)) return false;
    latestOperation.current = value; setOperation(value);
    return true;
  }
  async function readOperation(allowed = () => mounted.current) {
    const request = ++progressRequest.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([operationProgress(), new Promise<Reply<Operation>>((_, reject) => {
        timer = setTimeout(() => reject(new Error('progress timeout')), 5000);
      })]);
      const value = unwrap(reply);
      if (request < acceptedRequest.current || !allowed()) return null;
      acceptedRequest.current = request;
      setProgressDisconnected(false);
      return acceptOperation(value) ? value : null;
    } catch (e) {
      acceptedRequest.current = Math.max(acceptedRequest.current, request);
      if (allowed()) setProgressDisconnected(true);
      throw e;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function load(id: number) {
    const sequence = ++loadSequence.current;
    const settingsEpoch = selection.settingsEpochs[id] || 0;
    const [data, launch] = await Promise.all([inspect(id).then(unwrap), readLaunch(id)]);
    if (!mounted.current || selected.current !== id || sequence !== loadSequence.current
      || settingsEpoch !== (selection.settingsEpochs[id] || 0)) return data;
    const remembered = selection.executables[id] || '';
    const valid = data.automatic.candidates.includes(remembered) && data.executables.includes(remembered);
    if (remembered && !valid) {
      const executables = {...selection.executables}; delete executables[id];
      updateSelection({...selection, executables});
    }
    setInfo(data); setActualLaunch(launch); setManualExe(valid ? remembered : '');
    updateSelection({...selection,snapshots:{...selection.snapshots,[id]:{info:data,launch}}});
    if (data.fsr) setFsr({ready:data.fsr.ready,version:data.fsr.version,reason:data.fsr.reason});
    setRemoveConfirm(false);
    return data;
  }
  async function task(progress: string, fn: () => Promise<void>, reattach = false) {
    if (lock.current || (!reattach && (latestOperation.current?.running || selection.settingsSave?.saving || selection.actionBusy))) return;
    if (!reattach) cancelMultiplier();
    if (!reattach && selection.settingsSave && !selection.settingsSave.saving)
      updateSelection({...selection,settingsSave:null});
    if (!reattach) updateSelection({...selection,actionBusy:true});
    lock.current = true; setBusy(true); setError(false); setMessage(progress);
    try { await fn(); }
    catch (e) {
      const text = t(e instanceof Error ? e.message : String(e));
      setError(true); setMessage(text);
      toaster.toast({ title: t('Opti2XMX：未完成'), body: text });
    } finally {
      lock.current = false; setBusy(false);
      if (!reattach) updateSelection({...selection,actionBusy:false});
    }
  }
  async function select(id: number, manual = false) {
    if (!games.some(game => game.appid === id)) return;
    if (selection.appid !== id) cancelMultiplier();
    localStorage.setItem('opti2xmx-selected', String(id));
    if (selection.appid !== id || manual) updateSelection({...selection, appid:id,
      manualGame:manual ? {appid:id,runningAppid:runningAppid()} : selection.manualGame});
    if (!mounted.current) return;
    await task(t('正在检查这个游戏…'), async () => {
      setAppid(id); setInfo(null); setManualExe('');
      selected.current = id;
      await load(id); setMessage('');
    });
  }
  useEffect(() => {
    if (!busy && session.appid && selected.current !== session.appid && games.some(g => g.appid === session.appid))
      void select(session.appid);
  }, [session.appid, games, busy]);
  useEffect(() => {
    mounted.current = true;
    let alive = true, polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const before = latestOperation.current;
        const next = await readOperation(() => alive && mounted.current);
        if (!alive || !next) return;
        const restarted = before && before.instance_id !== next.instance_id;
        const confirmed = before?.operation_id === next.operation_id && before?.phase === 'awaiting-launch' && next.phase === 'completed';
        if (before?.running && !next.running && next.kind === 'runtime_install')
          setRuntime(unwrap(await runtimeStatus()));
        if ((restarted || (before?.running && !next.running) || confirmed) && selected.current > 0
          && (restarted || next.appid === selected.current || next.kind === 'runtime_install'))
          refreshNeeded.current = {appid:selected.current,instance:next.instance_id,operation:next.operation_id};
        const refresh = refreshNeeded.current;
        if (refresh && (refresh.appid !== selected.current || refresh.instance !== next.instance_id || refresh.operation !== next.operation_id))
          refreshNeeded.current = null;
        else if (refresh && !lock.current) {
          await load(refresh.appid);
          if (refreshNeeded.current === refresh) refreshNeeded.current = null;
        }
      } catch { /* Keep the last running snapshot; a failed poll must not unlock it. */ }
      finally { polling = false; }
    }
    void poll();
    const timer = setInterval(() => { void poll(); }, 500);
    return () => { alive = false; mounted.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    void task(t('正在读取游戏列表…'), async () => {
      try { await readOperation(); } catch { /* Inventory remains usable while snapshot polling reconnects. */ }
      setRuntime(unwrap(await runtimeStatus()));
      try { setFsr(unwrap(await fsrStatus())); }
      catch { setFsr({ready:false,version:'',reason:t('当前插件后台不支持 FSR 模型导入，请更新插件。')}); }
      try { updateSelection({...selection,cache:unwrap(await optiCacheStatus())}); } catch { /* Older backends can still show network sources. */ }
      const list = unwrap(await inventory()); if (!mounted.current) return; setGames(list);
      const previous = Number(localStorage.getItem('opti2xmx-selected')) || selection.appid;
      const id = initialGame(list, latestOperation.current, previous);
      if (id) { selected.current = id; setAppid(id); updateSelection({...selection,appid:id}); await load(id); setMessage(''); }
      else setMessage(t('未找到已安装的 Steam 游戏。'));
    }, true);
  }, []);
  const state = info?.state;
  const active = state?.status === 'active' && actualLaunch === state.launch;
  const managed = !!state && !['restored', 'failed'].includes(state.status);
  const pending = managed && state?.status !== 'active';
  const rememberedExe = session.executables[appid] || manualExe;
  const validManualExe = info?.executables.includes(rememberedExe) && info.automatic.candidates.includes(rememberedExe) ? rememberedExe : '';
  const executable = info?.automatic.executable || validManualExe;
  const needsChoice = !!info && !info.automatic.executable && info.automatic.candidates.length > 1;
  const reason = needsChoice && validManualExe && info?.automatic.reason === '发现多个游戏程序，请在下面确认一次。'
    ? '' : info?.automatic.reason || '';
  const blocked = !managed && (!!reason || !executable);
  async function toggle(want: boolean) {
    if (!info) return;
    const id = info.appid;
    await task(want ? t('正在开启 XMX，请稍候…') : t('正在关闭 XMX，恢复原配置…'), async () => {
      try {
        const before = await readLaunch(id);
        if (want) {
          const setup = managed ? state! : unwrap(await enable(id, executable, info.automatic.route, before));
          if (!['active', 'pending_launch'].includes(setup.status)) throw new Error(t('上次设置未完成，请先点击恢复。'));
          await finish(id, setup);
        } else {
          await finish(id, unwrap(await restore(id, before)), true);
        }
        setMessage(want ? t('已开启。直接从 Steam 启动游戏即可。') : t('已关闭，原文件和启动项已恢复。'));
        toaster.toast({ title: 'Opti2XMX', body: want ? t('XMX 已开启') : t('XMX 已关闭') });
      } finally { await load(id); }
    });
  }
  const opti = info?.opti;
  const gameFsr = info?.fsr;
  const opti10Version = gameFsr?.opti_version || '10.0.0-pre1_20261025';
  const supportedVersions = [opti10Version,'0.9.4','0.7.9'];
  const version = session.versions[appid]
    || (opti?.version && supportedVersions.includes(opti.version) ? opti.version : '0.9.4');
  const source = downloadSource(version);
  const downgrade = !!opti?.version.startsWith('10.') && !version.startsWith('10.');
  const reprepareFsrVersion = version === opti10Version && !!gameFsr?.prepared && gameFsr.ready;
  const fsrReady = gameFsr?.ready ?? fsr?.ready ?? false;
  const fsrReason = gameFsr?.reason || fsr?.reason || '请导入本地 FSR 模型包。';
  const selectedSR = settings.sr;
  const migrateOpti = !!opti?.installed && !opti.incomplete;
  const installReason = !info?.prefix_ready ? '请先从 Steam 用 Proton 启动游戏一次，退出后重新打开插件。'
    : !executable ? '请先选择要运行的游戏程序。' : '';
  const optiPending = !!opti?.pending;
  const configBlocked = optiPending || !!opti?.settings_recovery;
  const overlayReason = !opti?.installed ? '请先为此游戏安装 Opti。'
    : opti.incomplete ? '请先修复此游戏的 Opti 安装。'
    : optiPending || pending ? '请先完成或恢复启动设置。'
    : opti.settings_recovery ? '请先恢复中断的设置。'
    : opti.injection_enabled === false ? '开启 Opti 注入并重新启动游戏后可用。' : '';
  async function toggleOpti(want: boolean) {
    await task(want ? t('正在开启 Opti 注入…') : t('正在关闭 Opti 注入，保留 XMX…'), async () => {
      try {
        const before = await readLaunch(appid);
        const next = unwrap(await optiToggle(appid, want, before));
        const actual = before === next.target ? before : await writeLaunch(appid, next.target, before);
        unwrap(await optiConfirm(appid, actual));
        setMessage(want ? t('Opti 注入已开启，下次启动生效。') : t('Opti 注入已关闭；XMX 设置保留，使用游戏原生功能。'));
      } finally { await load(appid); }
    });
  }
  function optiAction(kind: OptiAction) { return runOptiAction(appid, kind, version); }
  async function importFSRModel() {
    await task(t('正在选择 FSR 模型包…'), async () => {
      const picked = await openFilePicker(FileSelectionType.FILE, '/home/deck/Downloads', true, false, undefined, ['zip']);
      const path = picked?.realpath || picked?.path;
      if (!path) { setMessage(''); return; }
      if (!path.toLowerCase().endsWith('.zip')) throw new Error(t('请选择 ZIP 格式的 FSR 模型包。'));
      const status = unwrap(await fsrImport(path));
      setFsr(status);
      if (appid) await load(appid);
      setMessage(status.ready ? t('FSR 模型包已导入并验证。') : t(status.reason || 'FSR 模型包尚未就绪。'));
    });
  }
  const options = (items: [string,string][]) => items.map(([data,label])=>({data,label}));
  const versionControls = <>
    <DropdownItem layout="below" label={t('Opti 安装版本')} disabled={busy || configBlocked} selectedOption={version}
      description={opti?.version ? t('当前已安装：'+opti.version) : undefined}
      rgOptions={options([[opti10Version,t('10.0 预览版（FSR 4.1 XMX）')],['0.9.4',t('0.9.4（当前稳定版）')],['0.7.9',t('0.7.9（兼容旧版）')]])}
      onChange={v=>{const value=String(v.data);if(selection.appid===appid && supportedVersions.includes(value))
        updateSelection({...selection,versions:{...selection.versions,[appid]:value}});}} />
    <DropdownItem layout="below" label={t('下载源')} selectedOption={source} disabled={busy || configBlocked}
      description={t(session.cache[version]?.cached ? '已找到本地安装包，可直接安装。'
        : source==='local' ? '本地安装包不存在，请重新选择安装来源。' : '仅首次下载；之后所有游戏复用本地安装包。')}
      rgOptions={options([...(session.cache[version]?.cached || source==='local' ? [['local',t('从本地安装')]] as [string,string][] : []),
        ['github',t('GitHub 官方')],['ghfast',t('ghfast.top（第三方备用）')],['ghproxy',t('gh-proxy.com（第三方备用）')]])}
      onChange={v=>setSource(version,String(v.data))} />
  </>;
  const installDescription = installReason ? t(installReason) : active
    ? t('安装时自动暂时关闭 XMX，完成后恢复；请先退出游戏。')
    : downgrade ? t('安装旧版后 FSR 4.1 XMX 需要重新准备 Opti 10；保留回退备份。')
    : reprepareFsrVersion ? t('重新准备 Opti 10 和 FSR 组件，并重置超分与帧生成；之后重新选择 FSR。')
    : t('安装所选版本，保留回退备份；请先退出游戏。');
  const runtimeReady = runtime?.ready ? t('XMX 运行环境已就绪') : '';
  const runtimeControl = !runtime?.ready && <ButtonItem layout="below" disabled={busy || !runtime || !runtime.available || !!runtime.host_issue}
      description={runtime
        ? t(runtime.error || runtime.availability_message || runtime.host_issue || '下载后校验并配置到当前用户目录。')
        : t('正在检查 XMX 运行环境…')}
      onClick={() => task(t('正在下载并配置 XMX 运行环境…'), async () => {
        try {
          setRuntime(unwrap(await runtimeInstall()));
          setMessage(t('XMX 运行环境已配置。选择游戏后开启 XMX。'));
        } finally {
          setRuntime(unwrap(await runtimeStatus()));
          if (appid) await load(appid);
        }
      })}>{t('下载并配置 XMX 运行环境')}</ButtonItem>;
  const recoveryControls = <>
    {optiPending && <ButtonItem layout="below" disabled={busy || opti?.status==='recovery_required'} onClick={()=>optiAction('finish')}>{t('完成 Opti 启动设置')}</ButtonItem>}
    {pending && state?.status === 'pending_launch' && <ButtonItem layout="below" disabled={busy} onClick={() => toggle(true)}>{t('继续开启')}</ButtonItem>}
    {managed && (!active || pending) && <ButtonItem layout="below" disabled={busy} onClick={() => toggle(false)}>{t('恢复原配置')}</ButtonItem>}
    {opti?.rollback && (optiPending || !executable) && <ButtonItem layout="below"
      disabled={busy || managed || !!opti.settings_recovery} description={t('撤销未完成的 Opti 操作，保留原文件和回退记录。')}
      onClick={()=>optiAction('rollback')}>{t('回退上次操作')}</ButtonItem>}
    {!executable && opti?.settings_recovery && <ButtonItem layout="below" disabled={busy || optiPending}
      onClick={()=>task(t('正在撤销上次设置…'),async()=>{unwrap(await optiRestoreSettings(appid));await load(appid);})}>{t('恢复中断的设置')}</ButtonItem>}
  </>;
  return <PanelSection>
    {progressDisconnected && <PanelSectionRow><div role="status">{t('进度连接暂不可用，正在重试。')}</div></PanelSectionRow>}
    <DropdownItem label={t('游戏')} layout="below" disabled={busy} selectedOption={appid} strDefaultLabel={t('选择游戏')}
      description={t('打开时优先选择正在运行的游戏，也可手动切换。')}
      rgOptions={games.map(g => ({ data: g.appid, label: g.name }))} onChange={v => void select(Number(v.data), true)} />
    {info ? <>
      {!executable && <PanelSectionRow><div role="status">{t(needsChoice
        ? '先选择游戏主程序，确认后再显示安装和设置。'
        : reason || '未找到可用的游戏主程序，请检查游戏安装。')}</div></PanelSectionRow>}
      {needsChoice && !managed && <DropdownItem label={t('确认游戏程序')} layout="below" selectedOption={validManualExe}
        description={t('必选：选择实际运行的游戏主程序。')} disabled={busy}
        strDefaultLabel={t('请选择要运行的版本')} rgOptions={info.automatic.candidates.map(p => ({data:p,label:p}))}
        onChange={v => {
          const value = String(v.data), id = info.appid;
          if (selection.appid !== id || !info.executables.includes(value) || !info.automatic.candidates.includes(value)) return;
          updateSelection({...selection, executables:{...selection.executables,[id]:value}});
          if (mounted.current) setManualExe(value);
        }} />}
      {!!executable && <>
      {opti && !opti.managed && !optiPending && <>
        {!migrateOpti && versionControls}
        <ButtonItem layout="below" disabled={busy || !!installReason || configBlocked || pending}
          description={migrateOpti ? t('保留现有文件并建立回退备份。') : installDescription}
          onClick={()=>optiAction(migrateOpti?'migrate':'install')}>{migrateOpti?t('迁移现有 Opti')
            : opti.incomplete?t('修复并安装所选版本'):t('安装所选版本')}</ButtonItem>
      </>}
      <ToggleField label={t('XMX 加速')} checked={active} disabled={busy || blocked || pending || configBlocked}
        description={t(blocked ? reason || '请先选择要运行的游戏程序。' : '仅限 Intel；更改前请退出游戏。')} onChange={want => void toggle(want)} />
      {opti?.managed && <ToggleField label={t('Opti 注入')} checked={opti.injection_enabled} disabled={busy || pending || configBlocked}
        description={t('原生 XeSS 帧生成请关闭。')}
        onChange={want => void toggleOpti(want)} />}
      {opti?.installed && !opti.incomplete && <ButtonItem layout="below" disabled={busy || !!overlayReason}
        description={t(overlayReason || '游戏运行时可用；再次点击可关闭。')}
        onClick={() => task(t('正在切换 Opti 覆盖层…'), async () => {
          Navigation.CloseSideMenus(); unwrap(await optiPanel(appid)); setMessage(t('已发送覆盖层快捷键。'));
        })}>{t('打开 / 关闭 Opti 覆盖层')}</ButtonItem>}
      {runtimeControl}
      {(opti?.managed || opti?.rollback) && <>
        <ButtonItem layout="below" disabled={busy} description={[opti.version ? 'Opti '+opti.version : '', runtimeReady].filter(Boolean).join(' · ')} onClick={()=>updateSelection({...selection,advanced:{...selection.advanced,[appid]:!advanced}})}>{advanced?t('收起高级设置'):t('高级设置')}</ButtonItem>
        {advanced && <>
          {opti.managed && (opti.version.startsWith('0.9') || opti.version.startsWith('10.')) && <>
            <DropdownItem layout="below" label={t('超分输出')} disabled={busy || configBlocked} selectedOption={selectedSR}
              rgOptions={options(active ? [['xess','XeSS 2.0.2'],['fsr_xmx',t('FSR 4.1.2 Lite XMX')]]
                : [['xess','XeSS 2.0.2'],['fsr_xmx',t('FSR 4.1.2 Lite XMX')],['fsr31','FSR 3.1'],['fsr22','FSR 2.2'],['dlss',t('DLSS（需要支持的显卡）')]])}
              onChange={v=>void saveSettingsPatch(appid,{sr:String(v.data)})} />
            {!fsrReady && <ButtonItem layout="below" disabled={busy || configBlocked} description={t(fsrReason)}
              onClick={()=>void importFSRModel()}>{t('导入 FSR 模型包')}</ButtonItem>}
            {selectedSR==='fsr_xmx' && <>
              <PanelSectionRow><div style={{fontSize:13,lineHeight:1.5}}>
                <div role="status">{t(!fsrReady ? fsrReason
                  : gameFsr?.bridge_ready ? 'FSR 4.1.2 Lite XMX 已就绪；从 Steam 启动游戏即可。'
                  : '重新选择 FSR 后会自动准备此游戏并保存。')}</div>
                {!active && <div role="note">{t(gameFsr?.prepared
                  ? 'FSR 需要 XMX；重新选择 FSR 会自动开启 XMX。'
                  : '重新选择 FSR 会自动准备组件并开启 XMX。')}</div>}
              </div></PanelSectionRow>
            </>}
            <DropdownItem layout="below" label={t('帧生成输出')} disabled={busy || configBlocked} selectedOption={settings.fg}
              description={opti.injection_enabled ? undefined : t('开启 Opti 注入后生效。')}
              rgOptions={options([['native',t('游戏原生（不接管）')],['fsrfg',t('FSR 帧生成')],['xefg',t('XeSS 3 帧生成（实验）')]])}
              onChange={v=>void saveSettingsPatch(appid,{fg:String(v.data)})} />
            {settings.fg!=='fsrfg' && <SliderField label={t('插帧倍率')+((session.fgDraft?.appid===appid ? session.fgDraft.value===0 : settings.fg==='native')?' · '+t('游戏原生控制'):'')}
              disabled={sliderBusy || configBlocked} value={session.fgDraft?.appid===appid ? session.fgDraft.value : settings.fg==='native' ? 0 : Math.max(1,['native','2','3','4'].indexOf(settings.fg_multiplier || '2'))}
              min={0} max={3} step={1} validValues="steps" notchCount={4} notchTicksVisible showValue={false}
              notchLabels={[t('原生'),'2×','3×','4×'].map((label,notchIndex)=>({label,notchIndex}))}
              onChange={value=>scheduleMultiplier(appid,value)} />}
            {settings.fg!=='native' && <DropdownItem layout="below" label={t('游戏 FG 类型')} disabled={busy || configBlocked} selectedOption={settings.fg_input}
              description={t(settings.fg_input==='upscaler' ? '使用 Opti 插帧时，请先关闭游戏内插帧，避免冲突。' : '在游戏内开启所选类型的帧生成。')}
              rgOptions={options([['fsrfg30','FSR 3.0 FG'],['fsrfg','FSR 3.1 FG'],['dlssg','DLSS FG'],['upscaler',t('无原生 FG：使用超分输入')]])}
              onChange={v=>void saveSettingsPatch(appid,{fg_input:String(v.data)})} />}
            <DropdownItem layout="below" label={t('显卡伪装')} disabled={busy || active || configBlocked || selectedSR==='fsr_xmx'} selectedOption={selectedSR==='fsr_xmx'?'real':settings.spoof}
              description={active || selectedSR==='fsr_xmx'?t('XMX 开启时保留真实 Intel 身份。'):t('实验兼容选项；改身份不保证解锁功能。')}
              rgOptions={options([['real',t('真实显卡（推荐）')],['nvidia','NVIDIA'],['amd','AMD'],['intel','Intel Arc']])}
              onChange={v=>void saveSettingsPatch(appid,{spoof:String(v.data)})} />
            <ButtonItem layout="below" disabled={busy || optiPending || !!opti.settings_recovery} description={t('恢复 XeSS、真实显卡、由游戏管理帧生成；先退出游戏。')} onClick={()=>void saveSettingsPatch(appid,{},true)}>{t('恢复默认')}</ButtonItem>
            {(opti.settings_rollback || opti.settings_recovery) && <ButtonItem layout="below" disabled={busy || optiPending}
              description={t('恢复上次保存前的配置；保留安装回退记录。先退出游戏。')}
              onClick={()=>task(t('正在撤销上次设置…'),async()=>{unwrap(await optiRestoreSettings(appid));await load(appid);setMessage(t('已恢复上次保存前的设置，下次启动生效。'));})}>
              {opti.settings_recovery?t('恢复中断的设置'):t('撤销上次设置')}</ButtonItem>}
          </>}
          {opti.managed && <>{versionControls}
            <ButtonItem layout="below" disabled={busy || pending || configBlocked || !opti.injection_enabled || !!installReason}
              description={installDescription} onClick={()=>optiAction('install')}>{t('安装所选版本')}</ButtonItem>
          </>}
          {!optiPending && <ButtonItem layout="below" disabled={busy || managed || !!opti.settings_recovery || !opti.rollback} description={t('撤销上次安装、迁移或卸载；需先关闭 XMX。')} onClick={()=>optiAction('rollback')}>{t('回退上次操作')}</ButtonItem>}
          <ButtonItem layout="below" disabled={busy || managed || configBlocked || !opti.managed} description={t('卸载本插件管理的 Opti 文件并恢复原文件；需先关闭 XMX。')} onClick={()=>removeConfirm ? optiAction('uninstall') : setRemoveConfirm(true)}>{removeConfirm?t('确认卸载 Opti'):t('卸载 Opti')}</ButtonItem>
        </>}
      </>}
      </>}
      {recoveryControls}
      {visibleMessage && <PanelSectionRow><div role={visibleError ? 'alert' : 'status'} style={{fontSize:13,lineHeight:1.5}}>{t(visibleMessage)}</div></PanelSectionRow>}
    </> : <>{runtimeControl}<PanelSectionRow><div role="status" style={{fontSize:13,lineHeight:1.5}}>{t(visibleMessage)}</div></PanelSectionRow></>}
    {operation?.operation_id && (operation.appid === appid || operation.running || operation.kind === 'runtime_install') && <PanelSectionRow>
      <div role={operation.phase === 'failed' ? 'alert' : 'status'} style={{fontSize:13,lineHeight:1.5}}>
        {t(((operation.kind === 'runtime_install' ? {started:'正在准备 XMX 运行环境…',downloading:'正在下载 XMX 运行环境…',extracting:'正在解压 XMX 运行环境…',installing:'正在验证并配置 XMX 运行环境…',completed:'XMX 运行环境配置完成。',failed:'XMX 运行环境配置未完成。'} : {started:'正在准备 Opti…',downloading:'正在下载 Opti…','cache-hit':'正在复用 Opti 缓存…',extracting:'正在解压 Opti…',installing:'正在安装 Opti…','awaiting-launch':'Opti 已准备，等待确认启动设置。',completed:'Opti 操作已完成。',failed:'Opti 操作未完成。'}) as Record<string,string>)[operation.phase] || '正在处理 Opti 配置…')}
        {operation.downloaded_bytes > 0 && <> · {(operation.downloaded_bytes / 1048576).toFixed(1)} MiB
          {operation.total_bytes !== null && operation.total_bytes > 0 && operation.downloaded_bytes <= operation.total_bytes
            && <> / {(operation.total_bytes / 1048576).toFixed(1)} MiB · {(operation.downloaded_bytes * 100 / operation.total_bytes).toFixed(0)}%</>}</>}
        {operation.error && <> · {t(operation.error)}</>}
      </div>
    </PanelSectionRow>}
    {runtimeReady && !!executable && !(opti?.managed || opti?.rollback) && <PanelSectionRow><div role="status">{runtimeReady}</div></PanelSectionRow>}
  </PanelSection>;
}
export default definePlugin(() => ({
  name: 'Opti2XMX', titleView: <div className={staticClasses.Title}>Opti2XMX</div>,
  content: <Content />, icon: <span style={{ fontWeight: 700 }}>X</span>, onDismount() {
    cancelMultiplier();
  },
}));
