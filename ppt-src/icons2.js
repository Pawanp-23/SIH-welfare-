const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa'); const si = require('react-icons/si'); const md = require('react-icons/md');
const specs = [
  // spoke icons (white)
  ['sp_ui','FaDesktop','FFFFFF'], ['sp_api','FaServer','FFFFFF'], ['sp_ml','FaBrain','FFFFFF'],
  ['sp_db','FaDatabase','FFFFFF'], ['sp_shap','FaProjectDiagram','FFFFFF'], ['sp_shield','FaShieldAlt','FFFFFF'],
  // layer icons (navy)
  ['ly_front','FaGlobe','1B2A4A'], ['ly_chart','FaChartArea','1B2A4A'], ['ly_back','FaServer','1B2A4A'],
  ['ly_train','FaFlask','1B2A4A'], ['ly_runtime','FaBolt','1B2A4A'], ['ly_explain','FaProjectDiagram','1B2A4A'],
  ['ly_db','FaDatabase','1B2A4A'], ['ly_sec','FaLock','1B2A4A'], ['ly_deploy','FaCloudUploadAlt','1B2A4A'], ['ly_llm','FaRobot','1B2A4A'],
  // brand logos
  ['b_react','SiReact','61DAFB'], ['b_vite','SiVite','646CFF'], ['b_tailwind','SiTailwindcss','06B6D4'],
  ['b_framer','SiFramer','0055FF'], ['b_node','SiNodedotjs','5FA04E'], ['b_express','SiExpress','404040'],
  ['b_python','SiPython','3776AB'], ['b_sklearn','SiScikitlearn','F7931E'], ['b_ts','SiTypescript','3178C6'],
  ['b_sqlite','SiSqlite','0F80CC'], ['b_jwt','SiJsonwebtokens','D63AFF'], ['b_esbuild','SiEsbuild','FFCF00'],
  ['b_docker','SiDocker','2496ED'], ['b_gemini','SiGooglegemini','8E75B2'], ['b_pandas','SiPandas','150458'],
  ['b_numpy','SiNumpy','013243'], ['b_lucide','SiLucide','F56565'],
  ['b_chart','FaChartLine','0E7C7B'], ['b_shap','FaProjectDiagram','7B4FBF'], ['b_key','FaKey','E8772E'], ['b_hash','FaLink','1B2A4A'], ['b_sse','FaBroadcastTower','2E6FD9'],
  ['metric_check','FaCheckCircle','0E7C7B'],
];
(async () => {
  for (const [name, ic, color] of specs) {
    const Comp = fa[ic] || si[ic] || md[ic];
    if (!Comp) { console.log('MISSING', ic); continue; }
    const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + color, size: 256 }));
    await sharp(Buffer.from(svg)).png().toFile(`icons/${name}.png`);
  }
  console.log('done');
})();
