const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const pageRoot = path.join(__dirname, '..', 'src', 'pages');
function loadTsx(filename) {
  const fullPath = path.join(pageRoot, filename);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(fullPath, module);
  loaded.filename = fullPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(fullPath));
  loaded._compile(compiled, fullPath);
  return loaded.exports;
}

function run(name, callback) {
  callback();
  process.stdout.write(`ok - ${name}\n`);
}

run('TiltCard and MagneticButton render without crashing', () => {
  const { TiltCard, MagneticButton } = loadTsx('TeacherEffects.tsx');
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(TiltCard, null, React.createElement('span', null, 'Card')),
    React.createElement(MagneticButton, null, 'Action'),
  ));
  assert.match(markup, /teacher-tilt-card/);
  assert.match(markup, /teacher-magnetic-button/);
  assert.match(markup, /Action/);
});

run('reduced motion and touch-only pointers disable pointer effects', () => {
  const { pointerEffectsAllowed } = loadTsx('TeacherEffects.tsx');
  assert.equal(pointerEffectsAllowed(true, true), false);
  assert.equal(pointerEffectsAllowed(false, false), false);
  assert.equal(pointerEffectsAllowed(false, true), true);
});

run('teacher theme toggle stores and applies the selected mode', () => {
  const { applyTeacherTheme, teacherThemeStorageKey } = loadTsx('TeacherTheme.ts');
  const root = { dataset: {} };
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value) };
  applyTeacherTheme('dark', root, storage);
  assert.equal(root.dataset.teacherTheme, 'dark');
  assert.equal(values.get(teacherThemeStorageKey), 'dark');
  applyTeacherTheme('light', root, storage);
  assert.equal(root.dataset.teacherTheme, 'light');
  assert.equal(values.get(teacherThemeStorageKey), 'light');
});

run('teacher brand has descriptive alternative text and links to its portal', () => {
  const brandSource = fs.readFileSync(path.join(pageRoot, 'TeacherBrand.tsx'), 'utf8');
  assert.match(brandSource, /to="\/teacher\/dashboard"/);
  assert.match(brandSource, /alt="My JEE Mentor"/);
  assert.match(brandSource, /className="teacher-brand-mark" src=\{lightLogo\} alt="" aria-hidden="true"/);
});

run('weekly timetable card is rendered without the tilt wrapper', () => {
  const pageSource = fs.readFileSync(path.join(pageRoot, 'TeacherPage.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.join(pageRoot, 'TeacherPage.css'), 'utf8');
  assert.match(pageSource, /<Panel title="My Weekly Schedule" icon="calendar" tilt=\{false\}>/);
  assert.match(pageSource, /: <section className=\{`\$\{panelClass\} teacher-static-card`\}>/);
  assert.match(cssSource, /\.teacher-static-card \{ transform: none !important; perspective: none !important;/);
});

run('teacher page head supplies titles for dashboard, students, and profile', () => {
  let HelmetProvider;
  try { ({ HelmetProvider } = require('react-helmet-async')); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (HelmetProvider) {
    const TeacherPageHead = loadTsx('TeacherPageHead.tsx').default;
    for (const title of ['Dashboard', 'My Students', 'My Profile']) {
      const context = {};
      renderToStaticMarkup(React.createElement(HelmetProvider, { context },
        React.createElement(TeacherPageHead, { title, description: `${title} page` }),
      ));
      assert.match(context.helmet.title.toString(), new RegExp(`<title(?: data-rh="true")?>${title} \\| Teacher Portal</title>`));
      assert.match(context.helmet.meta.toString(), /name="description"/);
    }
  } else {
    const headSource = fs.readFileSync(path.join(pageRoot, 'TeacherPageHead.tsx'), 'utf8');
    const pageSource = fs.readFileSync(path.join(pageRoot, 'TeacherPage.tsx'), 'utf8');
    assert.match(headSource, /<Helmet>/);
    assert.match(headSource, /\{title\} \| Teacher Portal/);
    for (const title of ['Dashboard', 'My Students', 'My Profile']) assert.ok(pageSource.includes(`title: '${title}'`));
  }
});
