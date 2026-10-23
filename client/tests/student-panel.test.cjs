const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const pages = path.join(__dirname, '..', 'src', 'pages');
function loadTsx(filename) {
  const full = path.join(pages, filename);
  const source = fs.readFileSync(full, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = new Module(full, module); loaded.filename = full; loaded.paths = Module._nodeModulePaths(path.dirname(full)); loaded._compile(output, full); return loaded.exports;
}

function testSync(name, callback) { callback(); process.stdout.write(`ok - ${name}\n`); }

testSync('shared TiltCard and MagneticButton render without crashing', () => {
  const { TiltCard, MagneticButton } = loadTsx('TeacherEffects.tsx');
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(TiltCard, null, React.createElement('span', null, 'Card')),
    React.createElement(MagneticButton, null, 'Action'),
  ));
  assert.match(markup, /teacher-tilt-card/); assert.match(markup, /teacher-magnetic-button/); assert.match(markup, /Action/);
});

testSync('student theme persists its choice under a panel-specific key', () => {
  const { applyStudentTheme, studentThemeStorageKey } = loadTsx('StudentTheme.ts');
  const root = { dataset: {} }; const values = new Map();
  applyStudentTheme('dark', root, { setItem: (key, value) => values.set(key, value) });
  assert.equal(root.dataset.studentTheme, 'dark'); assert.equal(values.get(studentThemeStorageKey), 'dark');
  applyStudentTheme('light', root, { setItem: (key, value) => values.set(key, value) });
  assert.equal(root.dataset.studentTheme, 'light'); assert.equal(values.get(studentThemeStorageKey), 'light');
});

testSync('reduced motion and touch-only preferences disable shared pointer effects', () => {
  const { pointerEffectsAllowed } = loadTsx('TeacherEffects.tsx');
  assert.equal(pointerEffectsAllowed(true, true), false); assert.equal(pointerEffectsAllowed(false, false), false);
});

testSync('attendance empty state is neutral and below-threshold warning requires records', () => {
  const { studentAttendanceState } = loadTsx('StudentPanelModel.ts');
  assert.equal(studentAttendanceState(0, null), 'empty'); assert.equal(studentAttendanceState(0, 0), 'empty');
  assert.equal(studentAttendanceState(10, 74), 'below-threshold'); assert.equal(studentAttendanceState(10, 75), 'normal');
});

testSync('fee totals and mark-all-read are deterministic without changing server data', () => {
  const { summarizeStudentFees, markStudentNoticesRead } = loadTsx('StudentPanelModel.ts');
  assert.deepEqual(summarizeStudentFees([{ total: 1000, paid: 400 }, { total: 200, paid: 200 }]), { total: 1200, paid: 600, due: 600 });
  assert.deepEqual(markStudentNoticesRead(['old'], ['new', 'old']), ['old', 'new']);
});

testSync('Student Portal Helmet page head sets distinct portal titles and descriptions', () => {
  const { HelmetProvider } = require('react-helmet-async'); const Head = loadTsx('StudentPageHead.tsx').default;
  for (const title of ['Dashboard', 'My Attendance', 'Download Center']) {
    const context = {};
    renderToStaticMarkup(React.createElement(HelmetProvider, { context }, React.createElement(Head, { title, description: `${title} page` })));
    assert.match(context.helmet.title.toString(), new RegExp(`<title(?: data-rh="true")?>${title} \\| Student Portal</title>`));
    assert.match(context.helmet.meta.toString(), /name="description"/);
  }
});

testSync('large timetable and attendance calendar cards are static', () => {
  const source = fs.readFileSync(path.join(pages, 'StudentPage.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(pages, 'StudentPage.css'), 'utf8');
  assert.match(source, /<Section title="My Weekly Schedule" className="student-static">/);
  assert.match(source, /<Section title="Monthly Calendar" className="student-static">/);
  assert.match(css, /\.student-theme \.student-static\{transform:none!important;perspective:none!important/);
});
