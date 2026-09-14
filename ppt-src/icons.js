const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa');
const md = require('react-icons/md');
const specs = [
  // slide 2
  ['db','FaDatabase','FFFFFF'], ['mobile','FaMobileAlt','FFFFFF'], ['watch','FaHeartbeat','FFFFFF'],
  ['brain','FaBrain','FFFFFF'], ['usershield','FaUserShield','FFFFFF'], ['chart','FaChartBar','FFFFFF'],
  ['shield','FaShieldAlt','E8772E'],
  ['lightbulb_t','FaLightbulb','0E7C7B'], ['target_t','FaBullseye','0E7C7B'], ['rocket_t','FaRocket','0E7C7B'],
  // slide 3
  ['db_w','FaDatabase','FFFFFF'], ['lock_w','FaLock','FFFFFF'], ['cogs_w','FaCogs','FFFFFF'],
  ['brain_w','FaBrain','FFFFFF'], ['bulb_w','FaLightbulb','FFFFFF'], ['bell_w','FaBell','FFFFFF'],
  ['mobile_n','FaMobileAlt','1B2A4A'], ['server_n','FaServer','1B2A4A'], ['robot_n','FaRobot','1B2A4A'],
  ['database_n','FaDatabase','1B2A4A'], ['lock_n','FaLock','1B2A4A'], ['cloud_n','FaCloud','1B2A4A'],
  // slide 4
  ['check_w','FaCheckCircle','FFFFFF'], ['warn_w','FaExclamationTriangle','FFFFFF'], ['tools_w','FaTools','FFFFFF'],
  ['check_t','FaCheck','0E7C7B'], ['excl_o','FaExclamation','E8772E'], ['arrow_n','FaArrowRight','1B2A4A'],
  ['rupee_n','FaRupeeSign','1B2A4A'], ['cloud_n2','FaCloud','1B2A4A'], ['code_n','FaCode','1B2A4A'], ['handshake_n','FaHandshake','1B2A4A'],
  ['flag_w','FaFlagCheckered','FFFFFF'],
  // slide 5
  ['users_w','FaUsers','FFFFFF'], ['heart_w','FaHeart','FFFFFF'], ['balance_w','FaBalanceScale','FFFFFF'],
  ['retain_w','FaUserCheck','FFFFFF'], ['chartline_w','FaChartLine','FFFFFF'],
  ['smile_w','FaSmile','FFFFFF'], ['medal_w','FaMedal','FFFFFF'], ['coins_w','FaCoins','FFFFFF'],
  ['flagin_w','FaFlag','FFFFFF'], ['expand_w','FaExpandArrowsAlt','FFFFFF'],
  ['brain_big','FaBrain','FFFFFF'],
  // slide 6
  ['gov_n','FaLandmark','1B2A4A'], ['clinic_n','FaClipboardCheck','1B2A4A'], ['book_n','FaBookOpen','1B2A4A'], ['code_n2','FaCode','1B2A4A'],
];
(async () => {
  for (const [name, icon, color] of specs) {
    const Comp = fa[icon] || md[icon];
    if (!Comp) { console.log('MISSING', icon); continue; }
    const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + color, size: 256 }));
    await sharp(Buffer.from(svg)).png().toFile(`icons/${name}.png`);
  }
  console.log('done', specs.length);
})();
