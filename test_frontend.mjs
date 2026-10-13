import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let current = '', writes = 0, unregisters = 0, cursor = 0, enableCalls = 0, rejectEnable = false;
const slots = [], effects = [], notifications = [];
const info = {appid:42,name:'Demo',executables:['game.exe','Launcher.exe'],libraries:[{path:'libxess.dll'}],optis:[],
  runtime_ready:true,prefix_ready:true,external_managed:false,state:null,
  automatic:{executable:'game.exe',route:'native',reason:'',candidates:['game.exe']}};
const copy = value => JSON.parse(JSON.stringify(value));
const methods = {
  inventory: async () => ({ok:true,data:[{appid:42,name:'Demo'}]}),
  inspect_game: async () => ({ok:true,data:copy(info)}),
  enable: async (_id,exe,route,before) => {
    enableCalls++; assert.equal(exe,'game.exe'); assert.equal(route,'native');
    if(rejectEnable)return {ok:false,error:'游戏仍在运行，请退出后重试。'};
    info.state={status:'pending_launch',launch:'/test/launch %command%',old_launch:before};
    return {ok:true,data:copy(info.state)};
  },
  confirm_launch: async () => {
    info.state.status=info.state.status==='pending_restore_launch'?'restored':'active';
    return {ok:true,data:copy(info.state)};
  },
  restore: async () => {info.state.status='pending_restore_launch';return {ok:true,data:copy(info.state)};},
};
const hook = init => {
  const n=cursor++;if(!(n in slots))slots[n]=init;
  return [slots[n],value=>{slots[n]=value;}];
};
const jsx = (type,props) => ({type,props});
const context = vm.createContext({
  console,setTimeout,clearTimeout,queueMicrotask,
  localStorage:{getItem:()=>null,setItem:()=>{}},
  window:{__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit:{connect:()=>({
    _version:2,callable:name=>(...args)=>methods[name](...args),toaster:{toast:value=>notifications.push(value)},
  })}},
  SP_JSX:{jsx,jsxs:jsx,Fragment:'Fragment'},
  SP_REACT:{useState:hook,useRef:init=>hook({current:init})[0],useEffect:fn=>{
    const n=cursor++;if(!(n in slots)){slots[n]=true;effects.push(fn);}
  }},
  DFL:{staticClasses:{Title:'title'},PanelSection:'section',PanelSectionRow:'row',ButtonItem:'button',DropdownItem:'select',ToggleField:'toggle'},
  SteamClient:{Apps:{
    RegisterForAppDetails:(id,callback)=>{queueMicrotask(()=>callback(id,{strLaunchOptions:current}));return {unregister:()=>unregisters++};},
    SetAppLaunchOptions:(_id,value)=>{current=value;writes++;},
  }},
});
const source=fs.readFileSync(new URL('dist/index.js',import.meta.url),'utf8')
  .replace('export { index as default };','globalThis.testAPI={index,readLaunch,writeLaunch,Content};');
vm.runInContext(source,context);
const api=context.testAPI;
function render(){cursor=0;return api.Content();}
function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.props?.children)];}
function toggle(){return nodes(render()).find(n=>n.type==='toggle').props;}
function textOf(node){if(node==null)return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return node.type==='br'?'\n':textOf(node.props?.children);}
async function settle(){for(let n=0;n<50;n++){await new Promise(r=>setTimeout(r,20));if(!slots[5])return;}throw new Error('UI stayed busy');}
assert.equal(api.index().name,'Opti2XMX');
render();for(const effect of effects)effect();await settle();
assert.equal(toggle().disabled,false);assert.equal(toggle().checked,false);
assert.equal(nodes(render()).filter(n=>n.type==='select').length,1,'normal flow only asks for game');
toggle().onChange(true);
assert.equal(toggle().disabled,true);
// Double activation is blocked before React can repaint.
toggle().onChange(true);await settle();
assert.equal(enableCalls,1);assert.equal(toggle().checked,true);assert.equal(writes,1);
assert.equal(current,'/test/launch %command%');
toggle().onChange(false);assert.equal(toggle().disabled,true);await settle();
assert.equal(toggle().checked,false);assert.equal(current,'');assert.equal(writes,2);
rejectEnable=true;toggle().onChange(true);await settle();
assert.equal(toggle().checked,false);assert.match(notifications.at(-1).body,/游戏仍在运行/);
assert.ok(notifications.some(n=>n.title.includes('未完成')));
current='external %command%';
await assert.rejects(()=>api.writeLaunch(42,'overwrite','stale'),/刚被其他工具修改/);
assert.equal(writes,2);assert.ok(unregisters>=8);
console.log('PASS: automatic selection; toggle on/off; immediate progress; double-click guard; visible errors/toasts; Steam readback and conflict protection.');

current='';rejectEnable=false;
info.opti={managed:false,installed:false,version:'',status:'',rollback:false,settings:{sr:'xess',fg:'native',fg_input:'upscaler',spoof:'real'}};
let installCount=0;
methods.opti_install=async(id,exe,before,version,source)=>{
  assert.equal(id,42);assert.equal(exe,'game.exe');assert.equal(version,'0.9.4');assert.equal(source,'github');installCount++;
  info.opti={...info.opti,managed:true,installed:true,version:'0.9.4',status:'pending_launch',rollback:true,
    pending:{expected:before,target:'/opti/launch %command%',kind:'install'}};
  return {ok:true,data:copy(info.opti.pending)};
};
methods.opti_confirm=async(_id,actual)=>{
  assert.equal(actual,info.opti.pending.target);info.opti.status='active';info.opti.pending=null;
  return {ok:true,data:true};
};
function button(label){return nodes(render()).find(n=>n.type==='button'&&n.props.children===label)?.props;}
button('刷新').onClick();await settle();
button('安装 Opti 0.9.4').onClick();await settle();
assert.equal(installCount,1);assert.equal(current,'/opti/launch %command%');assert.ok(button('打开 Opti 面板'));
button('高级设置').onClick();
assert.ok(button('卸载 Opti'));assert.ok(button('回退上次操作'));
const version=nodes(render()).find(n=>n.type==='select'&&n.props.label==='Opti 版本');
assert.equal(version.props.selectedOption,'0.9.4');
console.log('PASS: official 0.9.4 install action, Steam confirmation, panel button, advanced lifecycle controls.');

info.opti.injection_enabled=true;
methods.opti_toggle=async(id,want,before)=>{
  assert.equal(id,42);assert.equal(before,current);
  info.opti.injection_enabled=want;
  info.opti.pending={expected:before,target:before,kind:'toggle'};
  return {ok:true,data:copy(info.opti.pending)};
};
button('刷新').onClick();await settle();
const optiToggle=()=>nodes(render()).find(n=>n.type==='toggle'&&n.props.label==='Opti 注入').props;
optiToggle().onChange(false);await settle();
assert.equal(optiToggle().checked,false);assert.equal(button('打开 Opti 面板'),undefined);
assert.equal(current,'/opti/launch %command%');
optiToggle().onChange(true);await settle();
assert.equal(optiToggle().checked,true);assert.ok(button('打开 Opti 面板'));
console.log('PASS: independent Opti injection toggle and hidden panel when disabled.');

context.document={documentElement:{lang:'en'}};
context.navigator={language:'zh-CN'};
const englishNodes=nodes(render());
const englishXmx=englishNodes.find(n=>n.props?.label==='XMX acceleration');
assert.ok(englishXmx);
assert.match(textOf(englishXmx.props.description),/Intel devices only/);
assert.match(textOf(englishXmx.props.description),/Close the game before changing this setting/);
const englishOpti=englishNodes.find(n=>n.props?.label==='Opti injection');
assert.match(textOf(englishOpti.props.description),/natively supports XeSS Frame Generation, turn this option off/);
assert.ok(button('Open Opti overlay'));assert.ok(button('Uninstall Opti'));
methods.opti_toggle=async()=>({ok:false,error:'游戏仍在运行。请从 Steam 退出游戏，再操作 XMX 开关。'});
englishOpti.props.onChange(false);await settle();
assert.match(notifications.at(-1).body,/game is still running/);
assert.equal(nodes(render()).find(n=>n.props?.label==='Opti injection').props.checked,true);
context.document.documentElement.lang='zh-cn';
assert.equal(textOf(toggle().description),'仅支持 Intel 设备。\n为游戏启用 XMX 加速，使兼容的游戏中的 XeSS 帧生成可以正常使用。\n更改状态前请先关闭游戏！');
assert.equal(textOf(optiToggle().description),'游戏原生支持 XeSS 帧生成时，请关闭此选项。\n使用 OptiScaler 修改游戏内的超分辨率/帧生成设置');
console.log('PASS: Steam language takes precedence; bilingual descriptions, controls and running-game error.');
