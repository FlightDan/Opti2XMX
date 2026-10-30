import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let current = '', writes = 0, unregisters = 0, cursor = 0, enableCalls = 0, rejectEnable = false;
const slots = [], effects = [], notifications = [], cleanups = [], timers = new Map();
const overlayEvents=[];
const progressTimeouts = new Map();
let savedSelection=null, timeoutId=0, inspectCount=0;
let runningGame;
let cacheStatus={};
let timerId=0, uiEpoch=0;
let operation={schema:1,instance_id:'backend-1',operation_id:null,appid:null,kind:'',version:'',phase:'completed',running:false,downloaded_bytes:0,total_bytes:null,error:null,revision:0};
let runtime={ready:false,available:true,version:'fixture',size_bytes:195433378,host_issue:'',error:'',availability_message:''};
let fsrStatusValue={ready:false,version:'',reason:'尚未导入 FSR 模型包。'};
let pickedFile={path:'/home/deck/Downloads/fsr-model.zip',realpath:'/home/deck/Downloads/fsr-model.zip'}, filePickerArgs=null;
const info = {appid:42,name:'Demo',executables:['game.exe','Launcher.exe'],libraries:[{path:'libxess.dll'}],optis:[],
  runtime_ready:true,prefix_ready:true,external_managed:false,state:null,
  fsr:{ready:false,prepared:false,bridge_ready:false,version:'',opti_version:'',reason:'尚未导入 FSR 模型包。'},
  automatic:{executable:'game.exe',route:'native',reason:'',candidates:['game.exe']}};
const copy = value => JSON.parse(JSON.stringify(value));
const methods = {
  settings_preflight: async () => ({ok:true,data:true}),
  opti_cache_status: async () => ({ok:true,data:copy(cacheStatus)}),
  runtime_status: async () => ({ok:true,data:copy(runtime)}),
  fsr_status: async () => ({ok:true,data:copy(fsrStatusValue)}),
  fsr_import: async path => ({ok:false,error:`unexpected FSR import: ${path}`}),
  fsr_prepare: async () => ({ok:false,error:'unexpected FSR preparation'}),
  operation_progress: async () => ({ok:true,data:copy(operation)}),
  inventory: async () => ({ok:true,data:[{appid:42,name:'Demo'}]}),
  inspect_game: async id => {inspectCount++;return {ok:true,data:{...copy(info),appid:id}};},
  enable: async (_id,exe,route,before) => {
    enableCalls++; assert.equal(exe,'game.exe'); assert.equal(route,'native');
    if(rejectEnable)return {ok:false,error:'游戏仍在运行，请退出后重试。'};
    info.state={status:'pending_launch',launch:'/test/launch %command%',old_launch:before};
    return {ok:true,data:copy(info.state)};
  },
  confirm_launch: async () => {
    info.state.status=info.state.status==='pending_restore_launch'?'restored':'active';
    if(info.state.status==='active'&&info.fsr?.prepared)info.fsr.bridge_ready=true;
    return {ok:true,data:copy(info.state)};
  },
  restore: async () => {info.state.status='pending_restore_launch';return {ok:true,data:copy(info.state)};},
};
const hook = init => {
  const epoch=uiEpoch;
  const n=cursor++;if(!(n in slots))slots[n]=init;
  return [slots[n],value=>{if(epoch===uiEpoch)slots[n]=value;}];
};
const jsx = (type,props) => ({type,props});
const context = vm.createContext({
  console,queueMicrotask,
  setTimeout:(fn,ms,...args)=>{if(ms===5000){const id='progress-'+(++timeoutId);progressTimeouts.set(id,fn);return id;}return setTimeout(fn,ms,...args);},
  clearTimeout:id=>{if(progressTimeouts.has(id))progressTimeouts.delete(id);else clearTimeout(id);},
  setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
  localStorage:{getItem:()=>savedSelection,setItem:(_key,value)=>{savedSelection=value;}},
  window:{__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit:{connect:()=>({
    _version:2,callable:name=>(...args)=>methods[name](...args),toaster:{toast:value=>notifications.push(value)},
    openFilePicker:async(...args)=>{filePickerArgs=args;return copy(pickedFile);},
  })}},
  SP_JSX:{jsx,jsxs:jsx,Fragment:'Fragment'},
  SP_REACT:{useState:hook,useRef:init=>hook({current:init})[0],useEffect:fn=>{
    const n=cursor++;if(!(n in slots)){slots[n]=true;effects.push(fn);}
  },useSyncExternalStore:(subscribe,getSnapshot)=>{
    const [value,setValue]=hook(getSnapshot());
    const n=cursor++;if(!(n in slots)){slots[n]=true;effects.push(()=>{
      setValue(getSnapshot());return subscribe(()=>setValue(getSnapshot()));
    });}
    return value;
  }},
  DFL:{staticClasses:{Title:'title'},PanelSection:'section',PanelSectionRow:'row',ButtonItem:'button',DropdownItem:'select',SliderField:'slider',ToggleField:'toggle',
    Navigation:{CloseSideMenus:()=>overlayEvents.push('close-side-menus')},
    Router:{get MainRunningApp(){if(runningGame instanceof Error)throw runningGame;return runningGame;}}},
  SteamClient:{Apps:{
    RegisterForAppDetails:(id,callback)=>{queueMicrotask(()=>callback(id,{strLaunchOptions:current}));return {unregister:()=>unregisters++};},
    SetAppLaunchOptions:(_id,value)=>{current=value;writes++;},
  }},
});
const source=fs.readFileSync(new URL('dist/index.js',import.meta.url),'utf8')
  .replace('export { index as default };','globalThis.testAPI={index,readLaunch,writeLaunch,Content,selectionSnapshot,updateSelection};');
vm.runInContext(source,context);
const api=context.testAPI;
function render(){cursor=0;return api.Content();}
function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.props?.children)];}
function toggle(){return nodes(render()).find(n=>n.type==='toggle').props;}
function textOf(node){if(node==null)return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return node.type==='br'?'\n':textOf(node.props?.children);}
async function settle(){for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,20));const session=api.selectionSnapshot();if(!slots[5]&&!session.settingsSave?.saving&&!session.actionBusy&&!session.fgDraft)return;}throw new Error('UI stayed busy');}
async function reopenUI(){
  clearUI();await mountUI();
}
assert.equal(api.index().name,'Opti2XMX');
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.equal(toggle().disabled,false);assert.equal(toggle().checked,false);
assert.equal(nodes(render()).filter(n=>n.type==='select').length,1,'normal flow only asks for game');
toggle().onChange(true);
assert.equal(toggle().disabled,true);
assert.ok(nodes(render()).some(n=>n.props?.role==='status'&&textOf(n).includes('正在开启 XMX')),'busy status must remain visible with loaded game info');
// Double activation is blocked before React can repaint.
toggle().onChange(true);await settle();
assert.equal(enableCalls,1);assert.equal(toggle().checked,true);assert.equal(writes,1);
assert.equal(current,'/test/launch %command%');
toggle().onChange(false);assert.equal(toggle().disabled,true);await settle();
assert.equal(toggle().checked,false);assert.equal(current,'');assert.equal(writes,2);
rejectEnable=true;toggle().onChange(true);await settle();
assert.equal(toggle().checked,false);assert.match(notifications.at(-1).body,/游戏仍在运行/);
assert.ok(nodes(render()).some(n=>n.props?.role==='alert'&&textOf(n).includes('游戏仍在运行')),'error must remain visible beyond its toast');
assert.ok(notifications.some(n=>n.title.includes('未完成')));
current='external %command%';
await assert.rejects(()=>api.writeLaunch(42,'overwrite','stale'),/刚被其他工具修改/);
assert.equal(writes,2);assert.ok(unregisters>=8);
console.log('PASS: automatic selection; toggle on/off; immediate progress; double-click guard; visible errors/toasts; Steam readback and conflict protection.');

current='';rejectEnable=false;
info.opti={managed:false,installed:false,version:'',status:'',rollback:false,settings:{sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real'}};
let installCount=0;
let releaseDownload;
methods.opti_install=async(id,exe,before,version,source)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(version,'0.9.4');assert.equal(source,'github');installCount++;
  operation={...operation,operation_id:'download-1',appid:42,kind:'opti_install',version,phase:'downloading',running:true,downloaded_bytes:1048576,total_bytes:2097152,revision:1};
  await new Promise(resolve=>{releaseDownload=resolve;});
  operation={...operation,phase:'awaiting-launch',running:false,revision:2};
  info.opti={...info.opti,managed:true,installed:true,version:'0.9.4',status:'pending_launch',rollback:true,
    pending:{expected:before,target:'/opti/launch %command%',kind:'install'}};
  return {ok:true,data:copy(info.opti.pending)};
};
methods.opti_confirm=async(_id,actual)=>{
  assert.equal(actual,info.opti.pending.target);info.opti.status='active';info.opti.pending=null;
  return {ok:true,data:true};
};
function button(label){return nodes(render()).find(n=>n.type==='button'&&n.props.children===label)?.props;}
info.runtime_ready=false;info.automatic.reason='XMX 运行组件未就绪。';
await reopenUI();
assert.equal(toggle().disabled,true);assert.equal(button('安装所选版本').disabled,false,'Opti install stays available without the XMX runtime');
const mainNodes=nodes(render());
assert.ok(mainNodes.findIndex(n=>n.type==='select'&&n.props.label==='游戏') < mainNodes.findIndex(n=>n.type==='button'&&n.props.children==='下载并配置 XMX 运行环境'));
assert.ok(mainNodes.findIndex(n=>n.props?.label==='Opti 安装版本') < mainNodes.findIndex(n=>n.type==='button'&&n.props.children==='安装所选版本'),'fresh install exposes all version choices before its action');
button('安装所选版本').onClick();await new Promise(resolve=>setTimeout(resolve,20));
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.match(textOf(render()),/正在下载 Opti/);assert.match(textOf(render()),/1\.0 MiB.*2\.0 MiB.*50%/);
assert.equal(button('安装所选版本').disabled,true);
operation={...operation,total_bytes:null,revision:2};
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.doesNotMatch(textOf(render()),/50%/,'unknown total must not invent a percentage');
releaseDownload();await settle();
operation={...operation,running:false,phase:'completed',revision:3};for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(installCount,1);assert.equal(current,'/opti/launch %command%');assert.ok(button('打开 / 关闭 Opti 覆盖层'));
info.runtime_ready=true;info.automatic.reason='';
assert.ok(button('收起高级设置'),'advanced settings should be open by default');
assert.ok(nodes(render()).some(n=>n.type==='slider' && n.props.label.startsWith('插帧倍率')),'FG multiplier must use a slider');
assert.equal(nodes(render()).find(n=>n.props?.label==='超分输出').props.description,undefined,'upscaling has no always-visible save hint');
assert.equal(nodes(render()).find(n=>n.type==='slider' && n.props.label.startsWith('插帧倍率')).props.description,undefined,'slider has no always-visible save hint');
assert.ok(button('卸载 Opti'));assert.ok(button('回退上次操作'));
const version=nodes(render()).find(n=>n.type==='select'&&n.props.label==='Opti 安装版本');
assert.equal(version.props.selectedOption,'0.9.4');
console.log('PASS: official 0.9.4 install action, Steam confirmation, panel button, advanced lifecycle controls.');

info.opti.injection_enabled=true;
methods.opti_toggle=async(id,want,before)=>{
  assert.equal(id,42);assert.equal(before,current);
  info.opti.injection_enabled=want;
  info.opti.pending={expected:before,target:before,kind:'toggle'};
  return {ok:true,data:copy(info.opti.pending)};
};
await reopenUI();
const optiToggle=()=>nodes(render()).find(n=>n.type==='toggle'&&n.props.label==='Opti 注入').props;
optiToggle().onChange(false);await settle();
assert.equal(optiToggle().checked,false);assert.equal(button('打开 / 关闭 Opti 覆盖层').disabled,true);
assert.equal(current,'/opti/launch %command%');
optiToggle().onChange(true);await settle();
assert.equal(optiToggle().checked,true);assert.ok(button('打开 / 关闭 Opti 覆盖层'));
console.log('PASS: independent Opti injection toggle and visible disabled overlay entry.');

context.document={documentElement:{lang:'en'}};
context.navigator={language:'zh-CN'};
const englishNodes=nodes(render());
const englishXmx=englishNodes.find(n=>n.props?.label==='XMX acceleration');
assert.ok(englishXmx);
assert.equal(textOf(englishXmx.props.description),'Intel only. Exit the game before changing.');
const englishOpti=englishNodes.find(n=>n.props?.label==='Opti injection');
assert.equal(textOf(englishOpti.props.description),'Turn off for native XeSS Frame Generation.');
assert.ok(button('Toggle Opti overlay'));assert.ok(button('Uninstall Opti'));
methods.opti_toggle=async()=>({ok:false,error:'游戏仍在运行。请从 Steam 退出游戏，再操作 XMX 开关。'});
englishOpti.props.onChange(false);await settle();
assert.match(notifications.at(-1).body,/game is still running/);
assert.equal(nodes(render()).find(n=>n.props?.label==='Opti injection').props.checked,true);
context.document.documentElement.lang='zh-cn';
assert.equal(textOf(toggle().description),'仅限 Intel；更改前请退出游戏。');
assert.equal(textOf(optiToggle().description),'原生 XeSS 帧生成请关闭。');
console.log('PASS: Steam language takes precedence; bilingual descriptions, controls and running-game error.');
// Discrete multiplier choices save the selected value, without drag intermediates.
const multiplier=()=>nodes(render()).find(n=>n.type==='slider'&&n.props.label.startsWith('插帧倍率'))?.props;
assert.equal(multiplier().value,0);
let settingsCalls=0,restoreSettingsCalls=0;
const launchBeforeSettings=current;
methods.opti_settings=async(id,value,reset)=>{
  settingsCalls++;assert.equal(id,42);assert.equal(reset,false);assert.equal(value.fg,settingsCalls<=2?'xefg':'native');
  assert.equal(value.fg_multiplier,['2','4','native'][settingsCalls-1]);
  info.opti.settings=copy(value);info.opti.settings_rollback=true;return {ok:true,data:true};
};
methods.opti_restore_settings=async(id)=>{
  restoreSettingsCalls++;assert.equal(id,42);info.opti.settings={sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real',fg_multiplier:'2'};
  info.opti.settings_rollback=false;info.opti.settings_recovery=false;return {ok:true,data:true};
};
assert.equal(button('保存设置'),undefined);
nodes(render()).find(n=>n.type==='select'&&n.props.label==='帧生成输出').props.onChange({data:'xefg'});await settle();
assert.equal(multiplier().value,1);
assert.equal(multiplier().notchLabels.map(x=>x.label).join(','),'原生,2×,3×,4×');
multiplier().onChange(3);await settle();
assert.equal(settingsCalls,2);assert.equal(multiplier().value,3);assert.ok(button('撤销上次设置'));
assert.equal(notifications.at(-1).body,'请重启游戏以应用更改。');
multiplier().onChange(0);await settle();
assert.equal(settingsCalls,3);assert.equal(multiplier().value,0,'native control persists after automatic saving');
context.document.documentElement.lang='en';
assert.ok(nodes(render()).some(n=>n.props?.label==='FG multiplier · Game controlled'));
assert.equal(nodes(render()).find(n=>n.props?.label==='FG multiplier · Game controlled').props.notchLabels[0].label,'Native');
assert.ok(button('Undo last settings change'));
context.document.documentElement.lang='zh-cn';
button('撤销上次设置').onClick();await settle();assert.equal(restoreSettingsCalls,1);assert.equal(multiplier().value,0);
assert.equal(current,launchBeforeSettings);
info.opti.settings_recovery=true;await reopenUI();
assert.equal(multiplier().disabled,true);
assert.equal(button('保存设置'),undefined);assert.equal(button('恢复默认').disabled,true);assert.ok(button('恢复中断的设置'));
assert.equal(toggle().disabled,true);assert.equal(optiToggle().disabled,true);assert.equal(button('安装所选版本').disabled,true);
assert.equal(button('恢复中断的设置').disabled,false);
button('恢复中断的设置').onClick();await settle();assert.equal(restoreSettingsCalls,2);
runtime.ready=true;await reopenUI();
assert.equal(button('XMX 运行环境已就绪'),undefined,'ready state is not a separate button');
assert.equal(button('收起高级设置').description,'Opti 0.9.4 · XMX 运行环境已就绪');
runtime.ready=false;
console.log('PASS: automatic FG/multiplier saving, four discrete choices, bilingual copy, persistence, independent undo/recovery and unchanged launch options.');
// Slider drags are coalesced across Steam menu remounts; only the final notch is saved.
let sliderWrites=[];
methods.opti_settings=async(id,value)=>{sliderWrites.push(copy(value));info.opti.settings=copy(value);return {ok:true,data:true};};
let sliderBefore=multiplier();
sliderBefore.onChange(1);sliderBefore.onChange(2);sliderBefore.onChange(3);
assert.equal(multiplier().value,3);assert.equal(sliderWrites.length,0);
clearUI();sliderBefore.onChange(2);sliderBefore.onChange(3);await mountUI();await settle();
assert.equal(sliderWrites.length,1);assert.equal(sliderWrites[0].fg_multiplier,'4');assert.equal(multiplier().value,3);
assert.equal(nodes(render()).find(n=>n.props?.label==='超分输出').props.rgOptions[0].label,'XeSS 2.0.2');
assert.ok(nodes(render()).find(n=>n.props?.label==='帧生成输出').props.rgOptions.some(x=>x.label==='XeSS 3 帧生成（实验）'));
button('收起高级设置').onClick();await reopenUI();assert.ok(button('高级设置'),'manual collapse survives menu remount');button('高级设置').onClick();
methods.settings_preflight=async()=>({ok:false,error:'游戏仍在运行，请退出后重试。'});
const beforeFailureNotifications=notifications.length;
multiplier().onChange(2);await settle();assert.equal(multiplier().value,3,'failed save restores persisted value');
assert.ok(nodes(render()).some(n=>n.props?.role==='alert'&&textOf(n).includes('游戏仍在运行')));
assert.equal(sliderWrites.length,1);assert.equal(notifications.length,beforeFailureNotifications+1);assert.match(notifications.at(-1).body,/游戏仍在运行/);await reopenUI();assert.equal(sliderWrites.length,1,'opening does not retry a failed change');
methods.settings_preflight=async()=>({ok:true,data:true});
for(const invalid of [-1,4,NaN,1.5]) multiplier().onChange(invalid);
assert.equal(api.selectionSnapshot().fgDraft,null);assert.equal(sliderWrites.length,1);
let finishSliderSave;
methods.opti_settings=async(id,value)=>{sliderWrites.push(copy(value));await new Promise(resolve=>{finishSliderSave=resolve;});info.opti.settings=copy(value);return {ok:true,data:true};};
multiplier().onChange(2);
api.updateSelection({...api.selectionSnapshot(),actionBusy:true});
await new Promise(resolve=>setTimeout(resolve,450));
assert.equal(sliderWrites.length,1,'busy work must defer the pending slider save');assert.equal(multiplier().value,2);
api.updateSelection({...api.selectionSnapshot(),actionBusy:false});
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(sliderWrites.length,2);assert.equal(multiplier().value,2,'thumb stays at requested value while saving');
finishSliderSave();await settle();assert.equal(multiplier().value,2);
methods.opti_settings=async(id,value)=>{sliderWrites.push(copy(value));info.opti.settings=copy(value);return {ok:true,data:true};};
let oldFgMenu=nodes(render()).find(n=>n.props?.label==='帧生成输出').props;
multiplier().onChange(3);oldFgMenu.onChange({data:'fsrfg'});await settle();
await new Promise(resolve=>setTimeout(resolve,450));
assert.equal(info.opti.settings.fg,'fsrfg','a later explicit FG selection must cancel an earlier slider intent');
assert.equal(sliderWrites.length,3,'cancelled slider must not issue a delayed write');
info.opti.settings={...info.opti.settings,fg:'xefg',fg_multiplier:'3'};await reopenUI();
const beforeNoopNotice=notifications.length;multiplier().onChange(2);await settle();
assert.equal(notifications.length,beforeNoopNotice,'no restart notice when the setting did not change');
context.document.documentElement.lang='en';
const englishSlider=nodes(render()).find(n=>n.type==='slider'&&n.props.label.startsWith('FG multiplier')).props;
englishSlider.onChange(3);await settle();assert.equal(notifications.at(-1).body,'Restart the game to apply your changes.');
context.document.documentElement.lang='zh-cn';
console.log('PASS: slider coalescing, menu remount, manual collapse, runtime refusal, no hidden retry, and version labels.');
// Reopening attaches to a backend operation without starting a second install.
for(const cleanup of cleanups)cleanup();cleanups.length=0;slots.length=0;effects.length=0;
operation={...operation,operation_id:'download-2',phase:'downloading',running:true,downloaded_bytes:3145728,total_bytes:null,revision:10};
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.match(textOf(render()),/3\.0 MiB/);assert.equal(optiToggle().disabled,true);assert.equal(installCount,1);
// Older responses cannot replace the active operation or attach another game's progress.
methods.operation_progress=async()=>({ok:true,data:{...operation,operation_id:'old',appid:99,downloaded_bytes:99*1048576,revision:9}});
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.doesNotMatch(textOf(render()),/99\.0 MiB/);assert.match(textOf(render()),/3\.0 MiB/);
methods.operation_progress=async()=>({ok:true,data:{...operation,running:false,phase:'failed',error:'fixture download failed',revision:11}});
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(nodes(render()).some(n=>n.props?.role==='alert'&&textOf(n).includes('fixture download failed')));
assert.equal(optiToggle().disabled,false);
// A backend-only restart can return revision zero and still refresh persisted state.
const beforeRestart=inspectCount;
operation={...operation,instance_id:'backend-2',operation_id:null,appid:null,running:false,phase:'completed',revision:0};
methods.operation_progress=async()=>({ok:true,data:copy(operation)});
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(inspectCount>beforeRestart,'backend epoch change must reload journal-backed game info');
// A terminal transition arriving during an existing load must be refreshed after that load releases its lock.
operation={...operation,operation_id:'pending-confirm',appid:42,phase:'awaiting-launch',revision:1};
info.opti.pending={expected:current,target:current,kind:'install'};info.opti.status='pending_launch';
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
const inspectOriginal=methods.inspect_game;
let releaseInspect;
methods.inspect_game=async id=>{const stale=await inspectOriginal(id);await new Promise(resolve=>{releaseInspect=resolve;});return stale;};
const pendingReopen=reopenUI();await new Promise(resolve=>setTimeout(resolve,20));
info.opti.pending=null;info.opti.status='active';
operation={...operation,phase:'completed',revision:2};
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
methods.inspect_game=inspectOriginal;releaseInspect();await pendingReopen;
assert.ok(button('完成 Opti 启动设置'),'fixture loads stale pending info before deferred refresh');
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(button('完成 Opti 启动设置'),undefined,'completed confirmation must refresh after local lock releases');
// A failed terminal refresh is retried on the next snapshot without repeating a mutation.
operation={...operation,phase:'awaiting-launch',revision:3};
info.opti.pending={expected:current,target:current,kind:'install'};info.opti.status='pending_launch';
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
await reopenUI();
assert.ok(button('完成 Opti 启动设置'));
info.opti.pending=null;info.opti.status='active';
let refreshFailures=1;
methods.inspect_game=async id=>{if(refreshFailures-- > 0)throw new Error('temporary inspect failure');return inspectOriginal(id);};
operation={...operation,phase:'completed',revision:4};
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(button('完成 Opti 启动设置'),'failed read retains pending UI until a successful refresh');
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(button('完成 Opti 启动设置'),undefined,'terminal refresh retries after a transient read failure');
methods.inspect_game=inspectOriginal;
// A stuck read-only RPC times out, retains the last running snapshot, and cannot apply a late reply.
operation={...operation,operation_id:'reconnect',phase:'downloading',running:true,downloaded_bytes:4194304,revision:5};
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
let lateReply;
methods.operation_progress=()=>new Promise(resolve=>{lateReply=resolve;});
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(progressTimeouts.size,1);
for(const timeout of [...progressTimeouts.values()])timeout();await new Promise(resolve=>setTimeout(resolve,20));
assert.match(textOf(render()),/进度连接暂不可用/);assert.match(textOf(render()),/4\.0 MiB/);assert.equal(optiToggle().disabled,true);
operation={...operation,instance_id:'backend-3',operation_id:null,appid:null,running:false,phase:'completed',revision:0};
methods.operation_progress=async()=>({ok:true,data:copy(operation)});
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.doesNotMatch(textOf(render()),/进度连接暂不可用/);assert.equal(optiToggle().disabled,false);
lateReply({ok:true,data:{...operation,instance_id:'backend-2',operation_id:'late',appid:42,running:true,phase:'downloading',downloaded_bytes:99*1048576,revision:99}});
await new Promise(resolve=>setTimeout(resolve,20));assert.doesNotMatch(textOf(render()),/99\.0 MiB/);assert.equal(optiToggle().disabled,false);
for(const cleanup of cleanups)cleanup();
console.log('PASS: byte/known-total progress, unknown-total fallback, visible busy/error, remount attachment, stale-poll refusal and failure unlock.');
// Completed historical operations do not override the user's saved game selection.
cleanups.length=0;slots.length=0;effects.length=0;savedSelection='43';
methods.inventory=async()=>({ok:true,data:[{appid:42,name:'Demo'},{appid:43,name:'Saved'}]});
operation={...operation,operation_id:'completed-old-game',appid:42,phase:'completed',revision:1};
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.equal(nodes(render()).find(n=>n.type==='select'&&n.props.label==='游戏').props.selectedOption,43);
for(const cleanup of cleanups)cleanup();
assert.equal(progressTimeouts.size,0);
console.log('PASS: backend epoch reconnect, deferred confirmation refresh, hung snapshot timeout/late-reply refusal and saved-game selection.');

// The global runtime button works without a game and never starts on mount.
cleanups.length=0;slots.length=0;effects.length=0;let runtimeCalls=0, finishRuntime;
methods.inventory=async()=>({ok:true,data:[]});
methods.runtime_install=async()=>{
  runtimeCalls++;
  operation={...operation,kind:'runtime_install',operation_id:'runtime-1',appid:null,phase:'downloading',running:true,downloaded_bytes:1048576,total_bytes:195433378,revision:2};
  await new Promise(resolve=>{finishRuntime=resolve;});
  runtime.ready=true;operation={...operation,running:false,phase:'completed',revision:3};
  return {ok:true,data:copy(runtime)};
};
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.equal(runtimeCalls,0);assert.match(textOf(button('下载并配置 XMX 运行环境').description),/下载后校验/);
button('下载并配置 XMX 运行环境').onClick();
button('下载并配置 XMX 运行环境').onClick();await new Promise(resolve=>setTimeout(resolve,20));
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(runtimeCalls,1);assert.match(textOf(render()),/正在下载 XMX 运行环境/);assert.match(textOf(render()),/1\.0 MiB/);
finishRuntime();await settle();assert.equal(button('XMX 运行环境已就绪'),undefined);
assert.equal(button('下载并配置 XMX 运行环境'),undefined);
assert.match(textOf(render()),/XMX 运行环境已配置/);
for(const cleanup of cleanups)cleanup();cleanups.length=0;slots.length=0;effects.length=0;
runtime={...runtime,ready:false,available:false,availability_message:'Pinned runtime release not published'};
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.equal(button('下载并配置 XMX 运行环境').disabled,true);assert.match(textOf(button('下载并配置 XMX 运行环境').description),/not published/);
for(const cleanup of cleanups)cleanup();
console.log('PASS: global explicit runtime action, no automatic download, size/progress/outcome, duplicate guard and unpublished-release state.');

// Real 0.2.5 reports: Control without a prefix; Death Stranding with leftover INI.
cleanups.length=0;slots.length=0;effects.length=0;savedSelection='42';
methods.inventory=async()=>({ok:true,data:[{appid:42,name:'Control'}]});
info.state=null;info.prefix_ready=false;
info.opti={managed:false,installed:false,incomplete:false,injection_enabled:false,version:'',status:'',rollback:false,settings:{sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real'}};
info.automatic={executable:'',route:'native',reason:'请先从 Steam 用 Proton 启动游戏一次，退出后重新打开插件。',candidates:['Control.exe','Control_DX11.exe','Control_DX12.exe']};
info.executables=[...info.automatic.candidates];
render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();
assert.equal(nodes(render()).find(n=>n.props?.label==='XMX 加速'),undefined);
assert.equal(button('安装所选版本'),undefined,'dependent install controls are hidden until an EXE is confirmed');
assert.match(textOf(render()),/先选择游戏主程序/);
let choice=nodes(render()).find(n=>n.props?.label==='确认游戏程序');
assert.ok(choice);assert.match(choice.props.description,/必选/);
choice.props.onChange({data:'Control_DX12.exe'});
assert.equal(button('安装所选版本').disabled,true,'manual EXE cannot bypass missing prefix');
assert.match(textOf(button('安装所选版本').description),/Proton/);
info.prefix_ready=true;info.automatic.reason='尚未发现 XeSS。请先为此游戏安装 OptiScaler 并运行一次，然后重新打开插件。';
await reopenUI();
nodes(render()).find(n=>n.props?.label==='确认游戏程序').props.onChange({data:'Control_DX12.exe'});
assert.equal(button('安装所选版本').disabled,false,'Opti install does not require XeSS');
assert.equal(toggle().disabled,true);assert.match(textOf(toggle().description),/尚未发现 XeSS/);
info.automatic={executable:'ds.exe',route:'opti',reason:'OptiScaler 文件不完整，需要同目录的 dxgi.dll 和 libxess.dll。',candidates:['ds.exe']};
info.executables=['ds.exe'];
info.opti={...info.opti,installed:true,incomplete:true};
await reopenUI();
assert.equal(button('迁移现有 Opti'),undefined);assert.equal(button('打开 / 关闭 Opti 覆盖层'),undefined);
assert.equal(button('修复并安装所选版本').disabled,false);
assert.match(textOf(button('修复并安装所选版本').description),/回退备份/);
let repairCalls=0;
methods.opti_install=async(id,exe)=>{assert.equal(id,42);assert.equal(exe,'ds.exe');repairCalls++;return {ok:false,error:'fixture repair rejected before mutation'};};
button('修复并安装所选版本').onClick();await settle();assert.equal(repairCalls,1);
info.state={status:'failed',old_launch:''};info.automatic.reason='';
await reopenUI();
assert.equal(button('修复并安装所选版本').disabled,false,'failed XMX journal cannot block installation');
assert.equal(toggle().disabled,false);
context.document.documentElement.lang='en';
assert.equal(button('Repair with the selected version').disabled,false);
assert.match(textOf(button('Repair with the selected version').description),/rollback backups/);
for(const cleanup of cleanups)cleanup();
console.log('PASS: Control prerequisites and executable selection, visible XMX reasons, incomplete Death Stranding repair, failed journal and English copy.');

// Native Steam dropdowns unmount Quick Access before invoking their callback.
function clearUI(){uiEpoch++;for(const cleanup of cleanups)cleanup();cleanups.length=0;slots.length=0;effects.length=0;}
async function mountUI(){render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}await settle();}
const exeChoice=()=>nodes(render()).find(n=>n.props?.label==='确认游戏程序')?.props;
const gameChoice=()=>nodes(render()).find(n=>n.props?.label==='游戏')?.props;
clearUI();context.document.documentElement.lang='zh-cn';savedSelection='42';
methods.inventory=async()=>({ok:true,data:[{appid:42,name:'Control'},{appid:43,name:'Another game'}]});
info.state=null;info.prefix_ready=true;info.executables=['Control.exe','Control_DX11.exe','Control_DX12.exe'];
info.automatic={executable:'',route:'native',reason:'尚未发现 XeSS。请先为此游戏安装 OptiScaler 并运行一次，然后重新打开插件。',candidates:[...info.executables]};
info.opti={...info.opti,installed:false,incomplete:false,managed:false,pending:null};
await mountUI();const originalExeMenu=exeChoice();
clearUI();originalExeMenu.onChange({data:'Control_DX12.exe'});await mountUI();
assert.equal(exeChoice().selectedOption,'Control_DX12.exe','native callback after unmount survives remount');
assert.equal(button('安装所选版本').disabled,false);
await reopenUI();assert.equal(exeChoice().selectedOption,'Control_DX12.exe');
clearUI();await mountUI();originalExeMenu.onChange({data:'Control_DX11.exe'});
assert.equal(exeChoice().selectedOption,'Control_DX11.exe','late old-instance callback notifies the already-mounted instance');
for(const invalid of ['/tmp/evil.exe','../evil.exe','unknown.exe'])originalExeMenu.onChange({data:invalid});
assert.equal(exeChoice().selectedOption,'Control_DX11.exe','arbitrary paths cannot enter selection');
info.executables=['Control.exe','Control_DX12.exe'];info.automatic.candidates=[...info.executables];
await reopenUI();
assert.equal(exeChoice().selectedOption,'','removed candidate is invalidated');assert.equal(button('安装所选版本'),undefined);
exeChoice().onChange({data:'Control_DX12.exe'});
let nativeInstallCalls=0;
methods.opti_install=async(id,exe)=>{assert.equal(id,42);assert.equal(exe,'Control_DX12.exe');nativeInstallCalls++;return {ok:false,error:'fixture stopped before mutation'};};
button('安装所选版本').onClick();await settle();assert.equal(nativeInstallCalls,1);
const oldGameMenu=gameChoice();clearUI();oldGameMenu.onChange({data:43});
assert.equal(savedSelection,'43','game selection is saved synchronously before async inspection');
await mountUI();assert.equal(gameChoice().selectedOption,43);assert.equal(exeChoice().selectedOption,'','EXE never leaks across appids');
originalExeMenu.onChange({data:'Control_DX12.exe'});assert.equal(exeChoice().selectedOption,'','late previous-game callback cannot change this game');
clearUI();
console.log('PASS: native-menu unmount/callback/remount, late callback subscription, refresh/invalidation, appid isolation and real selected-EXE RPC.');

// Source callbacks must survive the same Steam native-menu lifecycle as EXE choices.
savedSelection='42';
info.automatic={executable:'game.exe',route:'native',reason:'',candidates:['game.exe']};
info.executables=['game.exe'];info.state=null;
const sourceChoice=()=>nodes(render()).find(n=>n.type==='select'&&n.props.label==='下载源')?.props;
for(const managedSource of [false,true]) {
  info.opti={managed:managedSource,installed:managedSource,incomplete:false,version:'0.9.4',status:managedSource?'active':'',injection_enabled:true,rollback:false,settings:{sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real'}};
  for(const wanted of ['ghfast','ghproxy','github']) {
    clearUI();await mountUI();
    if(managedSource)button('高级设置')?.onClick();
    const menu=sourceChoice();
    clearUI();menu.onChange({data:wanted});await mountUI();
    if(managedSource)button('高级设置')?.onClick();
    assert.equal(sourceChoice().selectedOption,wanted,'source survives callback while unmounted');
    // A late callback must also notify a replacement instance that is already mounted.
    menu.onChange({data:'ghfast'});assert.equal(sourceChoice().selectedOption,'ghfast');
    menu.onChange({data:wanted});
    for(const invalid of ['github-api','https://evil.invalid/','unknown',''])menu.onChange({data:invalid});
    assert.equal(sourceChoice().selectedOption,wanted,'unknown source never enters session');
    await reopenUI();assert.equal(sourceChoice().selectedOption,wanted);
    let received=null;
    methods.opti_install=async(...args)=>{received=args.at(-1);return {ok:false,error:'fixture stopped before mutation'};};
    button('安装所选版本').onClick();await settle();
    assert.equal(received,wanted,'install RPC uses selected source after native menu remount');
    clearUI();await mountUI();
    if(managedSource)button('高级设置')?.onClick();
    assert.equal(sourceChoice().selectedOption,wanted,'failed download and reopening preserve source');
  }
}
clearUI();
console.log('PASS: all three download sources, both install entries, native-menu remount/late callbacks, invalid choices, refresh, failed-download retry and RPC source.');

// FSR-XMX refuses missing resources without displaying an unsaved selection.
const srChoice=()=>nodes(render()).find(n=>n.type==='select'&&n.props.label==='超分输出')?.props;
const srSettings={sr:'xess',fg:'xefg',fg_input:'fsrfg30',spoof:'real',fg_multiplier:'3'};
savedSelection='42';current='';info.state=null;info.executables=['game.exe'];
info.automatic={executable:'game.exe',route:'native',reason:'',candidates:['game.exe']};
info.opti={managed:true,installed:true,incomplete:false,injection_enabled:true,version:'0.9.4',status:'active',rollback:false,pending:null,
  settings:copy(srSettings),settings_recovery:false};
info.fsr={ready:false,prepared:false,bridge_ready:false,version:'',opti_version:'',reason:'尚未导入 FSR 模型包。'};
fsrStatusValue={ready:false,version:'',reason:'尚未导入 FSR 模型包。'};
clearUI();await mountUI();button('高级设置')?.onClick();
let menu=srChoice();assert.ok(menu);assert.ok(menu.rgOptions.some(item=>item.data==='fsr_xmx'),'FSR-XMX remains selectable before model import');
assert.equal(menu.rgOptions.map(item=>item.data).join(','),'xess,fsr_xmx,fsr31,fsr22,dlss','inactive XMX keeps legacy upscalers');
clearUI();menu.onChange({data:'fsr_xmx'});await mountUI();button('高级设置')?.onClick();
assert.equal(srChoice().selectedOption,'xess','failed autosave retains the actual saved selection');
assert.match(textOf(render()),/尚未导入 FSR 模型包/);assert.equal(button('保存设置'),undefined);
assert.equal(button('导入 FSR 模型包').disabled,false);
assert.equal(srChoice().description,undefined);
context.document.documentElement.lang='en';
assert.ok(nodes(render()).find(n=>n.type==='select'&&n.props.label==='Upscaling output').props.rgOptions.some(item=>item.label==='FSR 4.1.2 Lite XMX'));
assert.ok(button('Import FSR model package'));
context.document.documentElement.lang='zh-cn';
let importedPath='',importCalls=0;
methods.fsr_import=async path=>{
  importedPath=path;importCalls++;fsrStatusValue={ready:true,version:'4.1.2',reason:''};
  info.fsr={...info.fsr,ready:true,version:'4.1.2',reason:''};return {ok:true,data:copy(fsrStatusValue)};
};
pickedFile={path:'/home/deck/Downloads/not-a-model.txt',realpath:'/home/deck/Downloads/not-a-model.txt'};
button('导入 FSR 模型包').onClick();await settle();
assert.equal(importCalls,0,'a non-ZIP selection never reaches the import RPC');
assert.match(textOf(render()),/请选择 ZIP 格式的 FSR 模型包/);
pickedFile={path:'/home/deck/Downloads/fsr-model.zip',realpath:'/home/deck/Downloads/fsr-model.zip'};
button('导入 FSR 模型包').onClick();await settle();
assert.equal(importCalls,1);assert.equal(importedPath,'/home/deck/Downloads/fsr-model.zip');
assert.equal(filePickerArgs[0],0,'native picker uses FILE selection');assert.equal(filePickerArgs[1],'/home/deck/Downloads');
assert.equal(filePickerArgs[5].join(','),'zip','picker filters to ZIP files');
assert.equal(button('导入 FSR 模型包'),undefined);assert.equal(button('保存设置'),undefined);
assert.equal(srChoice().selectedOption,'xess','importing a model does not retry a previously rejected choice');

// An active old XMX setup is restored and confirmed before Opti 10 prep, then re-enabled with the FSR bridge.
const fsrCalls=[];let savedFsrSettings=null;
let expectedSr='fsr_xmx';
current='/old-xmx/launch %command%';info.state={status:'active',launch:current,old_launch:''};
info.fsr={ready:true,prepared:false,bridge_ready:false,version:'4.1.2',opti_version:'',reason:''};
info.opti={...info.opti,version:'0.9.4',settings:copy(srSettings)};
await reopenUI();
assert.equal(srChoice().rgOptions.map(item=>item.data).join(','),'xess,fsr_xmx','active XMX exposes only XeSS and FSR-XMX');
methods.restore=async(id,actual)=>{assert.equal(id,42);assert.equal(actual,current);fsrCalls.push('restore');info.state.status='pending_restore_launch';return {ok:true,data:copy(info.state)};};
methods.confirm_launch=async(id,actual)=>{
  assert.equal(id,42);assert.equal(actual,current);fsrCalls.push('confirm_launch');
  info.state.status=info.state.status==='pending_restore_launch'?'restored':'active';
  if(info.state.status==='active'&&info.fsr?.prepared)info.fsr.bridge_ready=true;
  return {ok:true,data:copy(info.state)};
};
methods.fsr_prepare=async(id,exe,actual,downloadSource)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(actual,'');assert.ok(['github','ghfast','ghproxy'].includes(downloadSource));
  assert.equal(info.state.status,'restored','prepare runs only after XMX restore confirmation');fsrCalls.push('fsr_prepare');
  info.fsr={...info.fsr,prepared:true,opti_version:'10.0.1',bridge_ready:false};
  info.opti={...info.opti,version:'10.0.1',pending:{expected:actual,target:'/opti10/launch %command%',kind:'fsr_prepare'}};
  return {ok:true,data:copy(info.opti.pending)};
};
methods.opti_confirm=async(_id,actual)=>{
  assert.equal(actual,'/opti10/launch %command%');fsrCalls.push('opti_confirm');info.opti.pending=null;return {ok:true,data:true};
};
methods.enable=async(_id,exe,route,before)=>{
  assert.equal(exe,'game.exe');assert.equal(route,'native');assert.equal(before,'/opti10/launch %command%');fsrCalls.push('enable');
  info.state={status:'pending_launch',launch:'/xmx-fsr/launch %command%',old_launch:before};return {ok:true,data:copy(info.state)};
};
methods.opti_settings=async(id,value,reset)=>{
  assert.equal(id,42);assert.equal(reset,false);assert.equal(value.sr,expectedSr);assert.equal(value.spoof,'real');
  assert.equal(value.fg,'xefg');assert.equal(value.fg_input,'fsrfg30');assert.equal(value.fg_multiplier,'3');
  fsrCalls.push('opti_settings');savedFsrSettings=copy(value);info.opti.settings=copy(value);return {ok:true,data:true};
};
srChoice().onChange({data:'fsr_xmx'});await settle();
assert.deepEqual(fsrCalls,['restore','confirm_launch','fsr_prepare','opti_confirm','enable','confirm_launch','opti_settings']);
assert.equal(savedFsrSettings.sr,'fsr_xmx');assert.equal(current,'/xmx-fsr/launch %command%');
assert.equal(info.fsr.bridge_ready,true);assert.equal(info.opti.version,'10.0.1');

// Once prepared, changing between XeSS and FSR edits settings only; an inactive setup auto-enables XMX.
fsrCalls.length=0;expectedSr='xess';srChoice().onChange({data:'xess'});await settle();
assert.deepEqual(fsrCalls,['opti_settings'],'XeSS switch does not rebuild the wrapper');assert.equal(savedFsrSettings.sr,'xess');
fsrCalls.length=0;expectedSr='fsr_xmx';srChoice().onChange({data:'fsr_xmx'});await settle();
assert.deepEqual(fsrCalls,['opti_settings'],'prepared bridge switches back to FSR without reinstall');
info.state.status='restored';current=info.state.old_launch;info.fsr.bridge_ready=false;info.opti.settings.sr='xess';await reopenUI();
fsrCalls.length=0;expectedSr='fsr_xmx';srChoice().onChange({data:'fsr_xmx'});await settle();
assert.deepEqual(fsrCalls,['enable','confirm_launch','opti_settings'],'prepared FSR automatically enables XMX when it was off');
assert.equal(info.state.status,'active');assert.equal(info.fsr.bridge_ready,true);
clearUI();
console.log('PASS: FSR-XMX option visibility, local ZIP import, selection remount, transactional prepare/restore/enable, XeSS/FSR switches, FG preservation and automatic XMX enable.');

// Opening prefers Steam's current game while explicit choices survive native menus.
const beforeAutoWrites=writes, beforeAutoEnable=enableCalls;
savedSelection='43';runningGame={appid:'42',display_name:'Control'};
operation={...operation,operation_id:null,appid:null,running:false,phase:'completed',revision:operation.revision+1};
methods.inventory=async()=>({ok:true,data:[{appid:42,name:'Control'},{appid:43,name:'Another game'}]});
clearUI();await mountUI();
assert.equal(gameChoice().selectedOption,42,'running game takes priority over the saved game');
assert.match(gameChoice().description,/正在运行的游戏/);
assert.equal(button('刷新'),undefined);assert.equal(button('刷新游戏状态'),undefined);
const readCounts={}, originalReads={};
for(const name of ['inventory','inspect_game','runtime_status','fsr_status']) {
  originalReads[name]=methods[name];readCounts[name]=0;
  methods[name]=async(...args)=>{readCounts[name]++;return originalReads[name](...args);};
}
await reopenUI();
for(const name of Object.keys(readCounts))assert.ok(readCounts[name]>0,`opening rereads ${name}`);
context.document.documentElement.lang='en';
assert.equal(button('Refresh'),undefined);assert.equal(button('Refresh game status'),undefined);
assert.match(nodes(render()).find(n=>n.type==='select'&&n.props.label==='Game').props.description,/running game/);
context.document.documentElement.lang='zh-cn';
const runningGameMenu=gameChoice();clearUI();runningGameMenu.onChange({data:43});await mountUI();
assert.equal(gameChoice().selectedOption,43,'manual choice survives native-dropdown unmount while another game is running');
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(gameChoice().selectedOption,43,'progress polling does not steal manual selection');
clearUI();await mountUI();assert.equal(gameChoice().selectedOption,43,'reopening preserves the manual choice for the same running game');
runningGame={appid:'43',display_name:'Another game'};
clearUI();await mountUI();assert.equal(gameChoice().selectedOption,43,'a different running game supersedes the previous manual override');
runningGame={appid:'42',display_name:'Control'};
clearUI();await mountUI();assert.equal(gameChoice().selectedOption,42,'returning to the previous running game cannot revive a stale manual choice');
runningGame={appid:'43',display_name:'Another game'};
for(const phase of ['downloading','awaiting-launch']) {
  operation={...operation,operation_id:'reattach-current',appid:42,running:phase==='downloading',phase,revision:operation.revision+1};
  clearUI();await mountUI();
  assert.equal(gameChoice().selectedOption,42,'unfinished operation takes priority over the running game');
}
operation={...operation,running:false,phase:'completed',revision:operation.revision+1};
clearUI();await mountUI();assert.equal(gameChoice().selectedOption,43,'historical operations do not override the running game');
for(const unavailable of [undefined,{appid:'777'}, {appid:'invalid'},new Error('Steam router unavailable')]) {
  runningGame=unavailable;savedSelection='42';clearUI();await mountUI();
  assert.equal(gameChoice().selectedOption,42,'unsupported or unavailable running-game data falls back to saved selection');
}
assert.equal(writes,beforeAutoWrites,'automatic selection and reopening never change Steam launch options');
assert.equal(enableCalls,beforeAutoEnable,'automatic selection never enables XMX');
for(const name of Object.keys(originalReads))methods[name]=originalReads[name];
clearUI();runningGame=undefined;
console.log('PASS: running-game priority, manual-menu selection and invalidation, operation reattachment, safe fallback and automatic refresh on every open without a refresh button.');

// The overlay entry is visible on the main page and sends the selected game's
// shortcut after closing QAM, without enabling XMX or changing launch options.
const overlayLabel='打开 / 关闭 Opti 覆盖层';
const readyOverlay={managed:true,installed:true,incomplete:false,injection_enabled:true,version:'0.9.4',status:'active',
  rollback:false,pending:null,settings_recovery:false,settings:copy(srSettings)};
savedSelection='42';current='';info.state=null;info.opti=copy(readyOverlay);
await mountUI();
assert.ok(button('收起高级设置'),'advanced settings default to expanded');
assert.equal(button(overlayLabel).disabled,false,'overlay is available without XMX enabled');
assert.match(button(overlayLabel).description,/再次点击可关闭/);
gameChoice().onChange({data:43});await settle();
let overlayCalls=0;
methods.opti_panel=async id=>{overlayCalls++;overlayEvents.push(`opti-panel:${id}`);return {ok:true,data:true};};
const beforeOverlayWrites=writes,beforeOverlayEnable=enableCalls;
button(overlayLabel).onClick();button(overlayLabel).onClick();await settle();
assert.equal(overlayCalls,1,'repeated activation is blocked until the shortcut call finishes');
assert.deepEqual(overlayEvents,['close-side-menus','opti-panel:43'],'close the sidebar before targeting the selected game');
assert.match(textOf(render()),/已发送覆盖层快捷键/);
methods.opti_panel=async()=>({ok:false,error:'请先启动选中的游戏，再打开面板'});
button(overlayLabel).onClick();await settle();
assert.match(notifications.at(-1).body,/请先启动选中的游戏/);
context.document.documentElement.lang='en';
assert.equal(button('Toggle Opti overlay').disabled,false);
assert.match(button('Toggle Opti overlay').description,/Press again to close/);
button('Toggle Opti overlay').onClick();await settle();
assert.match(notifications.at(-1).body,/Start the selected game/);
context.document.documentElement.lang='zh-cn';
for(const [state, changes, explanation] of [
  [null,{installed:false},/先为此游戏安装 Opti/],
  [null,{incomplete:true},/修复此游戏的 Opti 安装/],
  [null,{injection_enabled:false},/开启 Opti 注入并重新启动游戏/],
  [null,{pending:{expected:'',target:'',kind:'install'}},/完成或恢复启动设置/],
  [null,{settings_recovery:true},/恢复中断的设置/],
  [{status:'pending_launch',old_launch:'',launch:'pending %command%'},{},/完成或恢复启动设置/],
]) {
  info.state=state;info.opti={...copy(readyOverlay),...changes};await reopenUI();
  if(changes.installed===false || changes.incomplete) {
    assert.equal(button(overlayLabel),undefined,'overlay is hidden until a complete Opti installation exists');
    continue;
  }
  assert.equal(button(overlayLabel).disabled,true,'unavailable overlay remains discoverable');
  assert.match(button(overlayLabel).description,explanation,'disabled state explains how to make the overlay available');
}
assert.equal(writes,beforeOverlayWrites,'overlay does not modify launch options');
assert.equal(enableCalls,beforeOverlayEnable,'overlay does not enable XMX');
clearUI();
console.log('PASS: visible overlay entry, prerequisites, selected-game RPC, sidebar close ordering, duplicate guard, bilingual errors and unchanged game configuration.');

// Native-menu autosave retains one shared operation and authoritative settings
// across unmounts; rejected choices never become queued work.
info.state={status:'active',launch:'/autosave/launch %command%',old_launch:''};current=info.state.launch;
info.fsr={ready:true,prepared:true,bridge_ready:true,version:'4.1.2',opti_version:'10.0.1',reason:''};
info.opti={...copy(readyOverlay),version:'10.0.1',settings:copy(srSettings)};
savedSelection='42';await mountUI();button('高级设置')?.onClick();
let settingsBlocked=true,preflightCalls=0;
const savedPatches=[];
methods.settings_preflight=async()=>{preflightCalls++;return settingsBlocked
  ? {ok:false,error:'游戏正在运行，请先退出游戏再更改设置。'} : {ok:true,data:true};};
methods.opti_settings=async(id,value)=>{savedPatches.push({id,value:copy(value)});info.opti.settings=copy(value);return {ok:true,data:true};};
let autoMenu=srChoice();clearUI();autoMenu.onChange({data:'fsr_xmx'});await mountUI();button('高级设置')?.onClick();
assert.equal(srChoice().selectedOption,'xess','running rejection displays persisted SR, not the rejected choice');
assert.equal(savedPatches.length,0);assert.match(textOf(render()),/先退出游戏再更改设置/);
context.document.documentElement.lang='en';assert.match(textOf(render()),/Exit it before changing settings/);
assert.equal(button('Save settings'),undefined);context.document.documentElement.lang='zh-cn';
settingsBlocked=false;await reopenUI();for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(savedPatches.length,0,'game exit, reopen and progress polling never retry the rejected choice');
assert.equal(preflightCalls,1);

let releaseAutoSave;
methods.opti_settings=async(id,value)=>{savedPatches.push({id,value:copy(value)});await new Promise(resolve=>{releaseAutoSave=resolve;});info.opti.settings=copy(value);return {ok:true,data:true};};
autoMenu=srChoice();clearUI();autoMenu.onChange({data:'fsr_xmx'});
const mountingDuringSave=mountUI();
for(let n=0;n<50&&!releaseAutoSave;n++)await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(releaseAutoSave);assert.equal(button(overlayLabel).disabled,true,'replacement component shares autosave busy state');
autoMenu.onChange({data:'xess'});assert.equal(savedPatches.length,1,'second callback does not queue a write');
releaseAutoSave();await mountingDuringSave;button('高级设置')?.onClick();
assert.equal(srChoice().selectedOption,'fsr_xmx');
assert.deepEqual(savedPatches[0].value,{...srSettings,sr:'fsr_xmx'},'SR patch preserves persisted FG, input, multiplier and identity');
assert.equal(button('保存设置'),undefined);

// A stale read started by remount cannot overwrite the final save readback.
methods.opti_settings=async(id,value)=>{savedPatches.push({id,value:copy(value)});info.opti.settings=copy(value);return {ok:true,data:true};};
info.opti.settings=copy(srSettings);await reopenUI();autoMenu=srChoice();clearUI();
const normalInspect=methods.inspect_game;
let releaseStaleRead,deferOneRead=true;
methods.inspect_game=async id=>{const result=await normalInspect(id);if(deferOneRead){deferOneRead=false;await new Promise(resolve=>{releaseStaleRead=resolve;});}return result;};
const mountingStale=mountUI();
for(let n=0;n<50&&!releaseStaleRead;n++)await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(releaseStaleRead);autoMenu.onChange({data:'fsr_xmx'});
for(let n=0;n<50&&api.selectionSnapshot().settingsSave?.saving;n++)await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(api.selectionSnapshot().snapshots[42].info.opti.settings.sr,'fsr_xmx');
releaseStaleRead();await mountingStale;methods.inspect_game=normalInspect;button('高级设置')?.onClick();
assert.equal(srChoice().selectedOption,'fsr_xmx','older mount result cannot publish its XeSS snapshot over saved FSR');

// Ordinary multi-RPC actions and settings saves share ownership in both directions.
let releaseOverlayAction;
methods.opti_panel=async()=>{await new Promise(resolve=>{releaseOverlayAction=resolve;});return {ok:true,data:true};};
autoMenu=srChoice();const writesBeforeBusy=savedPatches.length,checksBeforeBusy=preflightCalls;
button(overlayLabel).onClick();await new Promise(resolve=>setTimeout(resolve,20));
autoMenu.onChange({data:'xess'});
assert.equal(preflightCalls,checksBeforeBusy,'late native callback cannot start during another action');
releaseOverlayAction();await settle();assert.equal(savedPatches.length,writesBeforeBusy);
for(const invalid of ['unknown','https://invalid/',''])autoMenu.onChange({data:invalid});
assert.equal(preflightCalls,checksBeforeBusy,'invalid choices never reach the preflight RPC');
gameChoice().onChange({data:43});await settle();autoMenu.onChange({data:'xess'});
assert.equal(preflightCalls,checksBeforeBusy,'previous-game callback cannot change the newly selected game');
clearUI();
console.log('PASS: native-menu autosave, running refusal without hidden retry, persisted patch merge, shared busy ownership, stale-read ordering and invalid/previous-game refusal.');

// The installation target reflects the installed Opti 10 and survives native
// version menus. Explicit downgrade remains separate from saved game settings.
const pinned10='10.0.0-pre1_20261025';
savedSelection='42';current='/version-menu/launch %command%';
info.state={status:'active',launch:current,old_launch:''};
info.opti={...copy(readyOverlay),version:pinned10,settings:copy(srSettings)};
info.fsr={ready:true,prepared:true,bridge_ready:true,version:'4.1.2',opti_version:pinned10,reason:''};
await mountUI();button('高级设置')?.onClick();
const versionChoice=()=>nodes(render()).find(n=>n.props?.label==='Opti 安装版本')?.props;
assert.equal(versionChoice().selectedOption,pinned10,'installed10 is the default installation target');
assert.equal(versionChoice().rgOptions.map(option=>option.data).join(','),`${pinned10},0.9.4,0.7.9`);
assert.match(versionChoice().description,/当前已安装：10/);
assert.equal(button('安装所选版本').disabled,false,'active XMX is handled by the install flow');
let versionMenu=versionChoice();clearUI();versionMenu.onChange({data:'0.9.4'});await mountUI();button('高级设置')?.onClick();
assert.equal(versionChoice().selectedOption,'0.9.4','explicit version target survives native menu remount');
assert.match(button('安装所选版本').description,/自动暂时关闭 XMX/);
assert.equal(info.opti.version,pinned10,'changing the target does not install or downgrade');
versionMenu=versionChoice();clearUI();versionMenu.onChange({data:pinned10});await mountUI();button('高级设置')?.onClick();
assert.equal(versionChoice().selectedOption,pinned10);
for(const invalid of ['10-latest','unknown',''])versionChoice().onChange({data:invalid});
assert.equal(versionChoice().selectedOption,pinned10,'unknown versions cannot enter the session');
context.document.documentElement.lang='en';
const englishVersion=nodes(render()).find(n=>n.props?.label==='Opti install version').props;
assert.match(englishVersion.description,/Currently installed: 10/);
context.document.documentElement.lang='zh-cn';
info.state.status='restored';current=info.state.old_launch;info.fsr.bridge_ready=false;await reopenUI();
let fsrReinstalls=0,versionConfirms=0;
methods.opti_install=async()=>{throw new Error('prepared FSR10 must not use a plain install');};
methods.fsr_prepare=async(id,exe,before,source)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(before,current);assert.ok(['github','ghfast','ghproxy'].includes(source));
  fsrReinstalls++;info.opti.settings={...copy(srSettings),sr:'xess',fg:'native',fg_multiplier:'native'};
  info.opti.pending={expected:before,target:before,kind:'fsr_prepare'};return {ok:true,data:copy(info.opti.pending)};
};
methods.opti_confirm=async(id,actual)=>{assert.equal(id,42);assert.equal(actual,current);versionConfirms++;info.opti.pending=null;return {ok:true,data:true};};
assert.equal(button('安装所选版本').disabled,false);assert.match(button('安装所选版本').description,/重置超分与帧生成/);
button('安装所选版本').onClick();await settle();
assert.equal(fsrReinstalls,1);assert.equal(versionConfirms,1);assert.equal(info.fsr.prepared,true);
assert.equal(info.opti.settings.sr,'xess');assert.equal(info.opti.settings.fg,'native','reprepare resets settings as its description explains');
clearUI();
console.log('PASS: installed10 target and menu option, native version callback persistence, active-XMX replacement block, explicit downgrade/reset copy and model-preparing10 reinstall.');

// Keep the full installation-flow regressions independent of earlier menu choices.
function resetInstallFixture() {
  clearUI();savedSelection='42';runningGame=undefined;current='';cacheStatus={};
  Object.assign(api.selectionSnapshot(),{appid:42,executables:{},sources:{},versions:{},cache:{},snapshots:{},settingsSave:null,settingsEpochs:{},actionBusy:false,manualGame:null});
  operation={...operation,operation_id:null,appid:null,kind:'',phase:'completed',running:false,error:null,revision:operation.revision+1};
  runtime={...runtime,ready:true};fsrStatusValue={ready:false,version:'',reason:'尚未导入 FSR 模型包。'};
  Object.assign(info,{appid:42,name:'Demo',executables:['game.exe'],runtime_ready:true,prefix_ready:true,external_managed:false,state:null,
    automatic:{executable:'game.exe',route:'native',reason:'',candidates:['game.exe']},
    fsr:{ready:false,prepared:false,bridge_ready:false,version:'',opti_version:pinned10,reason:'尚未导入 FSR 模型包。'},
    opti:{managed:false,installed:false,incomplete:false,injection_enabled:true,version:'',status:'',rollback:false,pending:null,settings:copy(srSettings)}});
  context.document.documentElement.lang='zh-cn';
  methods.inventory=async()=>({ok:true,data:[{appid:42,name:'Demo'}]});
  methods.inspect_game=async id=>{inspectCount++;return {ok:true,data:{...copy(info),appid:id}};};
  methods.settings_preflight=async()=>({ok:true,data:true});
  methods.opti_cache_status=async()=>({ok:true,data:copy(cacheStatus)});
}
function setActiveInstallFixture() {
  current='/before-xmx/launch %command%';info.state={status:'active',launch:current,old_launch:'original %command%'};
}
function configureInstallConfirmations(calls) {
  methods.restore=async(id,actual)=>{
    assert.equal(id,42);assert.equal(actual,current);calls.push('restore');
    info.state.status='pending_restore_launch';return {ok:true,data:copy(info.state)};
  };
  methods.confirm_launch=async(id,actual)=>{
    assert.equal(id,42);assert.equal(actual,current);
    const restoring=info.state.status==='pending_restore_launch';calls.push(restoring?'confirm_restore':'confirm_enable');
    assert.equal(actual,restoring?info.state.old_launch:info.state.launch);
    info.state.status=restoring?'restored':'active';return {ok:true,data:copy(info.state)};
  };
  methods.opti_confirm=async(id,actual)=>{
    assert.equal(id,42);assert.equal(actual,info.opti.pending.target);calls.push('opti_confirm');
    info.opti={...info.opti,managed:true,installed:true,incomplete:false,status:'active',pending:null};
    // Reinstalling changes the route; restoration must inspect this final state.
    info.automatic.route='installed-opti-route';return {ok:true,data:true};
  };
  methods.enable=async(id,exe,route,before)=>{
    assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(route,'installed-opti-route');
    assert.equal(before,'/new-opti/launch %command%');calls.push('enable_fresh_route');
    info.state={status:'pending_launch',old_launch:before,launch:'/after-xmx/launch %command%'};
    return {ok:true,data:copy(info.state)};
  };
}

resetInstallFixture();
info.executables=['new-game.exe','new-game-dx12.exe'];
info.automatic={executable:'',route:'native',reason:'发现多个游戏程序，请在下面确认一次。',candidates:[...info.executables]};
await mountUI();
assert.ok(exeChoice());assert.match(textOf(render()),/先选择游戏主程序/);
assert.equal(nodes(render()).filter(n=>n.type==='select').length,2,'only game and EXE are presented before an ambiguous target is confirmed');
assert.equal(nodes(render()).filter(n=>n.type==='toggle').length,0,'XMX and injection controls wait for EXE selection');
for(const label of ['安装所选版本',overlayLabel,'高级设置','下载并配置 XMX 运行环境','导入 FSR 模型包'])
  assert.equal(button(label),undefined,`${label} waits for EXE selection`);
exeChoice().onChange({data:'new-game-dx12.exe'});
assert.equal(versionChoice().rgOptions.map(option=>option.data).join(','),`${pinned10},0.9.4,0.7.9`,'fresh install exposes all supported versions');
assert.equal(button('安装所选版本').disabled,false);
assert.equal(button(overlayLabel),undefined,'confirming EXE does not expose an overlay before installation');
clearUI();
console.log('PASS: ambiguous EXE hides dependent controls, confirmation exposes all fresh-install versions, overlay waits for installation.');

resetInstallFixture();setActiveInstallFixture();
const fullInstallCalls=[];configureInstallConfirmations(fullInstallCalls);
let releaseFullInstall,fullInstallCount=0;
methods.opti_install=async(id,exe,before,version,source)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(before,'original %command%');
  assert.equal(info.state.status,'restored','install waits for XMX restore confirmation');
  assert.equal(version,'0.9.4');assert.equal(source,'github');fullInstallCalls.push('install');fullInstallCount++;
  await new Promise(resolve=>{releaseFullInstall=resolve;});
  info.opti={...info.opti,version,rollback:true,status:'pending_launch',pending:{expected:before,target:'/new-opti/launch %command%',kind:'install'}};
  return {ok:true,data:copy(info.opti.pending)};
};
await mountUI();const oldInstallAction=button('安装所选版本');
assert.equal(oldInstallAction.disabled,false);assert.match(oldInstallAction.description,/自动暂时关闭 XMX/);
oldInstallAction.onClick();
for(let n=0;n<50&&!releaseFullInstall;n++)await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(releaseFullInstall);assert.deepEqual(fullInstallCalls,['restore','confirm_restore','install']);
clearUI();const mountingFullInstall=mountUI();await new Promise(resolve=>setTimeout(resolve,40));
assert.equal(button('安装所选版本').disabled,true,'replacement QAM shares the in-flight installation lock');
assert.equal(toggle().disabled,true);assert.equal(gameChoice().disabled,true);
oldInstallAction.onClick();button('安装所选版本').onClick();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(fullInstallCount,1,'old and replacement callbacks cannot start a second installation');
releaseFullInstall();await mountingFullInstall;await settle();
assert.deepEqual(fullInstallCalls,['restore','confirm_restore','install','opti_confirm','enable_fresh_route','confirm_enable']);
assert.equal(current,'/after-xmx/launch %command%');assert.equal(info.state.status,'active');
assert.equal(button(overlayLabel).disabled,false,'completed installation exposes the overlay');
assert.equal(api.selectionSnapshot().settingsSave.saving,false);assert.equal(api.selectionSnapshot().settingsSave.error,false);
await reopenUI();for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(fullInstallCount,1,'reopen and polling cannot replay a completed installation');
clearUI();
console.log('PASS: fresh install with active XMX restores and confirms first, survives QAM unmount, blocks duplicates and re-enables the freshly inspected route.');

resetInstallFixture();
cacheStatus={'0.9.4':{cached:true,prepared:false,size_bytes:123},'0.7.9':{cached:true,prepared:true,size_bytes:456},[pinned10]:{cached:false,prepared:false,size_bytes:0}};
await mountUI();
assert.equal(sourceChoice().selectedOption,'local','cached stable version defaults to local before first install');
assert.equal(sourceChoice().rgOptions[0].data,'local','local cache is the first available source');
versionChoice().onChange({data:pinned10});assert.equal(sourceChoice().selectedOption,'github','uncached version defaults to a network source');
versionChoice().onChange({data:'0.7.9'});assert.equal(sourceChoice().selectedOption,'local','cache default belongs to each version');
sourceChoice().onChange({data:'ghproxy'});versionChoice().onChange({data:'0.9.4'});
assert.equal(sourceChoice().selectedOption,'local','remote choice for another version cannot override a cached default');
let localRequests=0;const localSources=[];
methods.opti_install=async(_id,_exe,_before,version,source)=>{localRequests++;localSources.push({version,source});return {ok:false,error:'local fixture refusal'};};
button('安装所选版本').onClick();await settle();
assert.deepEqual(localSources,[{version:'0.9.4',source:'local'}],'the cached install RPC requests local explicitly');
for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));await reopenUI();
assert.equal(localRequests,1,'local failure never silently retries through a remote source');
assert.equal(sourceChoice().selectedOption,'local');
info.opti={...copy(readyOverlay),version:'0.9.4'};await reopenUI();button('高级设置')?.onClick();
assert.equal(sourceChoice().selectedOption,'local','managed install entry uses the same cache preference');
versionChoice().onChange({data:'0.7.9'});assert.equal(sourceChoice().selectedOption,'ghproxy','explicit source choice remains attached to its version');
versionChoice().onChange({data:pinned10});assert.equal(sourceChoice().selectedOption,'github');
clearUI();
console.log('PASS: per-version local-first cache sources for fresh and managed installs, explicit local RPC, remote choice isolation and no failure fallback or retry.');

resetInstallFixture();setActiveInstallFixture();
cacheStatus={'0.9.4':{cached:true,prepared:false,size_bytes:123}};
await mountUI();assert.equal(sourceChoice().selectedOption,'local');sourceChoice().onChange({data:'local'});
cacheStatus={};let vanishedRestoreCalls=0,vanishedInstallCalls=0;
methods.restore=async()=>{vanishedRestoreCalls++;throw new Error('missing cache must be refused before XMX is touched');};
methods.opti_install=async()=>{vanishedInstallCalls++;throw new Error('missing local cache must never become a network request');};
const launchBeforeMissingCache=current, writesBeforeMissingCache=writes;
button('安装所选版本').onClick();await settle();
assert.equal(vanishedRestoreCalls,0);assert.equal(vanishedInstallCalls,0);assert.equal(current,launchBeforeMissingCache);
assert.equal(writes,writesBeforeMissingCache);assert.equal(info.state.status,'active');
assert.equal(sourceChoice().selectedOption,'local','an explicit local selection is retained when cache disappears');
assert.ok(sourceChoice().rgOptions.some(option=>option.data==='local'),'missing explicit local choice remains visible for correction');
assert.match(textOf(render()),/本地安装包不存在，请重新选择安装来源/);
await reopenUI();for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(vanishedRestoreCalls,0);assert.equal(vanishedInstallCalls,0,'reopening does not retry a failed local operation');
assert.equal(sourceChoice().selectedOption,'local');
clearUI();
console.log('PASS: vanished explicit local cache is refused before disabling XMX, with a visible source correction and no remote fallback or reopen retry.');

resetInstallFixture();setActiveInstallFixture();
info.opti={...copy(readyOverlay),version:pinned10};
info.fsr={ready:true,prepared:true,bridge_ready:true,version:'4.1.2',opti_version:pinned10,reason:''};
cacheStatus={[pinned10]:{cached:true,prepared:true,size_bytes:789}};
const prepareInstallCalls=[];configureInstallConfirmations(prepareInstallCalls);
methods.opti_install=async()=>{throw new Error('prepared Opti 10 must use FSR preparation');};
methods.fsr_prepare=async(id,exe,before,source)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(before,'original %command%');assert.equal(source,'local');
  assert.equal(info.state.status,'restored');prepareInstallCalls.push('fsr_prepare');
  info.opti.pending={expected:before,target:'/new-opti/launch %command%',kind:'fsr_prepare'};
  return {ok:true,data:copy(info.opti.pending)};
};
await mountUI();button('高级设置')?.onClick();button('安装所选版本').onClick();await settle();
assert.deepEqual(prepareInstallCalls,['restore','confirm_restore','fsr_prepare','opti_confirm','enable_fresh_route','confirm_enable']);
assert.equal(info.state.status,'active');assert.equal(current,'/after-xmx/launch %command%');
clearUI();
console.log('PASS: prepared Opti 10 reinstall uses local FSR preparation between confirmed XMX restore and fresh-route re-enable.');

resetInstallFixture();setActiveInstallFixture();
const failedInstallCalls=[];configureInstallConfirmations(failedInstallCalls);
let partialInstallCount=0;
methods.opti_install=async(_id,_exe,before)=>{
  partialInstallCount++;failedInstallCalls.push('install_failed');
  info.opti={...info.opti,managed:true,installed:true,incomplete:true,rollback:true,status:'recovery_required',
    pending:{expected:before,target:'/partial-opti/launch %command%',kind:'install'}};
  info.executables=['recovery-a.exe','recovery-b.exe'];
  info.automatic={executable:'',route:'native',reason:'发现多个游戏程序，请在下面确认一次。',candidates:[...info.executables]};
  return {ok:false,error:'fixture failed after staging files'};
};
await mountUI();button('安装所选版本').onClick();await settle();
assert.deepEqual(failedInstallCalls,['restore','confirm_restore','install_failed']);
assert.equal(info.state.status,'restored','failed install leaves XMX off for explicit recovery');
assert.match(textOf(render()),/安装流程未完成.*fixture failed after staging files/);
assert.equal(button('安装所选版本'),undefined);assert.equal(button(overlayLabel),undefined);
assert.ok(button('完成 Opti 启动设置'),'pending recovery remains visible outside the ambiguous EXE gate');
assert.equal(button('完成 Opti 启动设置').disabled,true,'unrecoverable pending install cannot be falsely confirmed');
assert.ok(button('回退上次操作'),'rollback remains visible outside the ambiguous EXE gate');
assert.equal(button('回退上次操作').disabled,false,'rollback remains actionable outside the ambiguous EXE gate');
await reopenUI();for(const timer of timers.values())timer();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(partialInstallCount,1,'failed partial installation is never retried by mount or polling');
let rollbackCalls=0,rollbackConfirms=0;
methods.opti_rollback=async(id,before)=>{
  assert.equal(id,42);assert.equal(before,'original %command%');rollbackCalls++;
  info.opti.pending={expected:before,target:'rollback-original %command%',kind:'rollback'};
  return {ok:true,data:copy(info.opti.pending)};
};
methods.opti_confirm=async(id,actual)=>{
  assert.equal(id,42);assert.equal(actual,'rollback-original %command%');rollbackConfirms++;
  info.opti={...info.opti,managed:false,installed:false,incomplete:false,status:'',pending:null,rollback:false};
  return {ok:true,data:true};
};
button('回退上次操作').onClick();await settle();
assert.equal(rollbackCalls,1);assert.equal(rollbackConfirms,1);assert.equal(current,'rollback-original %command%');
assert.equal(info.opti.pending,null);assert.equal(button('完成 Opti 启动设置'),undefined);
assert.equal(api.selectionSnapshot().settingsSave.error,false,'successful explicit rollback replaces the installation error');
clearUI();
console.log('PASS: partial install failure leaves actionable rollback outside EXE gating, never retries, and rollback writes and confirms Steam launch settings.');

resetInstallFixture();current='pending-original %command%';
info.executables=['pending-a.exe','pending-b.exe'];
info.automatic={executable:'',route:'native',reason:'发现多个游戏程序，请在下面确认一次。',candidates:[...info.executables]};
info.opti={...copy(readyOverlay),status:'pending_launch',rollback:true,
  pending:{expected:current,target:'pending-completed %command%',kind:'install'}};
let pendingFinishConfirms=0;
methods.opti_confirm=async(id,actual)=>{
  assert.equal(id,42);assert.equal(actual,'pending-completed %command%');pendingFinishConfirms++;
  info.opti={...info.opti,status:'active',pending:null};return {ok:true,data:true};
};
await mountUI();
assert.ok(button('完成 Opti 启动设置'),'confirmable pending install remains visible without an EXE selection');
assert.equal(button('完成 Opti 启动设置').disabled,false);
assert.equal(button('安装所选版本'),undefined,'recovery does not expose new configuration prematurely');
button('完成 Opti 启动设置').onClick();await settle();
assert.equal(pendingFinishConfirms,1);assert.equal(current,'pending-completed %command%');
assert.equal(info.opti.pending,null);assert.equal(button('完成 Opti 启动设置'),undefined);
clearUI();
console.log('PASS: pending launch completion remains available without an unambiguous EXE and confirms Steam readback once.');
