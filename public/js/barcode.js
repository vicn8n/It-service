// Code-128B barcode generator → inline SVG (ไม่ต้องพึ่ง library ภายนอก)
// ใช้กับ Asset ID เพื่อสแกนตอนตรวจนับทรัพย์สิน
(function () {
  // ตารางลายเส้นมาตรฐาน Code128 (โค้ด 0–106; ตัวสุดท้ายคือ stop)
  const PAT = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
  ];

  function encode(text) {
    const codes = [104]; // Start B
    let sum = 104;
    for (let i = 0; i < text.length; i++) {
      const v = text.charCodeAt(i) - 32;
      codes.push(v);
      sum += v * (i + 1);
    }
    codes.push(sum % 103); // checksum
    codes.push(106); // stop
    return codes.map((c) => PAT[c]).join("");
  }

  // คืน SVG string ของบาร์โค้ด
  function barcodeSVG(text, opts = {}) {
    text = String(text || "");
    const mod = opts.module || 2; // กว้างต่อ module (px)
    const height = opts.height || 60;
    const widths = encode(text);
    let x = 0, bars = "";
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]) * mod;
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#111"/>`;
      x += w;
    }
    const label = opts.label === false ? "" : `<text x="${x / 2}" y="${height + 14}" text-anchor="middle" font-family="monospace" font-size="13" fill="#111">${text.replace(/[<&>]/g, "")}</text>`;
    const totalH = height + (opts.label === false ? 0 : 18);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${totalH}" viewBox="0 0 ${x} ${totalH}">
      <rect width="${x}" height="${totalH}" fill="#fff"/>${bars}${label}</svg>`;
  }

  window.barcodeSVG = barcodeSVG;
})();
