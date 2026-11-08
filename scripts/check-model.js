// VRM modelni tekshirish: node scripts/check-model.js public/models/aiko.vrm
// Saytga kerakli narsalar bor-yo'qligini aytadi: lab harakati, ko'z qisish, mimika, soch fizikasi, suyaklar.
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  const dir = 'public/models';
  files.push(...fs.readdirSync(dir).filter((f) => f.endsWith('.vrm')).map((f) => `${dir}/${f}`));
}

function readGltfJson(file) {
  const b = fs.readFileSync(file);
  if (b.toString('utf8', 0, 4) !== 'glTF') throw new Error('Bu .vrm/.glb fayl emas (FBX, OBJ yoki BLEND bo\'lishi mumkin)');
  const len = b.readUInt32LE(12);
  return { json: JSON.parse(b.toString('utf8', 20, 20 + len)), size: b.length };
}

const NEED_MOUTH = ['aa', 'ih', 'ou', 'ee', 'oh'];
const NEED_FACE = ['blink', 'happy', 'angry', 'sad', 'relaxed', 'surprised'];
const NEED_BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
// VRM 0.x nomlari -> 1.0 nomlari
const V0 = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', joy: 'happy', angry: 'angry', sorrow: 'sad', fun: 'relaxed', blink: 'blink', surprised: 'surprised' };

for (const file of files) {
  console.log(`\n📦 ${file}`);
  let ok = true;
  const bad = (m) => { ok = false; console.log('   ❌ ' + m); };
  const good = (m) => console.log('   ✅ ' + m);
  const warn = (m) => console.log('   ⚠️  ' + m);
  try {
    const { json, size } = readGltfJson(file);
    const mb = size / 1024 / 1024;
    (mb > 40 ? warn : good)(`Hajmi: ${mb.toFixed(1)} MB${mb > 40 ? ' — katta, telefonda sekin yuklanadi (VRoid\'da teksturani 1024/2048 qiling)' : ''}`);

    const v1 = json.extensions?.VRMC_vrm;
    const v0 = json.extensions?.VRM;
    if (!v1 && !v0) { bad('VRM ma\'lumoti yo\'q — bu oddiy glb. VRoid Studio yoki Blender VRM Add-on orqali .vrm qilib eksport qiling'); continue; }
    good(`Format: VRM ${v1 ? '1.0' : '0.x'}`);

    // ifodalar
    let expr = new Set();
    if (v1) expr = new Set(Object.keys(v1.expressions?.preset || {}).filter((k) => {
      const e = v1.expressions.preset[k];
      return (e.morphTargetBinds?.length || 0) + (e.materialColorBinds?.length || 0) + (e.textureTransformBinds?.length || 0) > 0;
    }));
    else for (const g of v0.blendShapeMaster?.blendShapeGroups || []) {
      const n = V0[(g.presetName || '').toLowerCase()];
      if (n && (g.binds?.length || g.materialValues?.length)) expr.add(n);
    }
    const missMouth = NEED_MOUTH.filter((k) => !expr.has(k));
    missMouth.length ? bad(`Lab harakati yo'q: ${missMouth.join(', ')} — gapirganda og'zi qimirlamaydi`) : good('Lab harakati (a, i, u, e, o) bor');
    expr.has('blink') ? good('Ko\'z qisish bor') : bad('Ko\'z qisish (blink) yo\'q');
    const missFace = NEED_FACE.filter((k) => k !== 'blink' && !expr.has(k));
    missFace.length ? warn(`Ba'zi mimikalar yo'q: ${missFace.join(', ')}`) : good('Mimikalar (quvonch, jahl, xafalik, hayrat...) bor');

    // ko'z harakati
    const look = v1 ? v1.lookAt : v0.firstPerson;
    look ? good('Ko\'zlar sizga qaraydi (lookAt)') : warn('Ko\'z qarash sozlanmagan');

    // suyaklar
    let bones = new Set();
    if (v1) bones = new Set(Object.keys(v1.humanoid?.humanBones || {}));
    else bones = new Set((v0.humanoid?.humanBones || []).map((b) => b.bone));
    const missBones = NEED_BONES.filter((b) => !bones.has(b));
    missBones.length ? bad(`Suyaklar yetishmaydi: ${missBones.join(', ')} — tana harakatlari ishlamaydi`) : good('Tana suyaklari to\'liq');

    // soch fizikasi
    const springs = v1 ? (json.extensions?.VRMC_springBone?.springs?.length || 0) : (v0.secondaryAnimation?.boneGroups?.length || 0);
    springs ? good(`Soch/kiyim fizikasi bor (${springs} guruh)`) : warn('Soch fizikasi yo\'q — sochlar qimirlamaydi');

    // litsenziya
    const meta = v1 ? json.extensions.VRMC_vrm.meta : v0.meta;
    if (meta) {
      const name = meta.name || meta.title || '';
      const authors = (meta.authors || [meta.author]).filter(Boolean).join(', ');
      console.log(`   ℹ️  Nomi: ${name || '-'}, muallif: ${authors || '-'}`);
      const commercial = v1 ? meta.commercialUsage : meta.commercialUssageName;
      if (commercial) {
        const allowed = /corporation|allow/i.test(String(commercial)) && !/disallow|personalNonProfit/i.test(String(commercial));
        (allowed ? good : warn)(`Tijoriy foydalanish: ${commercial}${allowed ? '' : ' — pullik saytda ishlatishdan oldin muallif bilan aniqlang!'}`);
      }
    }
    console.log(ok ? '   🎉 Saytga mos!' : '   ⛔ Saytda to\'liq ishlamaydi');
  } catch (e) {
    bad(e.message);
  }
}
