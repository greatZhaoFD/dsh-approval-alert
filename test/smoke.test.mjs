// Headless smoke test for the dsh-approval-alert client bundle.
//
// Simulates the browser module loader, a minimal React (hooks + createElement),
// the client Cordis context (locale + slots), and the browser globals the alert
// uses (localStorage / Notification / AudioContext / document). No browser and
// no DSH install required.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const clientPath = path.join(pluginRoot, 'lib', 'client.js');
const hostPath = path.join(pluginRoot, 'lib', 'index.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}
function section(title) {
  console.log(`\n== ${title}`);
}

// ---------------------------------------------------------------------------
// Fake React: enough of the hooks surface for a static render + effect replay.
// ---------------------------------------------------------------------------
function createFakeReact() {
  const effects = [];
  const elements = [];
  const React = {
    createElement(type, props, ...children) {
      const element = { type, props: { ...(props ?? {}) } };
      if (children.length === 1) element.props.children = children[0];
      else if (children.length > 1) element.props.children = children;
      elements.push(element);
      return element;
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial;
      return [value, () => {}];
    },
    useRef(initial) {
      return { current: initial };
    },
    useEffect(callback) {
      effects.push(callback);
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
    Fragment: Symbol('Fragment')
  };
  return { React, effects, elements };
}

// ---------------------------------------------------------------------------
// Browser globals.
// ---------------------------------------------------------------------------
const notifications = [];
const oscillators = [];
const oscillated = () => oscillators.length;

class FakeNotification {
  static permission = 'granted';
  static requestPermission() {
    return Promise.resolve('granted');
  }
  constructor(title, options) {
    this.title = title;
    this.options = options ?? {};
    this.onclick = null;
    this.onclose = null;
    this.onerror = null;
    notifications.push(this);
  }
  close() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator() {
    const node = {
      type: 'sine',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {}
    };
    oscillators.push(node);
    return node;
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}
    };
  }
}

const storage = new Map();
const sandboxWindow = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value))
  },
  AudioContext: FakeAudioContext,
  Notification: FakeNotification,
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  focus: () => {}
};

const moduleLoader = {
  captured: [],
  load(definition) {
    this.captured.push(definition);
  }
};
sandboxWindow.__ModuleLoader__ = moduleLoader;

const sandbox = {
  window: sandboxWindow,
  document: {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  console,
  Date,
  JSON,
  Set,
  Map,
  Symbol,
  Object,
  Array,
  String,
  Math,
  Promise,
  Error,
  TypeOf: undefined,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  globalThis: undefined
};
sandbox.globalThis = sandbox;

// ---------------------------------------------------------------------------
section('host half');
const hostModule = await import(new URL(`file:///${hostPath.replace(/\\/g, '/')}`));
check('host exports a name', typeof hostModule.name === 'string' && hostModule.name.length > 0, hostModule.name);
check('host apply is callable', typeof hostModule.apply === 'function');
let hostApplied = false;
try {
  hostModule.apply({ logger: () => ({ info: () => { hostApplied = true; } }) });
  check('host apply runs without throwing', true);
} catch (error) {
  check('host apply runs without throwing', false, String(error));
}
check('host logger reached', hostApplied === true);
// ---------------------------------------------------------------------------
section('client bundle wrapper');
const source = fs.readFileSync(clientPath, 'utf8');
check('bundle calls window.__ModuleLoader__.load', source.includes('window.__ModuleLoader__.load('));
const context = vm.createContext(sandbox);
vm.runInContext(source, context, { filename: 'client.js' });
check('exactly one module registered', moduleLoader.captured.length === 1, String(moduleLoader.captured.length));
const definition = moduleLoader.captured[0];
check('module id matches package name', definition.id === 'dsh-approval-alert', definition.id);

const { React, effects } = createFakeReact();
const fakeRequire = (name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected module request: ${name}`);
};
const clientExports = definition.factory(fakeRequire);
check('client exports apply', typeof clientExports.apply === 'function');
check('client declares inject', Array.isArray(clientExports.inject) && clientExports.inject.includes('slots') && clientExports.inject.includes('locale'), JSON.stringify(clientExports.inject));

// ---------------------------------------------------------------------------
section('client apply + slot registration');
const localeDicts = new Map();
let slotEntry;
const openedSessions = [];
const fakeWorkspace = { openSession: (id) => openedSessions.push(id) };
const ctx = {
  effect: (factory) => {
    const dispose = factory();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register: (ns, dicts) => {
      localeDicts.set(ns, dicts);
      return () => {};
    },
    bind: (ns) => {
      const dicts = localeDicts.get(ns) ?? { zh: {} };
      const dict = dicts.zh ?? {};
      return (key, params) => {
        let text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
        if (params && typeof params === 'object') {
          for (const name of Object.keys(params)) text = text.split(`{${name}}`).join(String(params[name]));
        }
        return text;
      };
    }
  },
  slots: {
    inject: (name, factory) => {
      factory();
      return () => {};
    },
    register: (options, Component) => {
      slotEntry = { options, Component };
      return () => {};
    }
  },
  get: (name) => (name === 'uiWorkspace' ? fakeWorkspace : undefined)
};

clientExports.apply(ctx);
check('locale dictionaries registered', localeDicts.has('approval-alert'));
check('registered into shell.overlay', slotEntry !== undefined && slotEntry.options.name === 'shell.overlay', slotEntry?.options?.name);
check('overlay entry id is additive', slotEntry?.options?.id === 'approval-alert', slotEntry?.options?.id);
const t = ctx.locale.bind('approval-alert');
const injected = slotEntry.options.inject();
check('inject exposes openSession', typeof injected.openSession === 'function');

// ---------------------------------------------------------------------------
// Helpers to render the slot component with a given session-status map.
// ---------------------------------------------------------------------------
function render({ statuses, sessions = { byId: {} } }) {
  effects.length = 0;
  const props = {
    t,
    openSession: injected.openSession,
    useSessionStatus: (selector) => selector(statuses),
    useSessions: (selector) => selector(sessions)
  };
  const tree = slotEntry.Component(props);
  return { tree, effects: [...effects] };
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && node.props) return textOf(node.props.children);
  return '';
}

section('render: no pending interaction');
const idle = render({ statuses: new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: false }]]) });
check('renders nothing', idle.tree === null, String(idle.tree));

section('render: pending approval (with effects)');
notifications.length = 0;
oscillators.length = 0;
const approvalStatuses = new Map([
  ['s1', {
    running: true,
    completionUnread: false,
    pendingInteraction: {
      key: 'approval:1',
      kind: 'approval',
      sessionId: 's1',
      toolName: 'pwsh',
      answerable: true,
      answer: () => {}
    }
  }]
]);
const approval = render({ statuses: approvalStatuses, sessions: { byId: { s1: { title: '重构审批流程' } } } });
const approvalText = textOf(approval.tree);
check('renders a card', approval.tree !== null);
check('shows approval title', approvalText.includes('审批'), approvalText);
check('shows tool name', approvalText.includes('pwsh'), approvalText);
check('shows session title', approvalText.includes('重构审批流程'), approvalText);
check('has an open-session button', approvalText.includes('前往会话'), approvalText);
for (const effect of approval.effects) effect();
check('default prefs raise NO OS notification', notifications.length === 0, String(notifications.length));
check('plays a three-note chime', oscillated() === 3, String(oscillated()));

section('render: OS notification when explicitly enabled');
notifications.length = 0;
oscillators.length = 0;
storage.set('dsh-approval-alert.prefs.v2', JSON.stringify({ sound: true, notify: true }));
const notified = render({ statuses: approvalStatuses, sessions: { byId: { s1: { title: '重构审批流程' } } } });
for (const effect of notified.effects) effect();
check('raises exactly one OS notification', notifications.length === 1, String(notifications.length));
check('notification body names the tool', notifications[0]?.options?.body?.includes('pwsh') === true, notifications[0]?.options?.body);
storage.delete('dsh-approval-alert.prefs.v2');

section('notification click opens the session');
notifications[0].onclick();
check('openSession called with session id', openedSessions.length === 1 && openedSessions[0] === 's1', JSON.stringify(openedSessions));

section('render: answerable=false is ignored');
const answered = render({
  statuses: new Map([['s1', {
    running: true,
    completionUnread: false,
    pendingInteraction: { key: 'approval:2', kind: 'approval', sessionId: 's1', toolName: 'edit', answerable: false, answer: () => {} }
  }]]),
  sessions: { byId: { s1: { title: 'x' } } }
});
check('renders nothing', answered.tree === null);

section('render: pending question');
const question = render({
  statuses: new Map([['s2', {
    running: true,
    completionUnread: false,
    pendingInteraction: { key: 'question:9', kind: 'question', sessionId: 's2', answerable: true, answer: () => {} }
  }]]),
  sessions: { byId: { s2: { title: '数据分析' } } }
});
const questionText = textOf(question.tree);
check('shows question title', questionText.includes('回答'), questionText);
check('names the session', questionText.includes('数据分析'), questionText);

section('render: mixed pending interactions');
const mixed = render({
  statuses: new Map([
    ['s1', { running: true, completionUnread: false, pendingInteraction: { key: 'approval:3', kind: 'approval', sessionId: 's1', toolName: 'pwsh', answerable: true, answer: () => {} } }],
    ['s2', { running: true, completionUnread: false, pendingInteraction: { key: 'question:4', kind: 'question', sessionId: 's2', answerable: true, answer: () => {} } }]
  ]),
  sessions: { byId: { s1: { title: 'A' }, s2: { title: 'B' } } }
});
const mixedText = textOf(mixed.tree);
check('shows a pending count for extra items', /\+1/.test(mixedText), mixedText);

section('package manifest');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
check('declares web client half', manifest.dsh?.client?.platform === 'web');
check('loads the client bundle at boot', manifest.dsh?.client?.immediately === true);
check('exports ./client bundle', manifest.exports?.['./client'] !== undefined);
check('client bundle file exists', fs.existsSync(path.join(pluginRoot, manifest.exports['./client'])));
check('exports locale resources', manifest.exports?.['./locale/*.json'] !== undefined);
check('exports display icon', manifest.exports?.['./icon'] !== undefined && fs.existsSync(path.join(pluginRoot, 'icon.svg')));
const englishMeta = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'locale', 'en.json'), 'utf8'));
check('english locale carries meta.title', typeof englishMeta.meta?.title === 'string' && englishMeta.meta.title.length > 0);
check('no engines.dsh prerelease trap', manifest.engines?.dsh === undefined, manifest.engines?.dsh);
check('declares bundle patch', manifest.dsh?.bundle?.patch !== undefined);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}: smoke test finished`);
process.exitCode = failures === 0 ? 0 : 1;
